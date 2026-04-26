export interface ParsedArgs {
  positional: string[];
  targetProductUrl?: string;
  pollIntervalMs?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let targetProductUrl: string | undefined;
  let pollIntervalMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url" || arg === "-u") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a Target product URL.`);
      }

      targetProductUrl = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      const value = arg.slice("--url=".length).trim();
      if (!value) {
        throw new Error("--url requires a Target product URL.");
      }

      targetProductUrl = value;
      continue;
    }

    if (arg === "--poll-interval-ms") {
      const value = argv[index + 1];
      pollIntervalMs = parsePositiveIntegerOption(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--poll-interval-ms=")) {
      pollIntervalMs = parsePositiveIntegerOption(arg.split("=")[0], arg.slice("--poll-interval-ms=".length));
      continue;
    }

    positional.push(arg);
  }

  return { positional, targetProductUrl, pollIntervalMs };
}

function parsePositiveIntegerOption(name: string, rawValue: string | undefined): number {
  if (!rawValue || rawValue.startsWith("-")) {
    throw new Error(`${name} requires a positive integer value.`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer value.`);
  }

  return value;
}
