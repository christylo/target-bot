import { chromium } from "playwright";

const profileDir = "/home/brybry34/target-bot/.data/target-profile";
const output = "/home/brybry34/target-bot/.data/debug-checkout.png";

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 1200 }
});
const page = context.pages()[0] ?? await context.newPage();

try {
  await page.goto("https://www.target.com/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const beforeUrl = page.url();
  const checkout = page.locator('button[data-test="checkout-button"]').first();
  const checkoutVisible = await checkout.isVisible().catch(() => false);
  const checkoutDisabled = await checkout.isDisabled().catch(() => true);
  if (checkoutVisible && !checkoutDisabled) {
    await checkout.click({ noWaitAfter: true });
    await page.waitForTimeout(3000);
  }

  const buttons = await page.getByRole("button").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
        aria: node.getAttribute("aria-label") ?? "",
        disabled: node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true"
      }))
      .filter((entry) => entry.text || entry.aria)
      .slice(0, 40)
  );
  const headings = await page.getByRole("heading").evaluateAll((nodes) =>
    nodes
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 30)
  );
  const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 1200);

  await page.screenshot({ path: output, fullPage: true });
  console.log(JSON.stringify({
    beforeUrl,
    afterUrl: page.url(),
    checkoutVisible,
    checkoutDisabled,
    headings,
    buttons,
    body,
    screenshot: output
  }, null, 2));
} finally {
  await context.close();
}
