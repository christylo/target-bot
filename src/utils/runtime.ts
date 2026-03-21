import { spawn } from "node:child_process";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
