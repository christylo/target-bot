import type { BrowserContext, Page } from "playwright";

import type { AppConfig } from "../config.js";
import { Tracker } from "../core/tracker.js";
import { parseTargetPage } from "../providers/target.js";
import { sleep } from "../utils/runtime.js";
import { formatDuration, waitUntil } from "./schedule.js";
import {
  ensureAssistantPage,
  launchPersistentTargetContext,
  preferShippingOnProductPage,
  requiresLogin,
  runBuyFlowOnPage,
  settleDomOnly
} from "./assistant.js";

const WATCH_SETTLE_MS = 100;

export async function runBrowserWatchAndBuy(
  tracker: Tracker,
  pollIntervalMs: number,
  config: AppConfig,
  options: { startAt?: Date } = {}
): Promise<void> {
  if (!config.targetProductUrl) {
    throw new Error("TARGET_PRODUCT_URL must be set for browser watch-and-buy.");
  }

  console.log(`Starting browser-backed watch-and-buy loop with ${pollIntervalMs}ms polling interval.`);

  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  try {
    if (options.startAt) {
      await prepareBrowserWatchPage(page, config);
      const delayMs = options.startAt.getTime() - Date.now();
      console.log(
        `Armed browser-backed watch-and-buy for ${options.startAt.toString()} (${formatDuration(delayMs)} from now).`
      );
      await waitUntil(options.startAt);
      console.log(`Starting exact-timestamp browser poll at ${new Date().toString()}.`);
    }

    while (true) {
      const snapshot = await captureBrowserSnapshot(page, config);
      const result = await tracker.recordSnapshot(snapshot);

      if (result.snapshot.availability === "in_stock") {
        console.log(
          `Browser-backed stock detection saw in_stock at ${result.snapshot.checkedAt}. Launching buy flow immediately.`
        );
        try {
          await runBuyFlowOnPage(page, config, { useCurrentPage: true, currentPagePrepared: true });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Buy flow failed after stock detection: ${message}`);
          console.error("Browser-backed watcher will continue polling.");
        }
      }

      await sleep(pollIntervalMs);
    }
  } finally {
    await context.close();
  }
}

async function captureBrowserSnapshot(page: Page, config: AppConfig) {
  await page.goto(config.targetProductUrl!, { waitUntil: "domcontentloaded" }).catch((error) => {
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
    fallbackUrl: page.url() || config.targetProductUrl!,
    sourceKind: "browser-session"
  });
}

async function prepareBrowserWatchPage(page: Page, config: AppConfig): Promise<void> {
  await page.goto(config.targetProductUrl!, { waitUntil: "domcontentloaded" }).catch((error) => {
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
}

export async function withPersistentTargetContext<T>(
  config: AppConfig,
  fn: (context: BrowserContext, page: Page) => Promise<T>
): Promise<T> {
  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  try {
    return await fn(context, page);
  } finally {
    await context.close();
  }
}
