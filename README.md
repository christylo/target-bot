# Army Bomb Tracker

Small Node/TypeScript stock tracker for a Target product page. V1 polls a Target PDP, classifies stock status from page content, stores the last known state, and sends alerts when availability changes or when an item comes back in stock.

V2 now includes a local browser assistant that reuses a persistent Target browser profile, helps add exactly one item to cart, and can move you into checkout while still stopping before final order submission.

## What v1 does

- Polls a Target product page on an interval.
- Persists the last known product status in `.data/state.json`.
- Alerts through console, optional Discord webhook, optional SMTP email, and an optional local sound/open-page action.
- Supports a local HTML file for dry runs while you tune parsing and alerting.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and fill in the product URL:

```bash
cp .env.example .env
```

3. Run one check:

```bash
npm run once
```

4. Start continuous watching:

```bash
npm run watch
```

## Important environment variables

- `TARGET_PRODUCT_URL`: Target PDP URL to watch.
- `POLL_INTERVAL_MS`: Polling interval for `watch` mode. Default `5000`.
- `ALERT_COOLDOWN_MS`: Reminder cooldown for repeated in-stock alerts. Default `300000`.
- `DISCORD_WEBHOOK_URL`: Optional Discord webhook for fast alerts.
- `SMTP_*` and `ALERT_EMAIL_*`: Optional email delivery settings.
- `TARGET_COOKIE_HEADER`: Optional raw cookie header if you need a specific store/location view.
- `TARGET_EXTRA_HEADERS_JSON`: Optional JSON object of extra request headers.
- `TARGET_HTML_FILE`: Optional local HTML file to parse instead of making a live request.
- `OPEN_PRODUCT_ON_ALERT`: If `true`, opens the product page locally when an alert fires.

## Commands

- `npm run once`: Fetch and evaluate the product page once.
- `npm run watch`: Keep polling with the raw HTTP page fetch until stopped.
- `npm run watch:browser`: Keep polling through your saved Target browser session without launching the buy flow.
- `npm run watch:buy`: Keep polling through your saved Target browser session until the product is detected in stock, then continue toward checkout.
- `npm run watch:http-buy`: Keep polling with the raw HTTP page fetch, then launch the buy helper when that raw page says in stock.
- `npm run helper:login`: Open a persistent browser profile so you can sign in to Target manually.
- `npm run helper:buy`: Reuse that saved session, add one item if available, and move toward checkout without placing the order.
- `npm run helper:buy-at -- 2026-03-20T23:58:00`: Wait until an exact local timestamp, then launch the buy helper automatically.
- `npm run check`: Type-check the project.
- `npm run build`: Compile to `dist/`.
- `npm run verify`: Run type-check, tests, and build in one pass.

You can override `TARGET_PRODUCT_URL` for a single run without editing `.env`:

```bash
npm run watch:buy -- --url "https://www.target.com/p/your-target-product/-/A-12345678" --poll-interval-ms 1000
```

The `--url` option also works with helper commands such as `helper:buy` and `helper:buy-at`. The `--poll-interval-ms` option overrides `POLL_INTERVAL_MS` for that run.

## Drop-night runbook

If you are targeting a Target online release that is expected to start on `3/21`, the safest operating assumption is "be ready a few minutes before midnight local time and stay ready through the first several minutes after the date rolls over."

Recommended timeline for a Pacific-time drop:

1. Earlier in the evening, confirm your setup:

```bash
npm install
npm run check
npm test
```

2. Around `11:40 PM PT`, refresh the saved Target session:

```bash
npm run helper:login
```

Log in, make sure your shipping address and saved payment method are present, then leave the browser session ready and stop the command with `Ctrl+C`.

3. Around `11:50 PM PT`, point `.env` at the real Target PDP and double-check your helper settings:

```env
TARGET_PRODUCT_URL=https://www.target.com/p/your-target-product/-/A-12345678#lnk=sametab
TARGET_HELPER_HEADLESS=false
TARGET_HELPER_PROCEED_TO_CHECKOUT=true
TARGET_HELPER_START_AT=
```

4. At `11:58 PM PT`, arm the scheduled helper:

```bash
npm run helper:buy-at -- 2026-03-20T23:58:00
```

This waits quietly until the exact local timestamp, then starts the normal `helper:buy` flow automatically.

5. Keep the terminal and browser open through at least `12:15 AM PT`.

If the product goes live right after midnight, the helper should be able to move through the product page, cart, and checkout path quickly while still leaving the final order confirmation click to you.

Optional parallel watcher in a second terminal:

```bash
POLL_INTERVAL_MS=1000 npm run watch
```

This gives you a fast stock-state signal while the scheduled helper is waiting to fire.

If you do not trust the exact drop time and want the tool to react the moment the product flips in stock, use:

```bash
POLL_INTERVAL_MS=1000 npm run watch:buy
```

That mode keeps polling in your logged-in Target browser session, detects the first `in_stock` result, and immediately continues into the checkout helper. It also avoids duplicate launches during the same in-stock streak and applies a short retry cooldown if the helper errors.

## Notes on Target-specific behavior

Target availability can vary by ZIP, store, and fulfillment method. `npm run watch` intentionally stays simple and watches the raw page representation you can fetch right now. If that output says `source=dom-text` and disagrees with what you see in a logged-in browser, use `npm run watch:browser` or `npm run watch:buy`; those commands reuse your persistent Target browser session and inspect the hydrated page. `TARGET_COOKIE_HEADER` and `TARGET_EXTRA_HEADERS_JSON` are still available for raw HTTP polling, but the browser-backed watcher is the better default for Target PDPs that depend on your saved session.

## Future browser-assisted checkout path

The current V2 helper is intentionally human-in-the-loop:

1. Run `npm run helper:login` and log in manually in the opened browser window.
2. The helper saves that login session in `TARGET_PROFILE_DIR`.
3. Run `npm run helper:buy` to open the Target PDP in that same session.
4. If `Add to cart` is enabled, the helper attempts to add one item, navigates to cart, enforces quantity `1`, and can proceed to checkout.
5. It stops before final order submission so you can confirm the order yourself.

This keeps the stock detection logic stable while isolating browser actions in a separate module.

## V2 environment variables

- `TARGET_PROFILE_DIR`: Persistent browser profile directory for Target login state.
- `TARGET_LOGIN_URL`: Login page used by `helper:login`.
- `TARGET_CART_URL`: Cart page used by the browser assistant.
- `TARGET_CHECKOUT_QUANTITY`: Fixed to `1` for the MVP.
- `TARGET_HELPER_HEADLESS`: Run the helper without a visible browser. Default `false`.
- `TARGET_HELPER_PROCEED_TO_CHECKOUT`: If `true`, attempts to move from cart into checkout, but still stops before final order submission.
- `TARGET_HELPER_MAX_CHECKOUT_STEPS`: Safety cap for automated checkout step clicks before handing off.
- `TARGET_HELPER_START_AT`: Optional local timestamp used by `buy-at` if you do not pass one on the command line.

## Credential handling

Do not paste your Target username or password into chat. The helper is designed so you sign in directly inside a local browser window once, and the saved session is reused from disk afterward.

## Current V2 handoff behavior

The assistant now tries to automate everything up to the final purchase confirmation:

1. open the saved Target session
2. add one item when stock is available
3. go to cart
4. enforce quantity `1`
5. click through checkout actions like saved address/payment and review transitions
6. stop when it detects a final action such as `Place order` or `Submit order`

That means the intended human role is only the last confirmation click.
