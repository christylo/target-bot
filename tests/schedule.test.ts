import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, resolveScheduledStart } from "../src/helper/schedule.js";

test("resolveScheduledStart accepts a future local timestamp", () => {
  const now = new Date("2026-03-20T20:00:00-07:00");
  const result = resolveScheduledStart("2026-03-20T23:58:00", now);

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 2);
  assert.equal(result.getDate(), 20);
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 58);
});

test("resolveScheduledStart rejects invalid timestamps", () => {
  assert.throws(() => resolveScheduledStart("not-a-date"), /Invalid scheduled start/);
});

test("resolveScheduledStart rejects past timestamps", () => {
  const now = new Date("2026-03-20T20:00:00-07:00");
  assert.throws(() => resolveScheduledStart("2026-03-20T19:59:59", now), /must be in the future/);
});

test("formatDuration formats human-readable countdowns", () => {
  assert.equal(formatDuration(65_000), "1m 5s");
  assert.equal(formatDuration(3_661_000), "1h 1m 1s");
});
