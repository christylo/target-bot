export interface ParsedArgs {
  positional: string[];
  targetProductUrl?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let targetProductUrl: string | undefined;

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

    positional.push(arg);
  }

  return { positional, targetProductUrl };
}
