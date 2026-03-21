import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StateStore } from "../src/core/state-store.js";

const TEST_TARGET_PRODUCT_URL = "https://www.target.com/p/example-product/-/A-00000000#lnk=sametab";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "army-bomb-tracker-"));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("StateStore returns an empty state when the file does not exist", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(join(dir, "nested", "state.json"));

    await assert.doesNotReject(() => store.read());
    assert.deepEqual(await store.read(), { products: {} });
  });
});

test("StateStore writes and reads state snapshots", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(join(dir, "nested", "state.json"));
    const payload = {
      products: {
        "abc123": {
          productName: "Example Target Product",
          productUrl: TEST_TARGET_PRODUCT_URL,
          availability: "in_stock" as const,
          price: "$35.99",
          lastCheckedAt: "2026-03-20T12:00:00.000Z",
          lastChangedAt: "2026-03-20T12:00:00.000Z",
          lastAlertedAt: "2026-03-20T12:00:00.000Z"
        }
      }
    };

    await store.write(payload);

    assert.deepEqual(await store.read(), payload);
  });
});
