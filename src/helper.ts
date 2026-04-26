import { loadConfig } from "./config.js";
import { parseArgs } from "./cli.js";
import { runAssistant, type HelperCommand } from "./helper/assistant.js";
import { recordCurrentBuyFlowNetwork, runFastBuyFromRecording } from "./helper/network-flow.js";
import { formatDuration, resolveScheduledStart, waitUntil } from "./helper/schedule.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ targetProductUrl: args.targetProductUrl });
  const command = (args.positional[0] ?? "login") as HelperCommand | "buy-at" | "record" | "fast-buy";

  if (!["login", "buy", "buy-at", "record", "fast-buy"].includes(command)) {
    throw new Error(`Unknown helper command "${command}". Use "login", "buy", "buy-at", "record", or "fast-buy".`);
  }

  if (command === "buy-at") {
    const rawTimestamp = args.positional[1] ?? process.env.TARGET_HELPER_START_AT;
    if (!rawTimestamp) {
      throw new Error(
        `buy-at requires a timestamp argument or TARGET_HELPER_START_AT. Example: npm run helper:buy-at -- 2026-03-20T23:58:00`
      );
    }

    const startAt = resolveScheduledStart(rawTimestamp);
    const delayMs = startAt.getTime() - Date.now();
    console.log(`Scheduled helper start for ${startAt.toString()} (${formatDuration(delayMs)} from now).`);
    await waitUntil(startAt);
    console.log(`Starting buy flow at ${new Date().toString()}.`);
    await runAssistant("buy", config);
    return;
  }

  if (command === "record") {
    await recordCurrentBuyFlowNetwork(config);
    return;
  }

  if (command === "fast-buy") {
    await runFastBuyFromRecording(config);
    return;
  }

  await runAssistant(command, config);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
