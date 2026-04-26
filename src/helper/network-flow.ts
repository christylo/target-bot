import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page, Request } from "playwright";

import type { AppConfig } from "../config.js";
import {
  ensureAssistantPage,
  launchPersistentTargetContext,
  runBuyFlowOnPage
} from "./assistant.js";

interface RecordedRequest {
  id: number;
  offsetMs: number;
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
  redirectedFrom?: string;
  response?: {
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
  };
  failureText?: string;
}

interface NetworkRecording {
  version: 1;
  recordedAt: string;
  targetProductUrl: string;
  targetTcin?: string;
  handoffPageUrl?: string;
  requests: RecordedRequest[];
}

const DEFAULT_RECORDING_FILE = ".data/network/latest-target-session.json";
const RECORDING_DIR = ".data/network";

const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie"
]);

const REPLAY_HEADER_BLOCKLIST = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "set-cookie"
]);

const BROWSER_FETCH_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-type",
  "x-application-name"
]);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const ANALYTICS_OR_ASSET_URL = /adobedc|adobedtm|analytics|beacon|collector|doubleclick|firefly_events|google-analytics|googleadservices|googletagmanager|medallia|metrics|oauth_validations|pinterest|px-cloud|snapchat|tealium|tealeaf|telemetry|rum|\/event/i;
const FINAL_ORDER_SUBMISSION = /place[-_ ]?order|submit[-_ ]?order|complete[-_ ]?purchase|confirm[-_ ]?order|finalize[-_ ]?order/i;
const CART_OR_CHECKOUT_API_HINT = /\/(?:cart|carts|checkout|checkouts|co-|orders?|order|line_items?|cart_items?)\b/i;

export async function recordCurrentBuyFlowNetwork(config: AppConfig): Promise<void> {
  if (!config.targetProductUrl) {
    throw new Error("TARGET_PRODUCT_URL must be set before recording the buy flow.");
  }

  const outputPath = recordingPathFromEnv();
  const startedAt = Date.now();
  const requests: RecordedRequest[] = [];
  const requestIds = new Map<Request, number>();

  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  const attachRecorder = (targetPage: Page) => {
    targetPage.on("request", (request) => {
      const id = requests.length + 1;
      requestIds.set(request, id);
      requests.push({
        id,
        offsetMs: Date.now() - startedAt,
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        headers: sanitizeHeaders(request.headers()),
        postData: request.postData() ?? undefined,
        redirectedFrom: request.redirectedFrom()?.url()
      });
    });

    targetPage.on("requestfinished", async (request) => {
      const record = findRecord(requests, requestIds.get(request));
      if (!record) {
        return;
      }

      const response = await request.response().catch(() => null);
      if (!response) {
        return;
      }

      record.response = {
        status: response.status(),
        statusText: response.statusText(),
        url: response.url(),
        headers: sanitizeHeaders(response.headers())
      };
    });

    targetPage.on("requestfailed", (request) => {
      const record = findRecord(requests, requestIds.get(request));
      if (record) {
        record.failureText = request.failure()?.errorText ?? "request failed";
      }
    });
  };

  context.on("page", attachRecorder);
  for (const existingPage of context.pages()) {
    attachRecorder(existingPage);
  }

  try {
    await runBuyFlowOnPage(page, config, { stopAtHandoff: true });
    await page.waitForTimeout(500);
  } finally {
    const recording: NetworkRecording = {
      version: 1,
      recordedAt: new Date(startedAt).toISOString(),
      targetProductUrl: config.targetProductUrl,
      targetTcin: inferTcin(config.targetProductUrl),
      handoffPageUrl: page.url(),
      requests
    };

    await writeRecording(outputPath, recording);
    await context.close();
  }

  const replayable = selectReplayableRequests(requests);
  console.log(`Recorded ${requests.length} network requests to ${outputPath}`);
  console.log(`Replay candidate requests: ${replayable.length}`);
  for (const request of replayable) {
    console.log(`- ${request.method} ${request.url}`);
  }
}

export async function runFastBuyFromRecording(config: AppConfig): Promise<void> {
  if (!config.targetProductUrl) {
    throw new Error("TARGET_PRODUCT_URL must be set before running fast-buy.");
  }

  const inputPath = recordingPathFromEnv();
  const recording = await readRecording(inputPath);
  if (!recording.handoffPageUrl || /\/p\//i.test(recording.handoffPageUrl)) {
    throw new Error(
      `The recording in ${inputPath} never reached cart/checkout. Re-run "npm run helper:record" when the product is in stock and the click helper can reach the handoff page.`
    );
  }

  const sourceTcin = recording.targetTcin ?? inferTcin(recording.targetProductUrl);
  const targetTcin = inferTcin(config.targetProductUrl);
  const requests = selectReplayableRequests(recording.requests);

  if (requests.length === 0) {
    throw new Error(
      `No replayable Target cart/checkout requests were found in ${inputPath}. Re-run "npm run helper:record" on an in-stock product first.`
    );
  }

  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  try {
    console.log(`Replaying ${requests.length} recorded Target API requests from ${inputPath}`);
    await page.goto("https://www.target.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    for (const request of requests) {
      const replayUrl = rewriteForTargetProduct(request.url, sourceTcin, targetTcin);
      const replayBody = request.postData
        ? rewriteForTargetProduct(request.postData, sourceTcin, targetTcin)
        : undefined;
      const headers = buildBrowserReplayHeaders(request.headers, replayBody);

      console.log(`${request.method} ${replayUrl}`);
      const response = await fetchFromTargetPage(page, {
        url: replayUrl,
        method: request.method,
        headers,
        body: replayBody,
        timeout: config.requestTimeoutMs
      });

      console.log(`  -> ${response.status} ${response.statusText}`);
      if (response.status >= 400) {
        throw new Error(
          `Replay request failed with ${response.status} ${response.statusText} for ${replayUrl}\n${response.body.slice(0, 500)}`
        );
      }
    }

    const handoffUrl = chooseHandoffUrl(recording, config);
    console.log(`Opening handoff page: ${handoffUrl}`);
    await page.goto(handoffUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("net::ERR_ABORTED")) {
        throw error;
      }
    });
    await settleCheckoutHandoff(page);

    console.log("Browser is open at the fastest available handoff page.");
    console.log("Make the final order click yourself, then press Ctrl+C here when you're done.");
    await waitForInterrupt();
  } finally {
    await context.close();
  }
}

export function selectReplayableRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => {
    const method = request.method.toUpperCase();
    const searchable = `${request.url}\n${request.postData ?? ""}`;

    if (!MUTATING_METHODS.has(method)) {
      return false;
    }

    if (!isTargetHost(request.url)) {
      return false;
    }

    if (ANALYTICS_OR_ASSET_URL.test(request.url)) {
      return false;
    }

    if (FINAL_ORDER_SUBMISSION.test(searchable)) {
      return false;
    }

    return CART_OR_CHECKOUT_API_HINT.test(request.url) || CART_OR_CHECKOUT_API_HINT.test(request.postData ?? "");
  });
}

export function inferTcin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.match(/\/A-(\d+)/i)?.[1] ?? value.match(/\b(?:tcin|product_id)["':=\s]+(\d{6,})/i)?.[1];
}

function recordingPathFromEnv(): string {
  return process.env.TARGET_NETWORK_RECORDING_FILE?.trim() || DEFAULT_RECORDING_FILE;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !REDACTED_HEADERS.has(name.toLowerCase()))
  );
}

function buildReplayHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !REPLAY_HEADER_BLOCKLIST.has(name.toLowerCase()))
  );
}

function buildBrowserReplayHeaders(
  headers: Record<string, string>,
  body: string | undefined
): Record<string, string> {
  const replayHeaders = Object.fromEntries(
    Object.entries(buildReplayHeaders(headers)).filter(([name]) =>
      BROWSER_FETCH_HEADER_ALLOWLIST.has(name.toLowerCase())
    )
  );

  if (body && !hasHeader(replayHeaders, "content-type")) {
    replayHeaders["content-type"] = "application/json";
  }

  if (!hasHeader(replayHeaders, "accept")) {
    replayHeaders.accept = "application/json";
  }

  if (!hasHeader(replayHeaders, "x-application-name")) {
    replayHeaders["x-application-name"] = "web";
  }

  return replayHeaders;
}

async function fetchFromTargetPage(
  page: Page,
  input: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout: number;
  }
): Promise<{ status: number; statusText: string; body: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
      return await page.evaluate(async ({ url, method, headers, body, timeout }) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method,
            headers,
            body,
            credentials: "include",
            mode: "cors",
            signal: controller.signal
          });

          return {
            status: response.status,
            statusText: response.statusText,
            body: await response.text()
          };
        } finally {
          window.clearTimeout(timeoutId);
        }
      }, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 3 || !/Execution context was destroyed|Target page|Navigation/i.test(message)) {
        throw error;
      }

      await page.waitForTimeout(500);
    }
  }

  throw new Error("Browser replay fetch failed unexpectedly.");
}

async function settleCheckoutHandoff(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForFunction(
    () => {
      const stylesReady = [...document.styleSheets].some((sheet) => {
        try {
          return sheet.cssRules.length > 0;
        } catch {
          return true;
        }
      });
      const finalButton = [...document.querySelectorAll("button")].some((button) =>
        /place your order|place order|submit order|complete purchase/i.test(button.textContent ?? "")
      );

      return stylesReady && finalButton;
    },
    undefined,
    { timeout: 10_000 }
  ).catch(() => undefined);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function rewriteForTargetProduct(value: string, sourceTcin?: string, targetTcin?: string): string {
  if (!sourceTcin || !targetTcin || sourceTcin === targetTcin) {
    return value;
  }

  return value.replaceAll(sourceTcin, targetTcin);
}

function chooseHandoffUrl(recording: NetworkRecording, config: AppConfig): string {
  const candidate = recording.handoffPageUrl;
  if (candidate && /target\.com/i.test(candidate) && !/\/p\//i.test(candidate)) {
    return candidate;
  }

  return config.targetCartUrl;
}

function isTargetHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "target.com" || hostname.endsWith(".target.com");
  } catch {
    return false;
  }
}

function findRecord(records: RecordedRequest[], id: number | undefined): RecordedRequest | undefined {
  return id === undefined ? undefined : records[id - 1];
}

async function writeRecording(filePath: string, recording: NetworkRecording): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await mkdir(RECORDING_DIR, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
}

async function readRecording(filePath: string): Promise<NetworkRecording> {
  return JSON.parse(await readFile(filePath, "utf8")) as NetworkRecording;
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };

    const onSignal = () => cleanup();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
