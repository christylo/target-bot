import { loadConfig, type AppConfig } from "./config.js";
import { createNotifiers } from "./alerts/notifier.js";
import { parseArgs } from "./cli.js";
import { Tracker } from "./core/tracker.js";
import { runAssistant } from "./helper/assistant.js";
import { runBrowserWatchAndBuy, runBrowserWatchLoop } from "./helper/browser-watch.js";
import { formatDuration, resolveScheduledStart } from "./helper/schedule.js";
import { sleep } from "./utils/runtime.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({
    targetProductUrl: args.targetProductUrl,
    pollIntervalMs: args.pollIntervalMs
  });
  const command = args.positional[0] ?? "once";
  const tracker = new Tracker(config, createNotifiers(config));

  if (command === "once") {
    await tracker.checkOnce();
    return;
  }

  if (command === "watch") {
    await runWatchLoop(tracker, config.pollIntervalMs);
    return;
  }

  if (command === "watch-browser") {
    await runBrowserWatchLoop(tracker, config.pollIntervalMs, config);
    return;
  }

  if (command === "watch-buy") {
    await runBrowserWatchAndBuy(tracker, config.pollIntervalMs, config);
    return;
  }

  if (command === "watch-http-buy") {
    await runHttpWatchAndBuy(tracker, config.pollIntervalMs, config);
    return;
  }

  if (command === "watch-buy-at") {
    const rawTimestamp = args.positional[1] ?? process.env.TARGET_WATCH_START_AT;
    if (!rawTimestamp) {
      throw new Error(
        `watch-buy-at requires a timestamp argument or TARGET_WATCH_START_AT. Example: npm run watch:buy-at -- 2026-03-21T00:00:00`
      );
    }

    const startAt = resolveScheduledStart(rawTimestamp);
    const delayMs = startAt.getTime() - Date.now();
    console.log(
      `Scheduling browser-backed watch-and-buy for ${startAt.toString()} (${formatDuration(delayMs)} from now).`
    );
    await sleep(delayMs);
    console.log(`Starting browser-backed poll at ${new Date().toString()}.`);
    await runBrowserWatchAndBuy(tracker, config.pollIntervalMs, config);
    return;
  }

  throw new Error(
    `Unknown command "${command}". Use "once", "watch", "watch-browser", "watch-buy", "watch-http-buy", or "watch-buy-at".`
  );
}

async function runWatchLoop(tracker: Tracker, pollIntervalMs: number): Promise<void> {
  console.log(`Starting watch loop with ${pollIntervalMs}ms polling interval.`);

  while (true) {
    try {
      await tracker.checkOnce();
    } catch (error) {
      console.error(`Tracker iteration failed: ${(error as Error).message}`);
    }

    await sleep(pollIntervalMs);
  }
}

async function runHttpWatchAndBuy(
  tracker: Tracker,
  pollIntervalMs: number,
  config: AppConfig
): Promise<void> {
  console.log(`Starting low-latency watch-and-buy loop with ${pollIntervalMs}ms polling interval.`);

  while (true) {
    const startedAt = Date.now();

    try {
      const result = await tracker.checkOnce();
      if (result.snapshot.availability === "in_stock") {
        console.log(
          `HTTP stock detection saw in_stock at ${result.snapshot.checkedAt}. Launching browser buy helper immediately.`
        );
        try {
          await runAssistant("buy", config);
          return;
        } catch (error) {
          console.error(`Buy helper failed after stock detection: ${(error as Error).message}`);
          console.error("Low-latency watcher will continue polling.");
        }
      }
    } catch (error) {
      console.error(`Low-latency poll failed; continuing. ${(error as Error).message}`);
    }

    const elapsedMs = Date.now() - startedAt;
    await sleep(Math.max(0, pollIntervalMs - elapsedMs));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
