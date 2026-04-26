import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/cli.js";

test("parseArgs reads --url while preserving positional args", () => {
  const parsed = parseArgs([
    "watch-buy",
    "--url",
    "https://www.target.com/p/example/-/A-12345678"
  ]);

  assert.deepEqual(parsed.positional, ["watch-buy"]);
  assert.equal(parsed.targetProductUrl, "https://www.target.com/p/example/-/A-12345678");
});

test("parseArgs supports --url=value", () => {
  const parsed = parseArgs([
    "buy",
    "--url=https://www.target.com/p/example/-/A-12345678"
  ]);

  assert.deepEqual(parsed.positional, ["buy"]);
  assert.equal(parsed.targetProductUrl, "https://www.target.com/p/example/-/A-12345678");
});

test("parseArgs reads --poll-interval-ms while preserving positional args", () => {
  const parsed = parseArgs(["watch-buy", "--poll-interval-ms", "1000"]);

  assert.deepEqual(parsed.positional, ["watch-buy"]);
  assert.equal(parsed.pollIntervalMs, 1000);
});

test("parseArgs supports --poll-interval-ms=value", () => {
  const parsed = parseArgs(["watch", "--poll-interval-ms=750"]);

  assert.deepEqual(parsed.positional, ["watch"]);
  assert.equal(parsed.pollIntervalMs, 750);
});

test("parseArgs rejects --url without a value", () => {
  assert.throws(() => parseArgs(["watch-buy", "--url"]), /requires a Target product URL/);
});

test("parseArgs rejects invalid --poll-interval-ms values", () => {
  assert.throws(() => parseArgs(["watch-buy", "--poll-interval-ms"]), /requires a positive integer/);
  assert.throws(() => parseArgs(["watch-buy", "--poll-interval-ms", "0"]), /requires a positive integer/);
  assert.throws(() => parseArgs(["watch-buy", "--poll-interval-ms=1.5"]), /requires a positive integer/);
});
