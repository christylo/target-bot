import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import { loadHtml } from "../utils/http.js";
import { openUrl } from "../utils/runtime.js";
import { parseTargetPage } from "../providers/target.js";
import type { AlertMessage, Notifier, StockSnapshot, StoredState } from "./types.js";
import { StateStore } from "./state-store.js";

export interface CheckResult {
  snapshot: StockSnapshot;
  previous?: StoredState;
  availabilityChanged: boolean;
  alertSent: boolean;
}

export class Tracker {
  private readonly stateStore: StateStore;

  constructor(
    private readonly config: AppConfig,
    private readonly notifiers: Notifier[]
  ) {
    this.stateStore = new StateStore(config.stateFile);
  }

  async checkOnce(): Promise<CheckResult> {
    const url = this.config.targetProductUrl ?? this.config.targetHtmlFile ?? "local-file";
    const source = await loadHtml({
      url: this.config.targetProductUrl,
      filePath: this.config.targetHtmlFile,
      timeoutMs: this.config.requestTimeoutMs,
      cookieHeader: this.config.targetCookieHeader,
      userAgent: this.config.targetUserAgent,
      extraHeaders: this.config.targetExtraHeaders
    });

    const snapshot = parseTargetPage({
      html: source.html,
      fallbackUrl: url,
      sourceKind: source.source
    });

    return this.recordSnapshot(snapshot);
  }

  async recordSnapshot(snapshot: StockSnapshot): Promise<CheckResult> {
    const data = await this.stateStore.read();
    const key = buildKey(snapshot.canonicalUrl || snapshot.productUrl);
    const previous = data.products[key];
    const now = new Date();
    const availabilityChanged = previous?.availability !== snapshot.availability;

    const nextState: StoredState = {
      productName: snapshot.productName,
      productUrl: snapshot.canonicalUrl || snapshot.productUrl,
      availability: snapshot.availability,
      price: snapshot.price,
      lastCheckedAt: snapshot.checkedAt,
      lastChangedAt: availabilityChanged || !previous ? snapshot.checkedAt : previous.lastChangedAt,
      lastAlertedAt: previous?.lastAlertedAt
    };

    const shouldAlert = this.shouldAlert(previous, snapshot, now);

    let alertError: string | undefined;

    if (shouldAlert) {
      const message = buildAlertMessage(snapshot, previous, availabilityChanged);
      alertError = await this.dispatch(message);
      if (!alertError) {
        nextState.lastAlertedAt = now.toISOString();

        if (this.config.soundAlert) {
          process.stdout.write("\u0007");
        }

        if (this.config.openProductOnAlert && snapshot.canonicalUrl.startsWith("http")) {
          await openUrl(snapshot.canonicalUrl);
        }
      }
    }

    data.products[key] = nextState;
    await this.stateStore.write(data);
    logSnapshot(snapshot, previous, availabilityChanged, shouldAlert);
    if (alertError) {
      console.error(`Alert delivery issue: ${alertError}`);
    }

    return {
      snapshot,
      previous,
      availabilityChanged,
      alertSent: shouldAlert && !alertError
    };
  }

  private shouldAlert(
    previous: StoredState | undefined,
    snapshot: StockSnapshot,
    now: Date
  ): boolean {
    const inStock = snapshot.availability === "in_stock";
    const availabilityChanged = previous?.availability !== snapshot.availability;

    if (!previous) {
      return inStock;
    }

    if (availabilityChanged && this.config.alertOnAvailabilityChange) {
      return true;
    }

    if (!inStock || !previous.lastAlertedAt) {
      return false;
    }

    const elapsed = now.getTime() - new Date(previous.lastAlertedAt).getTime();
    return elapsed >= this.config.alertCooldownMs;
  }

  private async dispatch(message: AlertMessage): Promise<string | undefined> {
    const failures: string[] = [];

    for (const notifier of this.notifiers) {
      try {
        await notifier.notify(message);
      } catch (error) {
        failures.push(`${notifier.name}: ${(error as Error).message}`);
      }
    }

    return failures.length > 0 ? failures.join(", ") : undefined;
  }
}

function buildAlertMessage(
  snapshot: StockSnapshot,
  previous: StoredState | undefined,
  availabilityChanged: boolean
): AlertMessage {
  const subjectPrefix =
    snapshot.availability === "in_stock"
      ? "IN STOCK"
      : availabilityChanged
        ? "Availability changed"
        : "Stock reminder";

  const subject = `[Army Bomb Tracker] ${subjectPrefix}: ${snapshot.productName}`;
  const bodyLines = [
    `Availability: ${snapshot.availability}`,
    previous ? `Previous: ${previous.availability}` : "Previous: none",
    snapshot.price ? `Price: ${snapshot.price}` : undefined,
    `Checked at: ${snapshot.checkedAt}`,
    `Signals: ${snapshot.signals.join(", ") || "none"}`,
    `Source: ${snapshot.source}`,
    `URL: ${snapshot.canonicalUrl || snapshot.productUrl}`,
    "",
    snapshot.rawSummary
  ].filter(Boolean);

  return {
    subject,
    body: bodyLines.join("\n")
  };
}

function logSnapshot(
  snapshot: StockSnapshot,
  previous: StoredState | undefined,
  availabilityChanged: boolean,
  alertSent: boolean
): void {
  console.log(
    `[${snapshot.checkedAt}] ${snapshot.productName} -> ${snapshot.availability}` +
      `${snapshot.price ? ` (${snapshot.price})` : ""}`
  );
  console.log(`source=${snapshot.source} signals=${snapshot.signals.join(", ") || "none"}`);
  console.log(`previous=${previous?.availability ?? "none"} changed=${availabilityChanged} alert=${alertSent}`);
  console.log(`url=${snapshot.canonicalUrl || snapshot.productUrl}`);
}

function buildKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
