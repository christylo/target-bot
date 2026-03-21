import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import os from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AppConfig } from "../src/config.js";
import { Tracker } from "../src/core/tracker.js";
import type { Notifier } from "../src/core/types.js";
import { parseTargetPage } from "../src/providers/target.js";

const TEST_TARGET_PRODUCT_URL = "https://www.target.com/p/example-product/-/A-00000000#lnk=sametab";

const fixturePath = path.resolve(process.cwd(), "target-pdp.html");
const html = fs.readFileSync(fixturePath, "utf8");

test("parses the Target product title and canonical URL", () => {
  const result = parseTargetPage({
    html,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });
  assert.equal(result.productName, "BTS OFFICIAL LIGHT STICK VER.4");
  assert.equal(
    result.canonicalUrl,
    "https://www.target.com/p/bts-official-light-stick-ver-4/-/A-95160660"
  );
  assert.equal(result.productUrl, "https://example.com/fallback");
});

test("treats a disabled add-to-cart button as out of stock", () => {
  const result = parseTargetPage({
    html,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });
  assert.equal(result.availability, "out_of_stock");
  assert.ok(result.signals.includes("add_to_cart:disabled"));
});

test("treats an enabled add-to-cart button as in stock", () => {
  const result = parseTargetPage({
    html: html.replace(/<button([^>]*)disabled=\"\"([^>]*)>\s*Add to cart/i, "<button$1$2>Add to cart"),
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });

  assert.equal(result.availability, "in_stock");
  assert.ok(result.signals.includes("add_to_cart:enabled"));
});

test("ignores enabled recommendation add-to-cart buttons when the product-specific button is disabled", () => {
  const result = parseTargetPage({
    html: `
      <html>
        <head>
          <title>BTS OFFICIAL LIGHT STICK VER.4 : Target</title>
        </head>
        <body>
          <button aria-label="Add to cart for BTS OFFICIAL LIGHT STICK VER.4" disabled="">Add to cart</button>
          <button aria-label="Add to cart for Some Other Product">Add to cart</button>
        </body>
      </html>
    `,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "browser-session"
  });

  assert.equal(result.availability, "out_of_stock");
  assert.ok(result.signals.includes("add_to_cart:disabled"));
});

test("keeps explicit coming soon state even when add to cart is disabled", () => {
  const result = parseTargetPage({
    html: `${html} <div>coming soon</div>`,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });

  assert.equal(result.availability, "coming_soon");
});

test("treats disabled add-to-cart as in stock when explicit shipping availability is present", () => {
  const result = parseTargetPage({
    html: `${html}
      <div data-test="availability-message">In Stock</div>
      <div data-test="shipping-message">Available to ship</div>
    `,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });

  assert.equal(result.availability, "in_stock");
  assert.ok(result.signals.includes("in stock"));
  assert.ok(result.signals.includes("available to ship"));
});

test("does not mark the page in stock when add to cart is absent and only generic pickup copy remains", () => {
  const result = parseTargetPage({
    html: html
      .replace(/<button\b[^>]*>\s*Add to cart\s*<\/button>/i, "")
      .replace(/in stock/gi, ""),
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "local-file"
  });

  assert.notEqual(result.availability, "in_stock");
});

test("treats browser-side added-to-cart state as in stock", () => {
  const result = parseTargetPage({
    html: `
      <html>
        <body>
          <button>Continue shopping</button>
          <button>View cart & check out</button>
          <div>Added to cart</div>
          <div>Edit delivery method in cart</div>
        </body>
      </html>
    `,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "browser-session"
  });

  assert.equal(result.availability, "in_stock");
  assert.ok(result.signals.includes("browser:in_cart_state"));
});

test("treats browser-side added-to-cart state with spaced check out copy as in stock", () => {
  const result = parseTargetPage({
    html: `
      <html>
        <body>
          <button>Continue shopping</button>
          <button>View cart & check out</button>
          <div>Added to cart</div>
        </body>
      </html>
    `,
    fallbackUrl: "https://example.com/fallback",
    sourceKind: "browser-session"
  });

  assert.equal(result.availability, "in_stock");
  assert.ok(result.signals.includes("browser:in_cart_state"));
});

test("does not record lastAlertedAt when every notifier fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "army-bomb-tracker-"));
  const fixtureFile = path.join(tempDir, "in-stock.html");
  const stateFile = path.join(tempDir, "state.json");
  const inStockHtml = html.replace(
    /<button([^>]*)disabled=\"\"([^>]*)>\s*Add to cart/i,
    "<button$1$2>Add to cart"
  );

  await writeFile(fixtureFile, inStockHtml, "utf8");

  const config: AppConfig = {
    targetProductUrl: TEST_TARGET_PRODUCT_URL,
    pollIntervalMs: 1000,
    requestTimeoutMs: 1000,
    stateFile,
    alertCooldownMs: 1000,
    alertOnAvailabilityChange: true,
    soundAlert: false,
    openProductOnAlert: false,
    targetCookieHeader: undefined,
    targetUserAgent: undefined,
    targetExtraHeaders: {},
    targetHtmlFile: fixtureFile,
    discordWebhookUrl: undefined,
    smtp: undefined
  };

  const failingNotifier: Notifier = {
    name: "failing",
    async notify() {
      throw new Error("boom");
    }
  };

  const tracker = new Tracker(config, [failingNotifier]);
  const result = await tracker.checkOnce();
  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    products: Record<string, { lastAlertedAt?: string }>;
  };

  assert.equal(result.alertSent, false);
  assert.equal(Object.values(saved.products)[0]?.lastAlertedAt, undefined);
});
