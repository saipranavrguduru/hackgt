# PerkPilot

> For the separate database-backed Plaid, live-listing, and model-backed path, see [CONNECTED.md](CONNECTED.md). The commands below run the original synthetic demo.

Personalized deals from spending patterns, with product research, a shared card/quote engine, explicitly approved simulated checkout, and a ledger of confirmed benefits. Implemented from [PERKPILOT.md](PERKPILOT.md).

The default app is a **local synthetic financial demo**. No bank, issuer account, payment, or reward provider is connected there. No money moves. Public card product reward rules are published metadata, not proof of card ownership or individual offer eligibility. Optional nearby-place search uses live OpenStreetMap data, separately from the synthetic financial records.

The separate [connected app](CONNECTED.md) supports Plaid Sandbox transactions, PostgreSQL storage, Gemini or OpenAI answers, and SerpApi Google Shopping results when their credentials are configured.

## Run

Requires Node.js 20 or newer. No dependencies need installation.

```sh
npm run dev
```

Keep this process running, then open:

- Portal: http://localhost:3000
- Controlled Alo store: http://localhost:3001/store?product=alo-jacket
- Controlled Nike store: http://localhost:3001/store?product=nike-pegasus

Choose **Explore Alex's sample profile** for the full journey or create a local account. Registered accounts start with no transactions, accounts, or cards and consent disabled. Cards selected in Wallet are self-reported and support comparison only. Passwords must be 12–128 characters.

Sample history uses September 23, 2026 as its demo clock. Session/pairing/checkout expiration also checks actual elapsed time.

## “I'm at…” card picker

Open **I'm at…** from For You or Wallet. Choose Dining, Groceries, Gas, Drugstores, or Other / unsure, optionally enter a place and purchase amount, then select **Show best card**. Only cards already in your Wallet are ranked. Without an amount, results show rates without invented dollar savings.

**Locate me** requests one browser location reading and sends coordinates through the local server to [OpenStreetMap's Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) to find mapped places within 500 meters. No API key is needed. Review the reported accuracy, choose a nearby place, and confirm or correct its category before requesting a recommendation. Public map coverage and service availability vary. Denied permission, poor accuracy, empty results, or an outage leave manual entry available. [Browser geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition) requires permission and a secure context (including trustworthy localhost); this local application does not support remote phone access over an ordinary HTTP LAN address.

The app does not persist coordinates, selected places, or location history, and it does not track location in the background. Closing the sheet, navigating, or switching profiles discards temporary context and invalidates pending results. A request already sent cannot be recalled; the external provider receives the coordinates for that lookup. Nearby search permits six attempts per minute per signed-in user. The local process also limits aggregate map usage to one active query, up to 100 attempts and a conservative 10 MB response budget per 24 hours, and pauses for 30 seconds after provider throttling. These safeguards follow the public service's [small-project usage guidance](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances); quota counters hold no coordinates and reset when the local process restarts.

Published rules checked September 26, 2026: [Chase Freedom Unlimited](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited) supports 3% dining/drugstores and 1.5% other eligible purchases; [Active Cash](https://www.wellsfargo.com/credit-cards/documents/active-cash-terms/) uses 2%; [Quicksilver](https://www.capitalone.com/learn-grow/money-management/capital-one-quicksilver-vs-savor/) uses 1.5%; [Discover](https://www.discover.com/credit-cards/cash-back/cashback-bonus.html) uses its 1% base. Activated rotating categories, promotional bonuses, and card-linked offers are excluded from this picker. Mapped categories do not establish [issuer merchant codes](https://www.chase.com/personal/credit-cards/rewards-category-faq); category bonuses show the base fallback, and issuer rounding can differ from estimates.

Alex's sample wallet correctly chooses Active Cash across these categories. Add Freedom Unlimited only if representing a card you already have to compare its dining bonus. Taylor's sample wallet already contains it. These are recommendations and never create or approve a checkout.

## Demo journey

1. Review Spend DNA and its transaction evidence; exclude a one-off purchase or edit interests.
2. Return to For You. Publish the synthetic promotion and inspect the relevant notification. Switch to Taylor to see different rankings from the same catalog.
3. Research a deal or search Explore for headphones for long flights under $350. Read the fictional evidence, compare candidates, and save a watch.
4. Open the Alo jacket Deal Stack. It charges **$104 today**, already including a **$26 merchant discount**. Before activation, Wells Fargo Active Cash estimates a $2.08 reward and **$101.92 effective cost**.
5. Activate the fictional $20 Discover offer and request a fresh quote. The $104 charge stays unchanged; $20 credit plus $1.04 ordinary reward gives **$82.96 estimated effective cost**.
6. Explicitly approve the no-money checkout. In Saved, simulate settlement, qualification, credit posting, and cash reward posting separately. Confirmed value progresses **$0 → $26 → $26 → $46 → $47.04**. A full return reverses it; replay does not increase it.

## Chrome extension

1. Start the local servers above.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension` directory.
3. Visit one of the controlled storefronts, then click the PerkPilot extension icon to open its side panel.
4. Connect to the portal, explicitly approve pairing while signed in, then return to the panel to complete pairing.
5. Read the cart, compare cards, activate the synthetic offer, and open checkout in the portal for final review. The extension never reads or fills payment fields and cannot confirm a payment.

The extension supports only localhost/127.0.0.1 controlled storefronts. Pairing expires after five minutes; scoped tokens expire after 30 minutes and remain in browser session storage. Disconnect revokes the token. A configured `PERKPILOT_EXTENSION_ID` can narrow pairing to one installation. Custom server ports require corresponding extension configuration changes.

## Verification

```sh
npm test
npm run build
npm run preflight
PERKPILOT_MODE=live npm run preflight
```

The final command intentionally exits nonzero: production providers are absent. `build`, `lint`, and `typecheck` run the same dependency-free JavaScript syntax and artifact checks; they do not perform TypeScript type checking or production bundling. Tests cover domain arithmetic, ranking, research evidence, auth, ownership, checkout, events, extension cart state, location/category ranking, nearby-provider validation/failures/privacy, and live-mode rejection. Automated nearby-provider tests use mocked public map responses; they do not request your location.

An optional `npm run test:browser` runs an isolated, in-memory portal/storefront journey on ports 3300/3301, with desktop/mobile screenshots in `test-results/browser`. It requires an available Playwright installation and Chromium. If installed elsewhere, set `PLAYWRIGHT_MODULE_PATH` to its `index.mjs` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the browser executable. These are test-only tools; the app and standard test suite remain dependency-free. The smoke test does not install or load the actual Chrome extension.

## Data and configuration

Mutable local files `data/state.json` and `data/auth.json` are gitignored, atomically replaced, and permissioned `0600`. Auth stores salted scrypt password hashes and hashed session tokens. HTTP-only, strict same-site cookies last 12 hours. This is local identity without email verification or account recovery; use a disposable demo password.

Stop the server before resetting samples:

```sh
npm run demo:reset
```

This preserves registered profiles and their records. Do not run multiple application processes against the same data directory. JSON files are not a production transaction database.

Environment variables are read from the shell; `.env.example` documents them. The application does **not** automatically load `.env` files. Optional `OPENAI_API_KEY` and `OPENAI_MODEL` enable bounded mission interpretation and non-monetary explanations through the [Responses API](https://developers.openai.com/api/docs/guides/text). Without a key or after provider failure, a labeled deterministic fallback runs. A configured-key model call has not been verified. Raw account/card/session credentials are never passed to the model; it has no purchase tools.

See [CONTRACTS.md](CONTRACTS.md) for API boundaries and [LIVE_INTEGRATION.md](LIVE_INTEGRATION.md) for the unavailable live integrations. The original design's statements about an earlier repository are requirements context; this README and current test output describe this implementation.

## Troubleshooting

- Connection refused: keep `npm run dev` running, then reload.
- `EADDRINUSE`: another process owns port 3000 or 3001. Stop that process or choose `PORT` and `STORE_PORT` (the extension's default ports must then be updated).
- `listen EPERM`: the execution environment blocked local sockets. Run in a normal terminal or permit loopback access; the application does not suppress the error.
- `LOGIN_REQUIRED`: sign in or explicitly choose a sample profile.
- `LIVE_PROVIDER_UNAVAILABLE`: this is the intentional fail-closed live boundary.
