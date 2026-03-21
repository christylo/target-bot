import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadHtml } from "../src/utils/http.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "army-bomb-tracker-"));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadHtml reads from a local HTML file", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "target.html");
    await writeFile(filePath, "<html><body>local fixture</body></html>", "utf8");

    const result = await loadHtml({
      filePath,
      timeoutMs: 1000
    });

    assert.equal(result.source, "local-file");
    assert.equal(result.html, "<html><body>local fixture</body></html>");
  });
});

test("loadHtml issues a live request with the supplied headers", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "<html><body>live fixture</body></html>"
    } as Response;
  }) as typeof fetch;

  try {
    const result = await loadHtml({
      url: "https://example.com/product",
      timeoutMs: 1000,
      cookieHeader: "store=1234",
      userAgent: "Army Bomb Bot",
      extraHeaders: { "x-store-id": "2468" }
    });

    assert.equal(result.source, "live-request");
    assert.equal(result.html, "<html><body>live fixture</body></html>");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://example.com/product");

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["cookie"], "store=1234");
    assert.equal(headers["user-agent"], "Army Bomb Bot");
    assert.equal(headers["x-store-id"], "2468");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadHtml requires a URL when no local file is configured", async () => {
  await assert.rejects(() => loadHtml({ timeoutMs: 1000 }), /A URL is required for live HTML fetches\./);
});
