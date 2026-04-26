import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/cli.js";

test("parseArgs reads --url while preserving positional args", () => {
  const parsed = parseArgs([
    "watch-fast-buy",
    "--url",
    "https://www.target.com/p/example/-/A-12345678"
  ]);

  assert.deepEqual(parsed.positional, ["watch-fast-buy"]);
  assert.equal(parsed.targetProductUrl, "https://www.target.com/p/example/-/A-12345678");
});

test("parseArgs supports --url=value", () => {
  const parsed = parseArgs([
    "fast-buy",
    "--url=https://www.target.com/p/example/-/A-12345678"
  ]);

  assert.deepEqual(parsed.positional, ["fast-buy"]);
  assert.equal(parsed.targetProductUrl, "https://www.target.com/p/example/-/A-12345678");
});

test("parseArgs rejects --url without a value", () => {
  assert.throws(() => parseArgs(["watch-fast-buy", "--url"]), /requires a Target product URL/);
});
