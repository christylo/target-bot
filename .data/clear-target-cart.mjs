import { chromium } from "playwright";

const profileDir = "/home/brybry34/target-bot/.data/target-profile";

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 1200 }
});
const page = context.pages()[0] ?? await context.newPage();

try {
  await page.goto("https://www.target.com/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  for (let i = 0; i < 10; i += 1) {
    const close = page.getByRole("button", { name: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.evaluate((node) => node instanceof HTMLElement && node.click()).catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const remove = page
      .locator('[data-test="cartItem-deleteBtn"]')
      .or(page.getByRole("button", { name: /remove|delete/i }))
      .or(page.getByRole("link", { name: /remove|delete/i }))
      .first();

    if (!(await remove.isVisible().catch(() => false))) {
      break;
    }

    const label = (await remove.innerText().catch(() => "")) || (await remove.getAttribute("aria-label").catch(() => ""));
    console.log(`Removing cart item via "${label?.replace(/\s+/g, " ").trim() || "remove"}"`);
    await remove.evaluate((node) => node instanceof HTMLElement && node.click());
    await page.waitForTimeout(2000);

    const confirm = page.getByRole("button", { name: /^remove$/i }).first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.evaluate((node) => node instanceof HTMLElement && node.click());
      await page.waitForTimeout(2000);
    }
  }

  await page.waitForTimeout(1500);
  const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  console.log(body.includes("Your cart is empty") ? "cart-empty" : "cart-may-still-have-items");
} finally {
  await context.close();
}
