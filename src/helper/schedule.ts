export function resolveScheduledStart(input: string, now = new Date()): Date {
  const parsed = new Date(input);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid scheduled start "${input}". Use a local timestamp like 2026-03-20T23:58:00 or include an offset.`
    );
  }

  if (parsed.getTime() <= now.getTime()) {
    throw new Error(`Scheduled start must be in the future. Received ${parsed.toString()}.`);
  }

  return parsed;
}

export async function waitUntil(target: Date): Promise<void> {
  while (true) {
    const remainingMs = target.getTime() - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    const sleepMs =
      remainingMs > 60_000
        ? 15_000
        : remainingMs > 10_000
          ? 2_000
          : Math.min(remainingMs, 250);

    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours > 0 ? `${hours}h` : null, minutes > 0 ? `${minutes}m` : null, `${seconds}s`]
    .filter(Boolean)
    .join(" ");
}
