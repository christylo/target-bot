import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  TARGET_PRODUCT_URL: z.string().trim().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  STATE_FILE: z.string().trim().default(".data/state.json"),
  ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  ALERT_ON_AVAILABILITY_CHANGE: booleanFromEnv.default(true),
  SOUND_ALERT: booleanFromEnv.default(true),
  OPEN_PRODUCT_ON_ALERT: booleanFromEnv.default(false),
  TARGET_COOKIE_HEADER: z.string().trim().optional(),
  TARGET_USER_AGENT: z.string().trim().optional(),
  TARGET_EXTRA_HEADERS_JSON: z.string().trim().optional(),
  TARGET_HTML_FILE: z.string().trim().optional(),
  TARGET_PROFILE_DIR: z.string().trim().default(".data/target-profile"),
  TARGET_LOGIN_URL: z.string().trim().url().default("https://www.target.com/login"),
  TARGET_CART_URL: z.string().trim().url().default("https://www.target.com/co-cart"),
  TARGET_CHECKOUT_QUANTITY: z.coerce.number().int().positive().max(10).default(1),
  TARGET_HELPER_HEADLESS: booleanFromEnv.default(false),
  TARGET_HELPER_PROCEED_TO_CHECKOUT: booleanFromEnv.default(true),
  TARGET_HELPER_MAX_CHECKOUT_STEPS: z.coerce.number().int().positive().default(8),
  DISCORD_WEBHOOK_URL: z.string().trim().url().optional(),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFromEnv.default(false),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().trim().optional(),
  ALERT_EMAIL_FROM: z.string().trim().optional(),
  ALERT_EMAIL_TO: z.string().trim().optional()
});

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

export interface AppConfig {
  targetProductUrl?: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  stateFile: string;
  alertCooldownMs: number;
  alertOnAvailabilityChange: boolean;
  soundAlert: boolean;
  openProductOnAlert: boolean;
  targetCookieHeader?: string;
  targetUserAgent?: string;
  targetExtraHeaders: Record<string, string>;
  targetHtmlFile?: string;
  targetProfileDir: string;
  targetLoginUrl: string;
  targetCartUrl: string;
  targetCheckoutQuantity: number;
  targetHelperHeadless: boolean;
  targetHelperProceedToCheckout: boolean;
  targetHelperMaxCheckoutSteps: number;
  discordWebhookUrl?: string;
  smtp?: SmtpConfig;
}

export interface ConfigOverrides {
  targetProductUrl?: string;
}

export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  const parsed = envSchema.parse(process.env);
  const targetProductUrl = overrides.targetProductUrl?.trim() || parsed.TARGET_PRODUCT_URL;
  const targetHtmlFile = overrides.targetProductUrl?.trim() ? undefined : parsed.TARGET_HTML_FILE;

  if (!targetProductUrl && !targetHtmlFile) {
    throw new Error("Set TARGET_PRODUCT_URL or TARGET_HTML_FILE in .env before running the tracker.");
  }

  const targetExtraHeaders = parseExtraHeaders(parsed.TARGET_EXTRA_HEADERS_JSON);
  const smtp = buildSmtpConfig(parsed);

  return {
    targetProductUrl,
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    stateFile: parsed.STATE_FILE,
    alertCooldownMs: parsed.ALERT_COOLDOWN_MS,
    alertOnAvailabilityChange: parsed.ALERT_ON_AVAILABILITY_CHANGE,
    soundAlert: parsed.SOUND_ALERT,
    openProductOnAlert: parsed.OPEN_PRODUCT_ON_ALERT,
    targetCookieHeader: parsed.TARGET_COOKIE_HEADER,
    targetUserAgent: parsed.TARGET_USER_AGENT,
    targetExtraHeaders,
    targetHtmlFile,
    targetProfileDir: parsed.TARGET_PROFILE_DIR,
    targetLoginUrl: parsed.TARGET_LOGIN_URL,
    targetCartUrl: parsed.TARGET_CART_URL,
    targetCheckoutQuantity: parsed.TARGET_CHECKOUT_QUANTITY,
    targetHelperHeadless: parsed.TARGET_HELPER_HEADLESS,
    targetHelperProceedToCheckout: parsed.TARGET_HELPER_PROCEED_TO_CHECKOUT,
    targetHelperMaxCheckoutSteps: parsed.TARGET_HELPER_MAX_CHECKOUT_STEPS,
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
    smtp
  };
}

function parseExtraHeaders(value?: string): Record<string, string> {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`TARGET_EXTRA_HEADERS_JSON must be valid JSON: ${(error as Error).message}`);
  }

  const headerSchema = z.record(z.string(), z.string());
  return headerSchema.parse(parsed);
}

function buildSmtpConfig(input: z.infer<typeof envSchema>): SmtpConfig | undefined {
  const required = [
    input.SMTP_HOST,
    input.SMTP_USER,
    input.SMTP_PASS,
    input.ALERT_EMAIL_FROM,
    input.ALERT_EMAIL_TO
  ];

  if (required.every(Boolean)) {
    return {
      host: input.SMTP_HOST!,
      port: input.SMTP_PORT,
      secure: input.SMTP_SECURE,
      user: input.SMTP_USER!,
      pass: input.SMTP_PASS!,
      from: input.ALERT_EMAIL_FROM!,
      to: input.ALERT_EMAIL_TO!
    };
  }

  return undefined;
}
