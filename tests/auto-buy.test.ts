import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutoBuyState,
  recordAutoBuyFailure,
  recordAutoBuyLaunch,
  reconcileAutoBuyState,
  shouldLaunchAutoBuy
} from "../src/core/auto-buy.js";

test("auto-buy launches on the first in-stock observation", () => {
  const state = createAutoBuyState();

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: false,
      now: 1_000,
      state
    }),
    true
  );
});

test("auto-buy does not relaunch while the same in-stock streak is active", () => {
  const launched = recordAutoBuyLaunch(createAutoBuyState());

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: false,
      now: 1_000,
      state: launched
    }),
    false
  );
});

test("auto-buy resets after the product leaves in-stock state", () => {
  const reset = reconcileAutoBuyState(recordAutoBuyLaunch(createAutoBuyState()), "out_of_stock");

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: false,
      now: 1_000,
      state: reset
    }),
    true
  );
});

test("auto-buy respects retry cooldown after a helper failure", () => {
  const failed = recordAutoBuyFailure(recordAutoBuyLaunch(createAutoBuyState()), 1_000, 5_000);

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: false,
      now: 5_999,
      state: failed
    }),
    false
  );

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: false,
      now: 6_000,
      state: failed
    }),
    true
  );
});

test("auto-buy does not launch while the helper is already running", () => {
  const state = createAutoBuyState();

  assert.equal(
    shouldLaunchAutoBuy({
      availability: "in_stock",
      isHelperRunning: true,
      now: 1_000,
      state
    }),
    false
  );
});
