import { loadConfig } from "./config.js";
import { createNotifiers } from "./alerts/notifier.js";
import { Tracker } from "./core/tracker.js";
import { runBrowserWatchAndBuy } from "./helper/browser-watch.js";
import { formatDuration, resolveScheduledStart } from "./helper/schedule.js";
import { sleep } from "./utils/runtime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const command = process.argv[2] ?? "once";
  const tracker = new Tracker(config, createNotifiers(config));

  if (command === "once") {
    await tracker.checkOnce();
    return;
  }

  if (command === "watch") {
    await runWatchLoop(tracker, config.pollIntervalMs);
    return;
  }

  if (command === "watch-buy") {
    await runBrowserWatchAndBuy(tracker, config.pollIntervalMs, config);
    return;
  }

  if (command === "watch-buy-at") {
    const rawTimestamp = process.argv[3] ?? process.env.TARGET_WATCH_START_AT;
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
    await runBrowserWatchAndBuy(tracker, config.pollIntervalMs, config, { startAt });
    return;
  }

  throw new Error(`Unknown command "${command}". Use "once", "watch", "watch-buy", or "watch-buy-at".`);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
