import { readFile } from "node:fs/promises";

export interface HtmlSource {
  html: string;
  source: "live-request" | "local-file";
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export async function loadHtml(options: {
  url?: string;
  filePath?: string;
  timeoutMs: number;
  cookieHeader?: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}): Promise<HtmlSource> {
  if (options.filePath) {
    const html = await readFile(options.filePath, "utf8");
    return { html, source: "local-file" };
  }

  if (!options.url) {
    throw new Error("A URL is required for live HTML fetches.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(options.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
        ...(options.cookieHeader ? { cookie: options.cookieHeader } : {}),
        ...(options.extraHeaders ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`Target request failed with ${response.status} ${response.statusText}`);
    }

    return {
      html: await response.text(),
      source: "live-request"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
