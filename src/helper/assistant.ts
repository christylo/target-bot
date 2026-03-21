import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

import type { AppConfig } from "../config.js";

export type HelperCommand = "login" | "buy";

interface BuyFlowOptions {
  useCurrentPage?: boolean;
  currentPagePrepared?: boolean;
}

const FINALIZE_PATTERNS = [
  /place order/i,
  /submit order/i,
  /complete purchase/i,
  /pay now/i,
  /confirm order/i
];

const ADVANCE_PATTERNS = [
  /check out/i,
  /^checkout$/i,
  /continue to checkout/i,
  /continue to payment/i,
  /continue to review/i,
  /review order/i,
  /save and continue/i,
  /continue/i,
  /use this address/i,
  /deliver to this address/i,
  /use this payment/i,
  /use selected payment/i,
  /continue with saved payment/i
];

const IN_CART_PATTERNS = [
  /\bin cart\b/i,
  /\b\d+\s+in cart\b/i
];

const CART_ENTRY_PATTERNS = [
  /view cart/i,
  /go to cart/i,
  /view cart & checkout/i,
  /view cart & check out/i,
  /checkout/i
];

const SIDECART_READY_PATTERNS = [
  /added to cart/i,
  /continue shopping/i,
  /edit delivery method in cart/i
];

const POLL_INTERVAL_MS = 100;
const SHORT_SETTLE_MS = 100;
const MEDIUM_SETTLE_MS = 250;
const FAST_CLICK_TIMEOUT_MS = 1_500;
const LOCATOR_READ_TIMEOUT_MS = 250;

interface TimingLogger {
  sinceStart(label: string): void;
  sinceLast(label: string): void;
}

export async function runAssistant(command: HelperCommand, config: AppConfig): Promise<void> {
  const context = await launchPersistentTargetContext(config);
  const page = await ensureAssistantPage(context);

  try {
    if (command === "login") {
      await runLoginFlow(page, config);
      return;
    }

    await runBuyFlowOnPage(page, config);
  } finally {
    await context.close();
  }
}

export async function launchPersistentTargetContext(config: AppConfig): Promise<BrowserContext> {
  await mkdir(config.targetProfileDir, { recursive: true });

  return chromium.launchPersistentContext(config.targetProfileDir, {
    headless: config.targetHelperHeadless,
    viewport: { width: 1440, height: 960 }
  });
}

export async function ensureAssistantPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

async function runLoginFlow(page: Page, config: AppConfig): Promise<void> {
  console.log(`Opening Target login flow in profile: ${config.targetProfileDir}`);
  console.log("Log in manually in the opened browser window, then press Ctrl+C here when you're done.");
  await page.goto(config.targetLoginUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page, MEDIUM_SETTLE_MS);
  await waitForInterrupt();
}

export async function runBuyFlowOnPage(
  page: Page,
  config: AppConfig,
  options: BuyFlowOptions = {}
): Promise<void> {
  if (!config.targetProductUrl) {
    throw new Error("TARGET_PRODUCT_URL must be set for the buy helper.");
  }

  const timing = createTimingLogger();
  console.log(`Using persistent Target profile: ${config.targetProfileDir}`);
  timing.sinceStart("starting buy flow");
  if (options.useCurrentPage) {
    timing.sinceLast("reusing current product page from browser watch");
    if (!options.currentPagePrepared) {
      await settleDomOnly(page, SHORT_SETTLE_MS);
      timing.sinceLast("current product page settled");
    }
  } else {
    await page.goto(config.targetProductUrl, { waitUntil: "domcontentloaded" });
    timing.sinceLast("product page reached domcontentloaded");
    await settleDomOnly(page, SHORT_SETTLE_MS);
    timing.sinceLast("product page settled after domcontentloaded");
  }

  if (await requiresLogin(page)) {
    throw new Error(
      `Target appears to need authentication. Run "npm run helper:login" first and sign in manually in the persistent browser profile.`
    );
  }

  if (!options.currentPagePrepared) {
    await preferShippingOnProductPage(page);
    timing.sinceLast("product-page shipping preference handled");
  } else {
    timing.sinceLast("product-page shipping preference already prepared");
  }

  const addToCart = await waitForProductAddToCartButton(page, config.targetProductUrl);
  timing.sinceLast("product-specific add-to-cart lookup finished");
  if (!addToCart) {
    const inCartIndicator = await findInCartIndicator(page);
    if (inCartIndicator) {
      const label = await locatorLabel(inCartIndicator);
      console.log(`Product appears to already be in cart via "${label}". Going directly to cart.`);
      await page.goto(config.targetCartUrl, { waitUntil: "domcontentloaded" });
      await ensureCartOrCheckoutContext(page, config.targetCartUrl, "in-cart indicator");
      timing.sinceLast("navigated directly to cart");
      await settlePage(page, MEDIUM_SETTLE_MS);
      timing.sinceLast("cart page settled");
      await preferShippingInCart(page);
      timing.sinceLast("shipping preference handled");
      await enforceSingleQuantity(page);
      timing.sinceLast("quantity enforcement handled");
      if (config.targetHelperProceedToCheckout) {
        await driveCheckout(page, config.targetHelperMaxCheckoutSteps);
        timing.sinceLast("checkout automation finished");
      }

      console.log("Reached the handoff point. The browser is paused before final order submission.");
      console.log(`Current page: ${page.url()}`);
      console.log("Make the final click yourself, then press Ctrl+C here when you're done.");
      await waitForInterrupt();
      return;
    }

    const cartEntryAction = await findCartEntryAction(page);
    if (cartEntryAction) {
      const label = await locatorLabel(cartEntryAction);
      console.log(`Product appears to already be in cart. Following "${label}".`);
      timing.sinceLast(`clicking cart entry action "${label}"`);
      await quickClick(cartEntryAction);
      await settleAfterAction(page);
      await ensureCartOrCheckoutContext(page, config.targetCartUrl, `cart entry action "${label}"`);
      timing.sinceLast("cart entry action settled");
      await preferShippingInCart(page);
      timing.sinceLast("shipping preference handled");
      await enforceSingleQuantity(page);
      timing.sinceLast("quantity enforcement handled");
      if (config.targetHelperProceedToCheckout) {
        await driveCheckout(page, config.targetHelperMaxCheckoutSteps);
        timing.sinceLast("checkout automation finished");
      }

      console.log("Reached the handoff point. The browser is paused before final order submission.");
      console.log(`Current page: ${page.url()}`);
      console.log("Make the final click yourself, then press Ctrl+C here when you're done.");
      await waitForInterrupt();
      return;
    }

    const diagnostics = await collectPurchaseDiagnostics(page);
    throw new Error(`Could not find a visible product-specific Add to cart button.\n${diagnostics}`);
  }

  if (await addToCart.isDisabled()) {
    const diagnostics = await collectPurchaseDiagnostics(page);
    throw new Error(
      `The product-specific Add to cart button is visible but disabled, so the item does not look purchasable yet. ` +
        `On Target PDPs with multiple variants or recommendation modules, other enabled Add to cart buttons can still belong ` +
        `to different products and are intentionally ignored.\n${diagnostics}`
    );
  }

  console.log("Add to cart is enabled. Attempting to add one item.");
  timing.sinceLast("clicking add to cart");
  await clickAddToCart(addToCart);

  await waitForCartState(page);
  timing.sinceLast("cart state detected after add to cart");
  if (await requiresLogin(page)) {
    throw new Error(
      `Target redirected to sign-in during add-to-cart. Run "npm run helper:login" first and reuse that profile.`
    );
  }

  await navigateToCart(page, config.targetCartUrl);
  await ensureCartOrCheckoutContext(page, config.targetCartUrl, "cart navigation");
  timing.sinceLast("cart navigation finished");
  await preferShippingInCart(page);
  timing.sinceLast("shipping preference handled");
  await enforceSingleQuantity(page);
  timing.sinceLast("quantity enforcement handled");

  if (config.targetHelperProceedToCheckout) {
    await driveCheckout(page, config.targetHelperMaxCheckoutSteps);
    timing.sinceLast("checkout automation finished");
  }

  console.log("Reached the handoff point. The browser is paused before final order submission.");
  console.log(`Current page: ${page.url()}`);
  console.log("Make the final click yourself, then press Ctrl+C here when you're done.");
  await waitForInterrupt();
}

export async function requiresLogin(page: Page): Promise<boolean> {
  if (/login|auth|signin/i.test(page.url())) {
    return true;
  }

  const signInPrompt = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await safeIsVisible(signInPrompt)) {
    return true;
  }

  const signInLink = page.getByRole("link", { name: /^sign in$/i }).first();
  return safeIsVisible(signInLink);
}

async function waitForProductAddToCartButton(
  page: Page,
  targetProductUrl?: string
): Promise<Locator | null> {
  const deadline = Date.now() + 20_000;
  let disabledCandidate: Locator | null = null;

  while (Date.now() < deadline) {
    if (await findInCartIndicator(page)) {
      return null;
    }

    if (await findCartEntryAction(page)) {
      return null;
    }

    const button = await findProductAddToCartButton(page, targetProductUrl);
    if (button) {
      if (!(await safeIsDisabled(button))) {
        return button;
      }

      disabledCandidate = button;
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  return disabledCandidate;
}

async function findProductAddToCartButton(
  page: Page,
  targetProductUrl?: string
): Promise<Locator | null> {
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  const inferredName = await inferProductNameFromPage(page);
  const nameTokens = dedupe([
    ...toMeaningfulTokens(inferredName),
    ...toMeaningfulTokens(inferProductSlugFromUrl(targetProductUrl))
  ]);
  let fallback: Locator | null = null;

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await safeIsVisible(button))) {
      continue;
    }

    const text = await safeInnerText(button);
    const ariaLabel = await safeAttribute(button, "aria-label");
    const combined = `${text} ${ariaLabel}`.toLowerCase();

    if (!combined.includes("add to cart")) {
      continue;
    }

    fallback ??= button;

    if (nameTokens.length > 0 && nameTokens.some((token) => combined.includes(token))) {
      return button;
    }
  }

  return fallback;
}

async function inferProductNameFromPage(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { level: 1 }).first();
  const headingText = await safeInnerText(heading);
  if (headingText) {
    return headingText;
  }

  const title = await page.title().catch(() => "");
  return normalizeWhitespace(title.replace(/\s*:\s*Target\s*$/i, ""));
}

function inferProductSlugFromUrl(targetProductUrl?: string): string {
  if (!targetProductUrl) {
    return "";
  }

  try {
    const url = new URL(targetProductUrl);
    const match = url.pathname.match(/\/p\/(.+?)\/-\/A-/i);
    return normalizeWhitespace((match?.[1] ?? "").replace(/-/g, " "));
  } catch {
    return "";
  }
}

async function navigateToCart(page: Page, cartUrl: string): Promise<void> {
  const cartAction =
    (await findCartEntryAction(page)) ??
    page.getByRole("button", { name: /view cart|view cart & checkout|checkout/i }).first();

  if (await safeIsVisible(cartAction)) {
    await quickClick(cartAction);
    await settleDomOnly(page, SHORT_SETTLE_MS);
    return;
  }

  await page.goto(cartUrl, { waitUntil: "domcontentloaded" });
  await settleDomOnly(page, SHORT_SETTLE_MS);
}

export async function preferShippingOnProductPage(page: Page): Promise<void> {
  if (!/\/p\//i.test(page.url())) {
    return;
  }

  const shippingCandidates: Locator[] = [
    page.locator('[data-test="fulfillment-cell-shipping"]').first(),
    page.locator(
      "#above-the-fold-information .styles_fulfillmentOptionsWrapper__8Ms7T > button:nth-child(3)"
    ).first()
  ];

  for (const candidate of shippingCandidates) {
    if (!(await safeIsVisible(candidate))) {
      continue;
    }

    const label = await locatorLabel(candidate);
    if (/selected/i.test(label)) {
      console.log(`Shipping already selected on product page via "${label}".`);
      return;
    }

    console.log(`Selecting Shipping on product page via "${label || "shipping option"}".`);
    await quickClick(candidate);
    await settleAfterAction(page);
    return;
  }
}

async function ensureCartOrCheckoutContext(
  page: Page,
  cartUrl: string,
  source: string
): Promise<void> {
  if (isCartLikeUrl(page.url()) || isCheckoutLikeUrl(page.url())) {
    return;
  }

  console.log(`Current page after ${source} was not cart/checkout (${page.url()}). Redirecting to cart.`);
  await page.goto(cartUrl, { waitUntil: "domcontentloaded" });
  await settleDomOnly(page, SHORT_SETTLE_MS);
}

async function enforceSingleQuantity(page: Page): Promise<void> {
  const quantitySelect = page.locator("select").filter({
    has: page.locator("option[value='1'], option:has-text('1')")
  }).first();

  if (await safeIsVisible(quantitySelect)) {
    await quantitySelect.selectOption("1").catch(() => quantitySelect.selectOption({ label: "1" }));
    return;
  }

  const quantityButton = page.getByRole("button", { name: /qty|quantity/i }).first();
  if (await safeIsVisible(quantityButton)) {
    await quantityButton.click();
    const oneOption = page.getByRole("option", { name: /^1$/i }).first();
    if (await safeIsVisible(oneOption)) {
      await oneOption.click();
    }
  }
}

async function preferShippingInCart(page: Page): Promise<void> {
  if (!isCartLikeUrl(page.url())) {
    console.log(`Skipping shipping preference because current page is not cart-like: ${page.url()}`);
    return;
  }

  const shippingCandidates: Locator[] = [
    page.locator('[data-test="ShippingFulfillment"]').first(),
    page.locator('[data-test="partial-checkout-row-SHIP--"]').first(),
    page.locator('input[data-test*="ship"][type="radio"]').first(),
    page.locator('button[data-test*="ship"][aria-label*="shipping"]').first(),
    page.locator('[role="radio"][aria-label*="shipping"]').first(),
    page.locator('[data-test="fulfillment-cell-shipping"]').first()
  ];

  for (const candidate of shippingCandidates) {
    if (!(await safeIsVisible(candidate))) {
      continue;
    }

    const label = await locatorLabel(candidate);
    if (/selected/i.test(label)) {
      console.log(`Shipping already selected in cart via "${label}".`);
      return;
    }

    console.log(`Selecting Shipping in cart via "${label || "shipping option"}".`);
    await quickClick(candidate);
    await settleAfterAction(page);

    if (!isCartLikeUrl(page.url()) && !isCheckoutLikeUrl(page.url())) {
      console.log(`Shipping selection navigated to a non-cart page (${page.url()}). Returning to cart and leaving fulfillment unchanged.`);
      await page.goto("/co-cart", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await settlePage(page, SHORT_SETTLE_MS);
      return;
    }

    return;
  }

  console.log("No visible Shipping fulfillment selector found in cart. Leaving current fulfillment choice unchanged.");
}

async function attemptCheckout(page: Page): Promise<void> {
  if (isCartLikeUrl(page.url())) {
    const cartCheckoutButton = page.locator('button[data-test="checkout-button"]').first();
    await cartCheckoutButton.waitFor({ state: "attached", timeout: 1_500 }).catch(() => undefined);
    const count = await cartCheckoutButton.count();
    if (count > 0) {
      const visible = await safeIsVisible(cartCheckoutButton);
      const label = await locatorLabel(cartCheckoutButton);
      console.log(
        `Cart checkout button lookup: count=${count} visible=${visible} label="${label || "Check out"}".`
      );

      await cartCheckoutButton.scrollIntoViewIfNeeded().catch(() => undefined);
      if (visible) {
        await quickClick(cartCheckoutButton);
      } else {
        const clicked = await page.evaluate(() => {
          const button = document.querySelector('button[data-test="checkout-button"]');
          if (!(button instanceof HTMLButtonElement)) {
            return false;
          }

          button.click();
          return true;
        });

        if (!clicked) {
          console.log('Cart checkout button was attached but could not be clicked via DOM fallback.');
        }
      }
      await settleAfterAction(page);
      return;
    }

    console.log('Cart checkout button lookup: count=0 visible=false label="".');
  }

  const checkoutCandidates: Locator[] = [
    page.locator('[data-test="checkout-button"]').first(),
    page.locator('[data-test="partial-checkout-button"]').first(),
    page.getByRole("button", { name: /check out|checkout/i }).first()
  ];

  for (const checkoutAction of checkoutCandidates) {
    if (await safeIsVisible(checkoutAction)) {
      const label = await locatorLabel(checkoutAction);
      console.log(`Proceeding to checkout via "${label || "checkout"}".`);
      await quickClick(checkoutAction);
      await settleAfterAction(page);
      return;
    }
  }
}

async function driveCheckout(page: Page, maxSteps: number): Promise<void> {
  await attemptCheckout(page);

  for (let step = 1; step <= maxSteps; step += 1) {
    await settlePage(page, SHORT_SETTLE_MS);

    if (await atFinalSubmit(page)) {
      console.log(`Reached final review step after ${step - 1} automated checkout actions.`);
      return;
    }

    const action = await findAdvanceAction(page);
    if (!action) {
      console.log(`No further safe checkout action found after ${step - 1} automated steps.`);
      return;
    }

    const label = (await safeInnerText(action)) || "checkout action";
    console.log(`Checkout step ${step}: clicking "${normalizeWhitespace(label)}"`);
    await quickClick(action);
    await settleAfterAction(page);
  }

  console.log(`Stopped after ${maxSteps} automated checkout steps to avoid overshooting the final review page.`);
}

async function atFinalSubmit(page: Page): Promise<boolean> {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const label = await safeInnerText(button);
    if (!label) {
      continue;
    }

    if (FINALIZE_PATTERNS.some((pattern) => pattern.test(label)) && (await safeIsVisible(button))) {
      return true;
    }
  }

  return false;
}

async function findAdvanceAction(page: Page) {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await safeIsVisible(button)) || (await safeIsDisabled(button))) {
      continue;
    }

    const label = await safeInnerText(button);
    if (!label) {
      continue;
    }

    if (FINALIZE_PATTERNS.some((pattern) => pattern.test(label))) {
      continue;
    }

    if (ADVANCE_PATTERNS.some((pattern) => pattern.test(label))) {
      return button;
    }
  }

  return null;
}

async function findCartEntryAction(page: Page): Promise<Locator | null> {
  const candidates: Locator[] = [];
  const buttonCount = await page.getByRole("button").count();
  for (let index = 0; index < buttonCount; index += 1) {
    candidates.push(page.getByRole("button").nth(index));
  }

  const linkCount = await page.getByRole("link").count();
  for (let index = 0; index < linkCount; index += 1) {
    candidates.push(page.getByRole("link").nth(index));
  }

  for (const candidate of candidates) {
    if (!(await safeIsVisible(candidate))) {
      continue;
    }

    const label = await locatorLabel(candidate);
    if (!label) {
      continue;
    }

    if (CART_ENTRY_PATTERNS.some((pattern) => pattern.test(label))) {
      return candidate;
    }
  }

  return null;
}

async function findInCartIndicator(page: Page): Promise<Locator | null> {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await safeIsVisible(button))) {
      continue;
    }

    const label = await locatorLabel(button);
    if (!label) {
      continue;
    }

    const dataTest = (await withTimeout(button.getAttribute("data-test").catch(() => null), null)) ?? "";
    if (IN_CART_PATTERNS.some((pattern) => pattern.test(label))) {
      if (/quantity|custom-quantity-picker/i.test(dataTest) || /\bin cart\b/i.test(label)) {
        return button;
      }
    }
  }

  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

async function locatorLabel(locator: Locator): Promise<string> {
  const text = await safeInnerText(locator);
  const aria = await safeAttribute(locator, "aria-label");
  return normalizeWhitespace(`${text} ${aria}`);
}

async function quickClick(locator: Locator): Promise<void> {
  const visible = await safeIsVisible(locator);
  if (!visible) {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  }

  try {
    await locator.click({
      noWaitAfter: true,
      timeout: FAST_CLICK_TIMEOUT_MS
    });
    return;
  } catch {
    const clicked = await locator
      .evaluate((node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        node.click();
        return true;
      })
      .catch(() => false);

    if (!clicked) {
      await locator.click({
        force: true,
        noWaitAfter: true,
        timeout: FAST_CLICK_TIMEOUT_MS
      });
    }
  }
}

async function clickAddToCart(locator: Locator): Promise<void> {
  const visible = await safeIsVisible(locator);
  if (!visible) {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  }

  const domClicked = await locator
    .evaluate((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }

      node.click();
      return true;
    })
    .catch(() => false);

  if (domClicked) {
    return;
  }

  await quickClick(locator);
}

function toMeaningfulTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

async function collectPurchaseDiagnostics(page: Page): Promise<string> {
  const headings = await page
    .getByRole("heading")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 12)
    )
    .catch(() => []);

  const buttons = await page
    .getByRole("button")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
          aria: node.getAttribute("aria-label") ?? "",
          disabled:
            node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true"
        }))
        .filter((entry) => entry.text || entry.aria)
        .slice(0, 20)
    )
    .catch(() => []);

  const addToCartLines = buttons
    .filter((entry) => `${entry.text} ${entry.aria}`.toLowerCase().includes("add to cart"))
    .map((entry) => `- text="${entry.text}" aria="${entry.aria}" disabled=${entry.disabled}`);

  const availabilityHeadings = headings
    .filter((heading) => /available|pickup|delivery|shipping|exclusive/i.test(heading))
    .map((heading) => `- ${heading}`);

  return [
    `Page URL: ${page.url()}`,
    availabilityHeadings.length > 0
      ? `Relevant headings:\n${availabilityHeadings.join("\n")}`
      : undefined,
    addToCartLines.length > 0
      ? `Add-to-cart candidates:\n${addToCartLines.join("\n")}`
      : "No add-to-cart candidates found in visible button scan."
  ]
    .filter(Boolean)
    .join("\n");
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };

    const onSignal = () => cleanup();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

function createTimingLogger(): TimingLogger {
  const startedAt = Date.now();
  let lastAt = startedAt;

  return {
    sinceStart(label: string) {
      const now = Date.now();
      console.log(`[timing +${now - startedAt}ms total] ${label}`);
      lastAt = now;
    },
    sinceLast(label: string) {
      const now = Date.now();
      console.log(`[timing +${now - lastAt}ms step | +${now - startedAt}ms total] ${label}`);
      lastAt = now;
    }
  };
}

async function settleAfterAction(page: Page): Promise<void> {
  await settleDomOnly(page, SHORT_SETTLE_MS);
}

async function settlePage(page: Page, fallbackMs: number): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: fallbackMs }).catch(() => undefined);
  await page.waitForTimeout(fallbackMs);
}

export async function settleDomOnly(page: Page, fallbackMs: number): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(fallbackMs);
}

async function waitForCartState(page: Page): Promise<void> {
  const deadline = Date.now() + 2_500;

  while (Date.now() < deadline) {
    if (await requiresLogin(page)) {
      return;
    }

    if (await findInCartIndicator(page)) {
      return;
    }

    if (await findCartEntryAction(page)) {
      return;
    }

    if (await findSidecartReadyState(page)) {
      return;
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  await settleDomOnly(page, SHORT_SETTLE_MS);
}

async function findSidecartReadyState(page: Page): Promise<boolean> {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await safeIsVisible(button))) {
      continue;
    }

    const label = await locatorLabel(button);
    if (!label) {
      continue;
    }

    if (SIDECART_READY_PATTERNS.some((pattern) => pattern.test(label))) {
      return true;
    }
  }

  const pageText = normalizeWhitespace(await page.locator("body").innerText().catch(() => ""));
  return SIDECART_READY_PATTERNS.some((pattern) => pattern.test(pageText));
}

async function safeIsVisible(locator: Locator): Promise<boolean> {
  return withTimeout(locator.isVisible().catch(() => false), false);
}

async function safeIsDisabled(locator: Locator): Promise<boolean> {
  return withTimeout(locator.isDisabled().catch(() => true), true);
}

async function safeInnerText(locator: Locator): Promise<string> {
  return normalizeWhitespace(await withTimeout(locator.innerText().catch(() => ""), ""));
}

async function safeAttribute(locator: Locator, name: string): Promise<string> {
  return normalizeWhitespace(await withTimeout(locator.getAttribute(name).then((value) => value ?? ""), ""));
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = LOCATOR_READ_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        resolve(fallback);
      });
  });
}

function isCartLikeUrl(url: string): boolean {
  return /\/co-cart|\/cart/i.test(url);
}

function isCheckoutLikeUrl(url: string): boolean {
  return /checkout|co-review|co-delivery|co-payment|co-login/i.test(url);
}
