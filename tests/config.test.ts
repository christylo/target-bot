import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const TEST_TARGET_PRODUCT_URL = "https://www.target.com/p/example-product/-/A-00000000#lnk=sametab";

const ENV_KEYS = [
  "TARGET_PRODUCT_URL",
  "POLL_INTERVAL_MS",
  "REQUEST_TIMEOUT_MS",
  "STATE_FILE",
  "ALERT_COOLDOWN_MS",
  "ALERT_ON_AVAILABILITY_CHANGE",
  "SOUND_ALERT",
  "OPEN_PRODUCT_ON_ALERT",
  "TARGET_COOKIE_HEADER",
  "TARGET_USER_AGENT",
  "TARGET_EXTRA_HEADERS_JSON",
  "TARGET_HTML_FILE",
  "TARGET_PROFILE_DIR",
  "TARGET_LOGIN_URL",
  "TARGET_CART_URL",
  "TARGET_CHECKOUT_QUANTITY",
  "TARGET_HELPER_HEADLESS",
  "TARGET_HELPER_PROCEED_TO_CHECKOUT",
  "TARGET_HELPER_MAX_CHECKOUT_STEPS",
  "DISCORD_WEBHOOK_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "ALERT_EMAIL_FROM",
  "ALERT_EMAIL_TO"
] as const;

function withEnv(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void
): void {
  const snapshot = new Map((ENV_KEYS as readonly string[]).map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loadConfig parses the tracker settings and SMTP config", () => {
  withEnv(
    {
      TARGET_PRODUCT_URL: TEST_TARGET_PRODUCT_URL,
      POLL_INTERVAL_MS: "7500",
      REQUEST_TIMEOUT_MS: "15000",
      STATE_FILE: ".data/custom-state.json",
      ALERT_COOLDOWN_MS: "600000",
      ALERT_ON_AVAILABILITY_CHANGE: "false",
      SOUND_ALERT: "0",
      OPEN_PRODUCT_ON_ALERT: "yes",
      TARGET_COOKIE_HEADER: "some-cookie=value",
      TARGET_USER_AGENT: "Test Agent",
      TARGET_EXTRA_HEADERS_JSON: '{"x-store-id":"1234"}',
      TARGET_HTML_FILE: "target.html",
      TARGET_PROFILE_DIR: ".data/custom-profile",
      TARGET_LOGIN_URL: "https://www.target.com/login",
      TARGET_CART_URL: "https://www.target.com/co-cart",
      TARGET_CHECKOUT_QUANTITY: "2",
      TARGET_HELPER_HEADLESS: "true",
      TARGET_HELPER_PROCEED_TO_CHECKOUT: "false",
      TARGET_HELPER_MAX_CHECKOUT_STEPS: "12",
      DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "2525",
      SMTP_SECURE: "true",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      ALERT_EMAIL_FROM: "from@example.com",
      ALERT_EMAIL_TO: "to@example.com"
    },
    () => {
      const config = loadConfig();

      assert.equal(config.targetProductUrl, TEST_TARGET_PRODUCT_URL);
      assert.equal(config.pollIntervalMs, 7500);
      assert.equal(config.requestTimeoutMs, 15000);
      assert.equal(config.stateFile, ".data/custom-state.json");
      assert.equal(config.alertCooldownMs, 600000);
      assert.equal(config.alertOnAvailabilityChange, false);
      assert.equal(config.soundAlert, false);
      assert.equal(config.openProductOnAlert, true);
      assert.equal(config.targetCookieHeader, "some-cookie=value");
      assert.equal(config.targetUserAgent, "Test Agent");
      assert.deepEqual(config.targetExtraHeaders, { "x-store-id": "1234" });
      assert.equal(config.targetHtmlFile, "target.html");
      assert.equal(config.targetProfileDir, ".data/custom-profile");
      assert.equal(config.targetLoginUrl, "https://www.target.com/login");
      assert.equal(config.targetCartUrl, "https://www.target.com/co-cart");
      assert.equal(config.targetCheckoutQuantity, 2);
      assert.equal(config.targetHelperHeadless, true);
      assert.equal(config.targetHelperProceedToCheckout, false);
      assert.equal(config.targetHelperMaxCheckoutSteps, 12);
      assert.equal(config.discordWebhookUrl, "https://discord.example/webhook");
      assert.deepEqual(config.smtp, {
        host: "smtp.example.com",
        port: 2525,
        secure: true,
        user: "user",
        pass: "pass",
        from: "from@example.com",
        to: "to@example.com"
      });
    }
  );
});

test("loadConfig requires either a product URL or a local HTML file", () => {
  withEnv({}, () => {
    assert.throws(() => loadConfig(), /Set TARGET_PRODUCT_URL or TARGET_HTML_FILE/);
  });
});

test("loadConfig rejects invalid extra header JSON", () => {
  withEnv(
    {
      TARGET_PRODUCT_URL: TEST_TARGET_PRODUCT_URL,
      TARGET_EXTRA_HEADERS_JSON: "{not-json}"
    },
    () => {
      assert.throws(() => loadConfig(), /TARGET_EXTRA_HEADERS_JSON must be valid JSON/);
    }
  );
});
