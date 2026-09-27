# Buy with PerkPilot

Buy with PerkPilot authorizes one controlled-store purchase with a maximum total, item/variant, quantity, destination, merchant, and original enrolled-card set. Gemini prepares the purchase using four narrow tools; the deterministic service validates permission again immediately before payment dispatch. Limits are **application policy**. This does not demonstrate Visa network enforcement or Stripe Shared Payment Token seller restrictions.

The controlled merchant is **PerkPilot Test Store**, not Nike, Alo, Amazon, or another external retailer. Stripe test transactions do not move money. The receipt's reward amount estimates a published base rate; it is not a posted benefit. Existing synthetic checkout remains separately labeled.

A local run verified the core happy path with real Gemini tool calls, a Stripe-confirmed $104 sandbox payment using API test payment methods, and its signed webhook. Full sandbox acceptance remains **pending**, including manual browser enrollment/authentication and real PostgreSQL concurrency. The Explore regression uses isolated provider/model fixtures; those fixtures alone do not establish real provider behavior. See the [implementation plan](docs/superpowers/plans/2026-09-26-buy-with-perkpilot.md) and [approved specification](docs/superpowers/specs/2026-09-26-agent-checkout-design.md).

## Buy from Explore

Sign in with a registered portal account and search **Explore**. Open a product image, title, or **Buy with PerkPilot** button to see its product sheet. Eligible USD listings support the same saved-card enrollment, permission review, bounded agent purchase, and receipt as Test Store, without leaving Explore. Adding a wallet card returns you to the selected product.

The product sheet automatically shows **Best card in your Wallet**, using the same owned-card comparison as **I’m at…**. It includes the published rate, estimated cashback on the observed USD merchandise price, alternatives, and issuer terms. Listings do not verify merchant categories, so the default uses base rates. Choose a merchant category and update the comparison to see supported conditional bonuses. Missing or non-USD prices show rates without a dollar estimate.

The purchase review separately highlights **Best enrolled card for this test purchase**, using the server-ranked saved methods and final sandbox total. A wallet card recommendation does not enroll a payment method or change the sandbox merchant category; the agent still chooses the best authorized enrolled card at its base rate. Wallet refreshes update the advisory without replacing an active checkout.

Explore checkout creates a **PerkPilot Test Store sandbox copy** of the observed listing. Its merchandise price comes from the server's catalog result, with **10% test tax and $5 test shipping**. These are sandbox fees, not the external retailer's charges; no external retailer order or delivery is created. The existing **$500 maximum total** still applies. Unsupported, missing-price, or over-limit listings show a reason and retain their retailer link.

Product references expire after 15 minutes and are tied to the registered portal session. Refresh the search after expiry or a server restart. Once imported, the selected SKU and price snapshot remain stable for purchase approval and recovery. Closing the sheet does not cancel an approved purchase; reopening its product or Test Store recovers its status. An unresolved purchase prevents starting a different one.

The isolated regression command is `npm run test:explore:browser`. Its catalog, Gemini transport, Stripe fields, and payment provider are test doubles; it verifies the integrated UI/server flow without spending external API quota. See the [Explore integration plan](docs/superpowers/plans/2026-09-27-explore-checkout.md).

## Cashback in Saved

**Saved this year** now includes confirmed ledger benefits plus clearly labeled **estimated cashback**. Completed Explore/Test Store orders contribute their persisted cashback estimate automatically; processing, failed, cancelled, and unconfirmed orders contribute nothing. Opening a receipt or replaying a webhook does not add another entry. Existing completed orders appear after refresh, without a data migration or new provider request.

For **I’m at… / Which card is best?**, enter an amount, compare cards, then choose **I bought this** to record a self-reported purchase using the recommended card. Comparing cards alone adds nothing. The server calculates the estimate from its card rules and deduplicates retries. **Remove tracking** in Saved removes an accidental report; it does not refund a payment. Registered history uses the current year in the user's timezone; sample profiles retain their demo clock.

Saved separates confirmed benefits from estimates and shows each purchase, card, amount, and cashback. These estimates are not issuer-posted rewards or real money earned from sandbox payments. The existing sample reward lifecycle still moves an estimate to confirmed benefits without counting it twice, and refunds reverse that sample benefit. A checkout-history outage is shown explicitly instead of claiming the partial total is complete.

## Configure an authorized test workspace

Use Node.js 20+ and an existing authorized Stripe sandbox. No script provisions an account, requests Visa access, or creates provider credentials. Copy configuration from `.env.example` into the gitignored `.env`; use your secret manager when appropriate.

Required checkout configuration:

```dotenv
PERKPILOT_CHECKOUT_ENABLED=1
CHECKOUT_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://<user>:<password>@127.0.0.1/<local_checkout_fixture>
STRIPE_SECRET_KEY=<your sk_test_ key>
STRIPE_PUBLISHABLE_KEY=<your pk_test_ key>
STRIPE_EXPECTED_ACCOUNT_ID=<authorized acct_ identifier>
STRIPE_WEBHOOK_SECRET=<local webhook listener whsec_ value>
GEMINI_API_KEY=<your authorized key>
GEMINI_CHECKOUT_MODEL=gemini-3.8-flash
```

The model value is the existing project default, not a verified availability claim. The verification command checks function-calling capability against the configured model. Stripe SDK **22.6.2** is locked; its adapter pins API version **2026-08-26.dahlia**. Upgrade and verify these together. Live Stripe keys and live provider objects are refused.

Checkout binds to `127.0.0.1`; the origin must be an exact loopback HTTP origin. Keep one portal process per JSON data directory. A separate `TEST_CHECKOUT_DATABASE_URL` is required for real database tests; tests never infer it from `DATABASE_URL`.

```sh
npm install
npm run migrate:checkout
npm run seed:checkout
npm run preflight:checkout
npm run dev:checkout
```

Migration creates only prefixed checkout tables, now schema **v2**. Runtime does not auto-migrate commerce. Seeding inserts the controlled headphone fixture without overwriting orders, stock changes, or existing product records. Its normal single-item total is **$104**: $90 merchandise + $9 test tax + $5 shipping.

If the sibling storefront port 3001 is already in use, set `STORE_PORT=3002` (or another free port) in `.env`. The current local session uses 3002.

Ordinary `npm run dev` and the labeled synthetic profile journey remain available with checkout disabled. Stripe is required only when checkout is explicitly enabled.

If the Test Store says **Test checkout needs setup**, open **How to enable test checkout** for the required configuration and startup commands. **Add a wallet card** works before provider setup. After restarting with `npm run dev:checkout`, reload the page or click **Check setup again**. Product or saved-method loading errors are displayed with a retry action; enrollment and purchase forms appear once their prerequisites are available.

## Forward signed local webhooks

With an authorized Stripe CLI session, forward the relevant PaymentIntent events to the local checkout route:

```sh
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.processing,payment_intent.requires_action,payment_intent.canceled --forward-to http://localhost:3000/api/v1/agent-checkout/webhooks/stripe
```

Place the listener's signing secret in `STRIPE_WEBHOOK_SECRET` and restart the app. The webhook endpoint verifies the bounded raw body with the official SDK before ingestion; normal checkout endpoints require a registered session and matching origin. Confirm delivery for the actual payment ID. A generated CLI test event alone does not prove that the demo purchase received its webhook. See the [official Stripe CLI guide](https://docs.stripe.com/cli).

## Prepare the presenter

Sign in or register your own portal account; Alex/Taylor sample identities and extension sessions cannot enroll or pay. In Wallet, add the reward products you want to compare, then enroll their saved **test** methods through the actual Stripe fields with explicit save consent. A self-reported wallet product is insufficient for payment.

For a normal preparation, use the documented Visa test card `4242 4242 4242 4242` and Mastercard `5555 5555 5555 4444`, with a future expiry and any three-digit test CVC. Select the corresponding reward products in Wallet; matching a published reward product is your explicit mapping, not issuer verification. Stripe documents these values in its [test-card guide](https://docs.stripe.com/testing).

Prepare decline and authentication exercises using the provider-documented [decline](https://docs.stripe.com/testing#declined-payments) and [3D Secure](https://docs.stripe.com/testing#regulatory-cards) cases. Complete the actual browser challenge and verify the resulting payment. A mocked challenge screenshot or forced local state is insufficient. Do not enter test card numbers into server CLI flags, model prompts, or logs.

Checkout accepts only the saved methods enrolled at the authorization click. For a $104 other-category purchase, Active Cash's 2% estimate is **$2.08**, ahead of Quicksilver's 1.5% **$1.56**. No rotating bonuses, merchant offers, or posted rewards are assumed.

## Local one-shot scenarios

Presenter controls require both explicit flags, an exact loopback checkout origin, and a PostgreSQL URL hosted on loopback. Use a dedicated local checkout fixture; remote database URLs are refused for these mutations. The target must be an existing registered checkout subject with an active enrolled method for the configured test account.

```dotenv
PERKPILOT_CHECKOUT_DEMO_CONTROLS=1
CHECKOUT_VERIFY_SUBJECT=portal:<presenter UUID>
```

Use the registered portal user ID shown by the authorized session API to form `portal:<uuid>`. There is no public scenario endpoint. These commands do not change product prices globally or change permission checks:

```sh
node --env-file=.env scripts/checkout-demo.js seed
node --env-file=.env scripts/checkout-demo.js arm --subject portal:<uuid> --scenario price-increase
node --env-file=.env scripts/checkout-demo.js arm --subject portal:<uuid> --scenario prompt-injection
node --env-file=.env scripts/checkout-demo.js clear --subject portal:<uuid>
```

`arm` replaces only that subject's pending scenario. The next **new intent** atomically consumes it; the original preview remains $104. A price overlay then reports $140 to the tools, with a scoped cart revision. Prompt injection replaces only that intent's description with hostile text. Replay of an existing preview preserves its intent and does not consume a subsequent arm. `clear` removes only an unconsumed arm; it cannot change an existing authorized intent. Disable presenter controls after the demo.

## Ninety-second walkthrough

1. **15 seconds:** Show two enrolled test methods and the exact headphone/destination/card-set permission, with a **$110** maximum.
2. **25 seconds:** Click **Buy with PerkPilot** once. Show server tool activity and deterministic best-card choice; payment status comes from the provider.
3. **15 seconds:** Show the order receipt and matching Stripe test payment ID in the sandbox dashboard. Reward value stays estimated.
4. **25 seconds:** Arm `price-increase` for the presenter, make a fresh $104 preview, then approve up to $110. The agent reads $140 and the service refuses before any dispatch.
5. **10 seconds:** Explain the independent guard. Expected refusal: **“The merchant total is now $140.00, above your $110.00 approval. No payment was submitted.”** Show no order/payment-attempt records for the blocked intent. This proves PerkPilot blocked submission, not that Stripe rejected $140.

The prompt-injection exercise and direct guarded-tool tests demonstrate that model text cannot amend the approved amount or identity. Enrollment occurs before this walkthrough.

## Recover and interpret evidence

Timeout after submission means **unknown payment outcome**, not failure. The durable attempt retains one order and stable operation key. Reconciliation retrieves a known payment ID or replays the identical operation within 23 hours. It never substitutes a different card or creates another operation to resolve ambiguity. Older unresolved attempts require operator investigation. Closing/reloading a browser resumes persisted status; cancelling or logging out after dispatch cannot promise that payment was undone.

```sh
npm test
npm run build
node --env-file=.env --test tests/checkout-postgres.test.js
npm run test:checkout:browser
npm run test:checkout:setup-browser
npm run test:integrated:browser
npm run test:browser
node --env-file=.env scripts/verify-checkout.js
```

The verifier writes `test-results/checkout/verification.json` with restricted file permissions and no keys, client secrets, customer IDs, payment-method references, session cookies, or street addresses. Without required Stripe keys it writes a blocked report, returns nonzero, and performs no provider calls. With explicit configuration and a registered test subject, it makes read-only account/payment requests plus one read-only Gemini function-capability probe. It does not enroll methods or submit purchases.

The report distinguishes configured, verified, observed, interactive-check-required, and separate-test-required outcomes. It always leaves overall integration acceptance incomplete because interactive challenge and real concurrency/restart exercises need their own evidence. Persisted tool events do not independently prove model execution; provider-confirmed payment identity and actual capability checks are separate fields. Record the browser challenge, signed forwarding, decline, duplicate click/restart, and isolated PostgreSQL outcomes before marking the plan's acceptance checklist complete.

## Optional provider gate

Visa Intelligent Commerce and Stripe Shared Payment Tokens are not implemented in this active path. VIC requires team-authorized credentials/certificates and a compatible approved sandbox workflow. SPT requires actual agent-issued seller-scoped tokens, successful seller redemption, and provider rejection evidence for excess amount, expiry, and wrong seller. Public examples or test-helper issuance do not establish that access. Keep the UI's application-policy label until those separate conditions are verified.

## Local verification recorded for this change

- `npm test`: 205 passed, zero failures, one explicit skip for missing `TEST_CHECKOUT_DATABASE_URL` (206 total).
- `npm run build`: 81 JavaScript files passed the repository syntax/static check; this is not TypeScript compilation.
- Existing synthetic browser journey, registered Explore/Connected journey, and agent checkout browser journey passed with isolated provider fixtures; desktop/mobile screenshots were inspected.
- Unconfigured Test Store browser coverage passes actual setup, retry, and wallet-onboarding clicks against the ordinary integrated server, plus ready-empty-wallet and failed-catalog recovery fixtures. No payment provider is called by this check.
- Independent review regressions cover mixed extension/portal credentials, failed-payment normalization, exact-approval recovery, and linked-profile deletion without data resurrection.
- A separate actual Gemini request using the local configuration returned `AGENT_UNAVAILABLE`; live model execution remains unverified.
- Stripe keys were deferred by the user. No actual Stripe charge, enrollment, challenge, or webhook delivery was claimed. The verifier records incomplete configuration in its redacted report.
