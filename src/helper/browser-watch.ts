import type { Page } from "playwright";

import type { AppConfig } from "../config.js";
import { Tracker } from "../core/tracker.js";
import { parseTargetPage } from "../providers/target.js";
import { sleep } from "../utils/runtime.js";
import {
  ensureAssistantPage,
  launchPersistentTargetContext,
  preferShippingOnProductPage,
  requiresLogin,
  runBuyFlowOnPage,
  settleDomOnly
} from "./assistant.js";

const WATCH_SETTLE_MS = 500;

export async function runBrowserWatchLoop(
  tracker: Tracker,
  pollIntervalMs: number,
  config: AppConfig
): Promise<void> {
  console.log(`Starting browser-backed watch loop with ${pollIntervalMs}ms polling interval.`);

  await withBrowserWatchPage(config, async (page) => {
    let pollCount = 0;

    while (true) {
      const startedAt = Date.now();

      try {
        const snapshot = await captureBrowserSnapshot(page, config, ++pollCount);
        await tracker.recordSnapshot(snapshot);
      } catch (error) {
        if (isAuthenticationError(error)) {
          throw error;
        }

        console.error(`Browser-backed poll failed; continuing. ${(error as Error).message}`);
      }

      const elapsedMs = Date.now() - startedAt;
      await sleep(Math.max(0, pollIntervalMs - elapsedMs));
    }
  });
}

export async function runBrowserWatchAndBuy(
  tracker: Tracker,
  pollIntervalMs: number,
  config: AppConfig
): Promise<void> {
  console.log(`Starting browser-backed watch-and-buy loop with ${pollIntervalMs}ms polling interval.`);

  await withBrowserWatchPage(config, async (page) => {
    let pollCount = 0;

    while (true) {
      const startedAt = Date.now();

      try {
        const snapshot = await captureBrowserSnapshot(page, config, ++pollCount);
        const result = await tracker.recordSnapshot(snapshot);

        if (result.snapshot.availability === "in_stock") {
          console.log(
            `Browser stock detection saw in_stock at ${result.snapshot.checkedAt}. Launching browser buy helper immediately.`
          );
          try {
            await runBuyFlowOnPage(page, config, { useCurrentPage: true, currentPagePrepared: true });
            return;
          } catch (error) {
            console.error(`Buy helper failed after browser stock detection: ${(error as Error).message}`);
            console.error("Browser-backed watcher will continue polling.");
          }
        }
      } catch (error) {
        if (isAuthenticationError(error)) {
          throw error;
        }

        console.error(`Browser-backed poll failed; continuing. ${(error as Error).message}`);
      }

      const elapsedMs = Date.now() - startedAt;
      await sleep(Math.max(0, pollIntervalMs - elapsedMs));
    }
  });
}

function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|helper:login/i.test(message);
}

async function withBrowserWatchPage<T>(
  config: AppConfig,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function captureBrowserSnapshot(page: Page, config: AppConfig, pollCount: number) {
  if (!config.targetProductUrl) {
    throw new Error("TARGET_PRODUCT_URL must be set for browser-backed watching.");
  }

  console.log(`[browser-watch] poll #${pollCount}: refreshing product page`);

  await page.goto(config.targetProductUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.requestTimeoutMs
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("net::ERR_ABORTED")) {
      throw error;
    }
  });

  await settleDomOnly(page, WATCH_SETTLE_MS);

  if (await requiresLogin(page)) {
    throw new Error(
      `Target appears to need authentication in the persistent browser profile. Run "npm run helper:login" first and sign in manually.`
    );
  }

  await preferShippingOnProductPage(page);
  await settleDomOnly(page, WATCH_SETTLE_MS);

  return parseTargetPage({
    html: await page.content(),
    fallbackUrl: config.targetProductUrl,
    sourceKind: "browser-session"
  });
}
