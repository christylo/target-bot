import * as cheerio from "cheerio";

import type { Availability, SnapshotSource, StockSnapshot } from "../core/types.js";

const POSITIVE_SIGNALS = [
  "add to cart",
  "ship it",
  "available to ship",
  "in stock"
];

const NEGATIVE_SIGNALS = [
  "out of stock",
  "sold out",
  "temporarily out of stock",
  "unavailable",
  "not sold in stores"
];

const COMING_SOON_SIGNALS = ["coming soon", "preorder", "pre-order", "notify me when it's back"];

export function parseTargetPage(input: {
  html: string;
  fallbackUrl: string;
  sourceKind: "live-request" | "local-file" | "browser-session";
}): StockSnapshot {
  const $ = cheerio.load(input.html);
  const canonicalUrl = firstNonEmpty(
    $('link[rel="canonical"]').attr("href"),
    input.fallbackUrl
  );

  const productName = inferProductName($);
  const buttonText = normalizeText($("button, [role='button'], [data-test*='button']").text());
  const bodyText = normalizeText($("body").text());
  const addToCartState = inferAddToCartState($, productName);
  const strongPositiveText = normalizeText(
    collectStrongPositiveText($, input.html)
  ).toLowerCase();
  const negativeText = [buttonText, bodyText, input.html.replace(/<[^>]+>/g, " ")]
    .map((value) => normalizeText(value).toLowerCase())
    .join(" ");

  const structuredAvailability = inferStructuredAvailability(input.html);
  const positiveMatches = matchSignals(strongPositiveText, POSITIVE_SIGNALS);
  const negativeMatches = matchSignals(negativeText, NEGATIVE_SIGNALS);
  const comingSoonMatches = matchSignals(negativeText, COMING_SOON_SIGNALS);
  const browserCartState = input.sourceKind === "browser-session" && inferBrowserCartState(negativeText);

  const availability = classifyAvailability({
    addToCartState,
    structuredAvailability,
    positiveMatches,
    negativeMatches,
    comingSoonMatches,
    browserCartState
  });

  const signals = [
    ...(addToCartState ? [`add_to_cart:${addToCartState}`] : []),
    ...(structuredAvailability ? [`structured:${structuredAvailability}`] : []),
    ...(browserCartState ? ["browser:in_cart_state"] : []),
    ...positiveMatches,
    ...negativeMatches,
    ...comingSoonMatches
  ];

  const price = inferPrice($, input.html);
  const source = inferSource(input.sourceKind, structuredAvailability, signals.length);

  return {
    provider: "target",
    productName,
    productUrl: input.fallbackUrl,
    canonicalUrl,
    availability,
    price,
    checkedAt: new Date().toISOString(),
    source,
    signals: dedupe(signals),
    rawSummary: buildSummary({ buttonText, bodyText, structuredAvailability })
  };
}

function inferProductName($: cheerio.CheerioAPI): string {
  const rawTitle = firstNonEmpty(
    $('meta[property="og:title"]').attr("content"),
    $("title").text(),
    "Target product"
  );

  return rawTitle.replace(/\s*:\s*Target\s*$/i, "").trim();
}

function inferPrice($: cheerio.CheerioAPI, html: string): string | undefined {
  const explicitPrice = firstNonEmpty(
    $('meta[property="product:price:amount"]').attr("content"),
    $('meta[itemprop="price"]').attr("content"),
    html.match(/"formatted_current_price"\s*:\s*"(\$?[\d,]+(?:\.\d{2})?)"/i)?.[1],
    html.match(/"current_retail"\s*:\s*"?(\\?\$?[\d,]+(?:\.\d{2})?)"?/i)?.[1]?.replace(/\\/g, "")
  );

  if (explicitPrice) {
    return explicitPrice.startsWith("$") ? explicitPrice : `$${explicitPrice}`;
  }

  return undefined;
}

function inferStructuredAvailability(html: string): Availability | undefined {
  const schemaMatch = html.match(/schema\.org\/(InStock|OutOfStock|PreOrder|PreSale|LimitedAvailability)/i);
  if (schemaMatch) {
    return mapAvailabilityToken(schemaMatch[1]);
  }

  const rawMatch = html.match(/availability(?:_status)?["':\s]+(in_stock|out_of_stock|coming_soon|preorder)/i);
  if (rawMatch) {
    return mapAvailabilityToken(rawMatch[1]);
  }

  return undefined;
}

function mapAvailabilityToken(token: string): Availability {
  const normalized = token.toLowerCase();

  if (normalized.includes("instock")) {
    return "in_stock";
  }

  if (normalized.includes("outofstock") || normalized.includes("out_of_stock")) {
    return "out_of_stock";
  }

  if (
    normalized.includes("presale") ||
    normalized.includes("preorder") ||
    normalized.includes("coming_soon")
  ) {
    return "coming_soon";
  }

  if (normalized.includes("limitedavailability")) {
    return "in_stock";
  }

  return "unknown";
}

function classifyAvailability(input: {
  addToCartState?: "enabled" | "disabled";
  structuredAvailability?: Availability;
  positiveMatches: string[];
  negativeMatches: string[];
  comingSoonMatches: string[];
  browserCartState: boolean;
}): Availability {
  const explicitPositiveMatches = input.positiveMatches.filter((signal) => signal !== "add to cart");

  if (input.browserCartState) {
    return "in_stock";
  }

  if (input.addToCartState === "enabled") {
    return "in_stock";
  }

  if (input.structuredAvailability === "coming_soon" || input.comingSoonMatches.length > 0) {
    return "coming_soon";
  }

  if (input.structuredAvailability === "in_stock") {
    return "in_stock";
  }

  if (
    input.addToCartState === "disabled" &&
    explicitPositiveMatches.length > 0 &&
    input.negativeMatches.length === 0
  ) {
    return "in_stock";
  }

  if (input.addToCartState === "disabled") {
    return "out_of_stock";
  }

  if (input.structuredAvailability && input.structuredAvailability !== "unknown") {
    return input.structuredAvailability;
  }

  if (input.negativeMatches.length > 0 && input.positiveMatches.length === 0) {
    return "out_of_stock";
  }

  if (input.comingSoonMatches.length > 0 && input.positiveMatches.length === 0) {
    return "coming_soon";
  }

  if (input.positiveMatches.length > 0) {
    return "in_stock";
  }

  if (input.negativeMatches.length > 0) {
    return "out_of_stock";
  }

  return "unknown";
}

function inferBrowserCartState(text: string): boolean {
  return [
    /\bview cart\b/i,
    /\bview cart & check out\b/i,
    /\badded to cart\b/i,
    /\bcontinue shopping\b/i,
    /\bedit delivery method in cart\b/i,
    /\b\d+\s+in cart\b/i
  ].some((pattern) => pattern.test(text));
}

function inferAddToCartState(
  $: cheerio.CheerioAPI,
  productName: string
): "enabled" | "disabled" | undefined {
  const buttons = $("button")
    .toArray()
    .filter((element) => normalizeText($(element).text()).toLowerCase() === "add to cart");

  if (buttons.length === 0) {
    return undefined;
  }

  const productTokens = toMeaningfulTokens(productName);
  const matchingButtons = buttons.filter((element) => {
    const text = normalizeText($(element).text());
    const ariaLabel = normalizeText($(element).attr("aria-label") ?? "");
    const combined = `${text} ${ariaLabel}`.toLowerCase();

    if (productTokens.length === 0) {
      return true;
    }

    return productTokens.some((token) => combined.includes(token));
  });

  const candidateButtons = matchingButtons.length > 0 ? matchingButtons : buttons;

  const enabledButton = candidateButtons.find((element) => {
    const disabled = $(element).attr("disabled");
    const ariaDisabled = $(element).attr("aria-disabled");
    return disabled === undefined && ariaDisabled !== "true";
  });

  return enabledButton ? "enabled" : "disabled";
}

function collectStrongPositiveText($: cheerio.CheerioAPI, html: string): string {
  const fragments: string[] = [];

  $("button").each((_, element) => {
    const text = normalizeText($(element).text());
    if (text) {
      fragments.push(text);
    }
  });

  $("[data-test*='fulfillment'], [data-module-type*='Fulfillment']").each((_, element) => {
    const text = normalizeText($(element).text());
    if (text) {
      fragments.push(text);
    }
  });

  $("[data-test*='availability'], [data-test*='shipping'], [data-test*='ship'], .fulfillment-message").each(
    (_, element) => {
      const text = normalizeText($(element).text());
      if (text) {
        fragments.push(text);
      }
    }
  );

  const addToCartSnippet = html.match(/<button\b[^>]*>\s*Add to cart\s*<\/button>/gi) ?? [];
  fragments.push(...addToCartSnippet);

  return fragments.join(" ");
}

function inferSource(
  sourceKind: "live-request" | "local-file" | "browser-session",
  structuredAvailability: Availability | undefined,
  signalCount: number
): SnapshotSource {
  if (sourceKind === "local-file") {
    return "local-file";
  }

  if (sourceKind === "browser-session") {
    return "browser-session";
  }

  if (structuredAvailability && signalCount > 0) {
    return "mixed";
  }

  if (structuredAvailability) {
    return "structured-data";
  }

  return "dom-text";
}

function buildSummary(input: {
  buttonText: string;
  bodyText: string;
  structuredAvailability?: Availability;
}): string {
  const bodyExcerpt = input.bodyText.slice(0, 240);
  const buttonExcerpt = input.buttonText.slice(0, 120);
  const parts = [
    input.structuredAvailability ? `structured=${input.structuredAvailability}` : undefined,
    buttonExcerpt ? `buttons="${buttonExcerpt}"` : undefined,
    bodyExcerpt ? `body="${bodyExcerpt}"` : undefined
  ].filter(Boolean);

  return parts.join(" | ");
}

function matchSignals(text: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => text.includes(pattern));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  return values.find((value) => Boolean(value && value.trim()))?.trim() ?? "";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function toMeaningfulTokens(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}
