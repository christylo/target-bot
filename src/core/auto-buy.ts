import type { Availability } from "./types.js";

const DEFAULT_RETRY_COOLDOWN_MS = 10_000;

export interface AutoBuyState {
  launchedForCurrentInStock: boolean;
  nextAllowedLaunchAt: number;
}

export function createAutoBuyState(): AutoBuyState {
  return {
    launchedForCurrentInStock: false,
    nextAllowedLaunchAt: 0
  };
}

export function shouldLaunchAutoBuy(input: {
  availability: Availability;
  isHelperRunning: boolean;
  now: number;
  state: AutoBuyState;
}): boolean {
  if (input.availability !== "in_stock") {
    return false;
  }

  if (input.isHelperRunning) {
    return false;
  }

  if (input.state.launchedForCurrentInStock) {
    return false;
  }

  return input.now >= input.state.nextAllowedLaunchAt;
}

export function recordAutoBuyLaunch(state: AutoBuyState): AutoBuyState {
  return {
    ...state,
    launchedForCurrentInStock: true
  };
}

export function recordAutoBuyFailure(
  state: AutoBuyState,
  now: number,
  retryCooldownMs = DEFAULT_RETRY_COOLDOWN_MS
): AutoBuyState {
  return {
    launchedForCurrentInStock: false,
    nextAllowedLaunchAt: now + retryCooldownMs
  };
}

export function reconcileAutoBuyState(state: AutoBuyState, availability: Availability): AutoBuyState {
  if (availability === "in_stock") {
    return state;
  }

  return {
    launchedForCurrentInStock: false,
    nextAllowedLaunchAt: 0
  };
}
