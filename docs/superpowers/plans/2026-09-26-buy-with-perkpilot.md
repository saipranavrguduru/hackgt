# Buy with PerkPilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one-click, permission-bounded AI checkout with best-card selection, a real provider sandbox order, and a demonstrable blocked unauthorized purchase.

**Architecture:** Add a dedicated checkout module to the existing full portal, with PostgreSQL commerce state and an explicit adapter for its existing registered identity. Gemini calls narrow tools; a deterministic order service alone can use saved Stripe test methods. Keep application-enforced limits distinct from optional Visa/SPT provider controls.

**Tech Stack:** Node.js >=20, ES modules, existing pg/pg-mem, official Stripe Node SDK, Gemini Interactions over native fetch, vanilla browser JS, node:test, existing external Playwright/Chromium setup.

**Spec:** [Buy with PerkPilot product and technical specification](../specs/2026-09-26-agent-checkout-design.md). Read both documents before executing.

**Status:** Implementation and code review complete. Local suite: 201 passed, one dedicated-PostgreSQL skip; three browser journeys and static build passed. Real Stripe/Gemini/webhook/authentication and PostgreSQL integration acceptance remains pending. See [CHECKOUT.md](../../../CHECKOUT.md) for setup and evidence.

## Global Constraints

- Node.js >=20; native JavaScript ES modules; keep the existing portal and synthetic demo working when checkout is disabled.
- Baseline provider is Stripe test mode; refuse live secret/publishable keys and any provider object with livemode=true.
- One controlled merchant, USD only, one SKU/variant per order, quantity 1–10, integer cents, maximum authorized total 50,000 cents.
- Preview lifetime is 300 seconds; purchase permission lifetime is 300 seconds; payment quote lifetime is 60 seconds; all use real UTC time.
- Maximum 10 eligible enrolled cards per permission; never add cards to an already approved set.
- One order and one payment attempt per permission; a decline or blocked purchase requires a new preview and approval.
- Agent limits are 6 model calls, 8 tool invocations, a 45-second preparation deadline, and at most one mutating tool call per model response.
- Browser status polling is every 1 second while active, backing off to 5 seconds for unresolved payments; challenge UI is outside the agent deadline.
- No raw payment credentials, provider client secrets, session cookies, or shipping street addresses enter model input or activity logs.
- Enable checkout only with PERKPILOT_CHECKOUT_ENABLED=1; local runtime remains bound to 127.0.0.1 and uses one portal process per JSON data directory.

## Review Focus

- A browser closes while the provider accepted payment but the local response was lost: recover one order and never issue a second payment. Task 4 and Task 8 test this.
- Card removal, logout, or profile switching races with dispatch: revoke undispatched permission, and report already-dispatched payments as in flight. Task 4 and Task 6 test the boundary.
- The total remains under the cap while the merchant substitutes an item or destination: reject scope changes even though arithmetic passes. Task 1 and Task 4 test this.
- Authentication finishes after permission expiry or an out-of-order webhook arrives: reconcile the existing payment; do not authorize a new one or regress success. Task 4 and Task 7 test this.
- Returning customers have self-reported, revoked, foreign-account, or newly enrolled cards: only the original active owned set can win. Task 1, Task 3, and Task 6 test this.

## Provider decision and boundaries

The core ships using Stripe test payments with application-enforced limits. Visa access is not assumed: its [integration documentation is restricted](https://developer.visa.com/capabilities/visa-intelligent-commerce/docs), and [public examples require credentials/certificates](https://github.com/visa/ai/blob/main/apps/vic-api-examples/README.md). Downloadable examples do not grant access. No Visa credentials were obtained during planning.

VIC and Stripe SPT are optional follow-ups under the provider gate at the end. Do not block the primary implementation waiting for them, fabricate an integration, or label application policy as network enforcement. A test-store order is not an order at Nike/Alo/Amazon.

## Repository map

| Existing asset | How to use it |
| --- | --- |
| `src/server.js`, `public/index.html`, `public/app.js`, `public/style.css` | Host the new feature in the full portal; integrate through a separate route/UI module |
| `src/auth.js` / `src/state.js` | Registered portal identities and wallet products; exclude shared sample users |
| `src/connected-db.js:createDatabase(url, injectedPool)` | Reuse pool construction only; never connected-user identity or automatic connected migrations |
| `src/card-catalog.js:getRewardRule(card, {category})` | Published reward rules; caller's rate cannot override catalog |
| `src/domain.js:roundBps(amountCents, rateBps)` | Integer reward arithmetic; do not reuse synthetic quote/payment eligibility |
| `src/connected-ai.js` | Existing Gemini request conventions; preserve its separate research-only behavior |
| `tests/connected.test.js` | Injected pg-mem pattern; insufficient for real concurrency/rollback evidence |
| `scripts/browser-smoke.js` | Browser dependency discovery and screenshot patterns; leave the synthetic journey intact |
| `scripts/check.js` | Recursively checks JS syntax; build/lint/typecheck are the same check, not bundling/type analysis |

New core modules: `checkout-policy.js`, `checkout-repository.js`, `checkout-merchant.js`, `checkout-stripe.js`, `checkout-service.js`, `checkout-agent.js`, `checkout-runtime.js`, `checkout-routes.js` under `src/`, plus `public/checkout-ui.js`. Each has one responsibility defined in the spec. Script/test additions below follow the existing flat layout.

## Shared contracts

Use these names consistently; JavaScript objects below are interface descriptions, not an instruction to introduce TypeScript.

```text
Principal = {subjectKey: 'portal:<uuid>', userId, sessionDigest}
Cart = {merchantId, providerAccountId, sku, variantId, quantity,
  destinationHash, shippingOptionId, currency: 'USD', category: 'other',
  merchandiseCents, taxCents, shippingCents, totalCents, revision}
PublicCard = {cardId, productId, brand, last4, estimatedRewardCents, rateBps, sourceUrl}
Quote = {id, intentId, cart, rankedCards: PublicCard[], createdAt, expiresAt}
Decision = {allowed: boolean, code: string|null}
IntentView = {id, state, maxAmountCents, events, order: Receipt|null}
Receipt = {orderId, paymentId, merchantName, totalCents, currency, card,
  estimatedRewardCents, selectionReason, providerMode: 'test', confirmedAt}
PaymentResult = {id, accountId, livemode, status, amountCents, currency,
  customerId, paymentMethodId, orderId, clientSecret?}
```

`clientSecret` may appear only inside the provider adapter and an explicit owner-only payment-action/enrollment response. It is absent from IntentView, Receipt, tools, audits, and logs. Currency normalizes to `USD` internally and `usd` at the Stripe boundary. No model argument supplies a Principal.

## Task 1: Pure purchase policy and best-card decision

**Files:** Create `src/checkout-policy.js`, `tests/checkout-policy.test.js`.

**Interfaces:** Export `canonicalPurchaseHash(cart) -> string`, `validatePermission({intent, cart, cardId, activeCards, now}) -> Decision`, and `rankPaymentCards({cards, cart}) -> PublicCard[]`. Cards carry server-owned `cardId`, `productId`, `subjectKey`, `providerAccountId`, `active`, and display metadata; provider method references never leave the service.

- [ ] **Write failing tests** with these fixed assertions:

```js
assert.equal(validatePermission(fixture({maxAmountCents:11000, totalCents:14000})).code, 'AMOUNT_LIMIT_EXCEEDED');
assert.equal(validatePermission(fixture({maxAmountCents:11000, totalCents:10900})).allowed, true);
assert.equal(validatePermission(fixture({changedSku:true, totalCents:10000})).code, 'PURCHASE_SCOPE_CHANGED');
assert.deepEqual(rankPaymentCards(cardsFixture(10400)).map(c=>c.estimatedRewardCents), [208,156]);
```

  Add named cases for changed destination/currency/provider account; expired permission; revoked/foreign/newly added card; equal-reward stable ordering; empty or >10 allowed set; negative/decimal/unsafe cents; quantity outside 1–10; maximum above 50,000. Hash must ignore price changes but bind identity. Test helpers in this file build the spec's controlled merchant and enrolled-card examples.
- [ ] **Run red:** `node --test tests/checkout-policy.test.js`. Expect missing-export/module failure before implementation.
- [ ] **Implement exports** using `getRewardRule` and `roundBps`, fixed field ordering for the hash, strict integer/identity checks, and the spec's exact constraints. Stable error codes include `INVALID_PURCHASE`, `PERMISSION_EXPIRED`, `PURCHASE_SCOPE_CHANGED`, `AMOUNT_LIMIT_EXCEEDED`, `CARD_NOT_ALLOWED`, and `NO_ELIGIBLE_CARD`.
- [ ] **Run green:** same command; all policy cases pass without DB/network access.
- [ ] **Checkpoint commit:** `git add src/checkout-policy.js tests/checkout-policy.test.js`; commit `feat: define bounded purchase policy and card selection`.

## Task 2: Persistent permissions and controlled merchant

**Files:** Create `src/checkout-repository.js`, `src/checkout-merchant.js`, `scripts/migrate-checkout.js`, `tests/checkout-repository.test.js`, `tests/checkout-postgres.test.js`.

**Interfaces:** `createCheckoutRepository({pool, now})` exposes `migrate()`, `transaction(fn)`, `ensureSubject(principal)`, `createPreview(principal, snapshot)`, `authorizePreview(principal, {previewId,maxAmountCents})`, `getIntent(principal,id)`, `claimRun(intentId,workerId)`, `renewRun(intentId,workerId)`, `appendAction(intentId,event)`, and `listRecoverable()`. All DB data remains owner-scoped. `createCheckoutMerchant({repository,now})` exposes `seed()`, `listProducts(principal)`, `previewCart(principal,input)`, `readCart(intent,{tx}={})`, `reserve(tx,orderId,cart)`, and `finalize(tx,orderId,outcome)`; outcome is `confirmed` or `released`.

- [ ] **Write failing repository/merchant tests** for schema migration twice, seed twice without erasing existing orders, owner isolation, exact 10400-cent fixture, and unique preview consumption:

```js
const a = await repository.authorizePreview(alice,{previewId,maxAmountCents:11000});
const b = await repository.authorizePreview(alice,{previewId,maxAmountCents:11000});
assert.equal(a.id,b.id);
await assert.rejects(repository.authorizePreview(bob,{previewId,maxAmountCents:11000}), {code:'NOT_FOUND'});
```

  Also assert a duplicate preview with different permission parameters fails `IDEMPOTENCY_CONFLICT`; reserve/finalize twice changes stock once. In the real PostgreSQL suite use two pool clients to race authorization and verify rollback, lock ordering, and uniqueness. Skip that suite explicitly when `TEST_CHECKOUT_DATABASE_URL` is absent; never fall back to `DATABASE_URL`.
- [ ] **Run red:** `node --test tests/checkout-repository.test.js tests/checkout-postgres.test.js`. Expect missing modules; real-DB skips are not evidence of concurrency correctness.
- [ ] **Implement schema and merchant** from spec section 8, with dedicated-client BEGIN/COMMIT/ROLLBACK. Add a schema-version record. Use a JSONB payload for snapshots plus indexed ownership/state/unique columns. `authorizePreview` stores 300-second permission and a durable queued job atomically. Use DB row locks for inventory, unique `(intent_id)` orders and `(order_id)` attempts, and 60-second worker leases. Seed one black-headphone SKU with 9000 merchandise, 900 tax, 500 shipping per single-item example; quantity multiplies merchandise/tax, shipping is fixed per order. Seed fictitious owned destinations, no real addresses.
- [ ] **Run green** with pg-mem; then run `node --env-file=.env --test tests/checkout-postgres.test.js` with a dedicated test database URL. Test-created schemas must be unique and cleaned up without deleting existing schemas. Verify no connected tables are created by checkout migration.
- [ ] **Checkpoint commit:** stage Task 2 files; commit `feat: persist checkout permissions and merchant orders`.

## Task 3: Stripe sandbox enrollment and payment adapter

**Files:** Create `src/checkout-stripe.js`, `tests/checkout-stripe.test.js`; modify `package.json`, `package-lock.json`, `.env.example`.

**Interfaces:** `createStripeCheckoutProvider({stripeClient,secretKey,publishableKey,webhookSecret,expectedAccountId})` exposes `verifyAccount()`, `createCustomer({subjectKey,idempotencyKey})`, `createEnrollment({customerId,idempotencyKey})`, `getEnrollment(setupId)`, `getPaymentMethod(methodId)`, `detachMethod(methodId)`, `submitPayment({orderId,customerId,paymentMethodId,amountCents,currency,idempotencyKey}) -> PaymentResult`, `getPayment(paymentId) -> PaymentResult`, `cancelPayment(paymentId) -> PaymentResult`, and `verifyWebhook(rawBytes,signature) -> normalizedEvent`. The service, not the provider adapter, owns permission policy.

- [ ] **Write failing tests** against injected SDK methods: refuse live keys/live objects/wrong account, setup usage is `on_session`, payment uses the exact selected customer/method/amount, and idempotency is passed unchanged. Assert normalization keeps client secrets out of ordinary public projections. Verify signatures with fixture raw bytes, reject changed bytes, stale signatures and >256 KiB webhook bodies. Test decline vs timeout vs `requires_action` separately.
- [ ] **Run red:** `node --test tests/checkout-stripe.test.js`.
- [ ] **Install the official Stripe SDK and implement the adapter.** Resolve a current Node-20-compatible release, lock it, and record its tested API version. Do not infer credentials from examples. Verify expected Stripe account and test object mode. Use Customer + SetupIntent enrollment, consent tracked by service, and a card-only PaymentIntent with automatic capture, confirmed with the selected saved method while the user is present. Initial submission has fixed arguments; returns requiring authentication do not trigger a second intent. Use official signature verification. Consult [saved-card setup](https://docs.stripe.com/payments/save-and-reuse?payment-ui=elements) and [PaymentIntents](https://docs.stripe.com/payments/payment-intents).
- [ ] **Run green:** adapter tests plus `npm run build`. Add blank config examples; never commit `.env` or keys.
- [ ] **Checkpoint commit:** stage Task 3 files; commit `feat: add verified Stripe sandbox payment adapter`.

## Task 4: Guarded purchase service and payment recovery

**Files:** Create `src/checkout-service.js`, `tests/checkout-service.test.js`; extend repository/merchant and `tests/checkout-postgres.test.js` only for service persistence requirements.

**Interfaces:** `createCheckoutService({repository,merchant,provider,authAdapter,now})` exposes `startEnrollment(principal,{walletCardId,saveConsent})`, `completeEnrollment(principal,setupId)`, `listMethods(principal)`, `removeMethod(principal,cardId)`, `createPreview(principal,input)`, `authorize(principal,input)`, `readCart(context)`, `rankCards(context) -> Quote`, `executePurchase(context,{quoteId,cardId}) -> IntentView`, `getStatus(principal,intentId)`, `getPaymentAction(principal,intentId)`, `cancel(principal,intentId)`, `reconcile(intentId)`, `acceptWebhook(event)`, and `revokeSession(principal)`. Internal context is `{principal,intentId}` resolved by the runtime, never client/model identity.

- [ ] **Write failing tests** proving enrollment verifies setup/customer/subject ownership and only successful test setups attach. Test over-limit, changed scope, stale quote, wrong card, revoked consent/method, and expired permission with `assert.equal(provider.submitCalls.length,0)`. Race two valid executions with different suggested cards; only deterministic winner can dispatch.
- [ ] **Add recovery tests before implementation:** provider records success then times out; local process dies after dispatch commit; local save fails after provider success; webhook arrives before submit response; webhook replay/out-of-order; provider returns mismatched amount/method/order/account; replay after 23 hours with no known ID stays unresolved. Assert stable key/request, one provider payment, one receipt, one stock change. Add logout/removal/cancel versus dispatch ordering and authentication completion after permission expiry. Use real PostgreSQL for races/rollback, not just pg-mem.
- [ ] **Run red:** `node --test tests/checkout-service.test.js tests/checkout-postgres.test.js`.
- [ ] **Implement service and repository methods:** atomically persist final quote/card/amount/order/attempt, commit before network I/O, and reconcile using spec section 9. Enrollment never accepts caller-supplied raw method IDs as proof of ownership. Store consent and provider account with method mapping. Strictly project public views; model never sees customer IDs, method IDs, client secrets, or full destinations. Use provider-returned metadata to verify order linkage. Payment state governs over agent state. No decline fallback to another card. Unknown provider results retain reservation and `payment_pending`.
- [ ] **Implement revoke hooks** under the subject lock: cancel undispatched permissions before logout/profile switch; revoke a removed card before modifying JSON wallet state; defer provider detach for unresolved attempts. A committed dispatch returns in-flight status and remains reconcilable. Add `getOrderForIntent`, `withDispatchClaim`, `recordPaymentResult`, `recordWebhook`, and `revokeUndispatched` repository methods with service-owned callers and dedicated-client transactions.
- [ ] **Run green:** service suite plus real-DB suite. Verify success cannot be regressed by stale events and invalid unsigned events never reach the repository.
- [ ] **Checkpoint commit:** stage Task 4 files; commit `feat: enforce purchase permissions and reconcile payments`.

## Task 5: Actual Gemini checkout tools

**Files:** Create `src/checkout-agent.js`, `tests/checkout-agent.test.js`.

**Interfaces:** `createCheckoutAgent({apiKey,model,fetchImpl,service,repository,now})` exposes `run(context,{signal}) -> IntentView`. Export `dispatchCheckoutTool({name,args},context,{service})` for independent guard tests. The only tools are `read_cart({})`, `rank_cards({})`, `execute_purchase({quoteId,cardId})`, and `get_order_status({})`.

- [ ] **Write failing protocol tests** with actual Interactions response shapes and a fake transport returning function calls in sequence. Assert calls correlate via IDs and stateless history, `store:false`, fixed server identity, and the service's recorded result. Fixture model prose claiming success without execution must leave the purchase unconfirmed.
- [ ] **Add adversarial tests:** unknown tool, arbitrary URL, extra `amount`/`userId`/`approved` arguments, invalid quote/card ID, 9th tool, 7th model turn, duplicate mutations in one response, prompt injection in product text, and 45-second deadline. Assert no illegal call reaches provider. Assert repeated execution cannot create another order. Capture request bodies and prove they contain no setup/client secrets, cookies, provider method/customer IDs, or street addresses.
- [ ] **Run red:** `node --test tests/checkout-agent.test.js`.
- [ ] **Implement the bounded loop** using [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling). Preserve transient protocol steps required for continuation; store only redacted named actions, never hidden reasoning. Use `GEMINI_CHECKOUT_MODEL || GEMINI_MODEL || 'gemini-3.8-flash'` as the existing-project default, but require a capability check before a live demo. Execute valid tools sequentially, enforce 6 calls/8 invocations/45 seconds, reject extra fields before dispatch, and stop model work after execution. No generic fetch/shell/browser tool. Pre-dispatch provider/model failure revokes the unused permission; post-dispatch errors cannot override payment state.
- [ ] **Run green:** agent and service tests. A direct call to `dispatchCheckoutTool` must still hit all service guards; the system prompt is not the security boundary.
- [ ] **Checkpoint commit:** commit `feat: run constrained Gemini checkout tools`.

## Task 6: Portal runtime, authenticated API, and webhook routing

**Files:** Create `src/checkout-runtime.js`, `src/checkout-routes.js`, `scripts/start-checkout.js`, `scripts/preflight-checkout.js`, `tests/checkout-api.test.js`; modify `src/server.js`, `package.json`, `.env.example`.

**Interfaces:** `createCheckoutRuntime({auth,store,pool,provider,agentFactory,now}) -> {routes,start,close,beforeLogout,beforeWalletRemove}`. Its auth adapter exposes `resolvePrincipal(session)`, `isSessionActive(principal)`, and `getWalletCards(principal)` with `portal:<uuid>` identity. `createCheckoutRoutes({service,runtime,config})` exposes `handle(req,res,{path,session,user,origin}) -> Promise<boolean>` and `handleWebhook(req,res)`. `createApplication({checkoutRuntimeFactory,...existingOptions})` retains its synchronous return and exposes optional async `startCheckout()`/`closeCheckout()` methods.

- [ ] **Write failing HTTP tests** for every spec route using injected pool/provider/agent. Assert registered owner isolation, 403 for samples/extension bearers, exact route body allowlists, same-preview/same-intent behavior, and no client `outcome` can claim success. Origin tests must reject absent or foreign Origin on browser mutations; read requests require session. Bind payment controls to the configured portal origin, not the sibling storefront origin.
- [ ] **Add integration tests** for raw webhook routing before generic JSON/session handling, corrupt signature rejection, 256 KiB body limit, durable event acceptance, and unknown route 404. Test logout/profile-switch/wallet-removal hooks. Disabled checkout must leave all existing tests and synthetic startup working without pg/Stripe imports or credentials; webhook exception must not exempt other routes.
- [ ] **Run red:** `node --test tests/checkout-api.test.js`.
- [ ] **Implement narrow hooks:** authenticate with registered AuthStore and StateStore users, deny samples, namespace IDs, and construct runtime lazily only in the checkout entry point. Reuse `createDatabase(...).pool` without connected migration. Add the separate webhook branch before readBody; retain all existing Host/Origin rules elsewhere. Do not serialize whole database rows. Mutations accept at most 16 KiB JSON. Use separate per-user limits of 3 new previews per minute and 3 new intents per minute, plus one undispatched active run; identical replay is allowed without a new-intent quota charge. Reconcile at most once per 5 seconds per order across UI/worker callers. Rate limits and queues are subject-scoped and persisted for restart consistency.
- [ ] **Implement startup/readiness:** explicit schema check, account/test-mode verification, worker recovery and graceful shutdown. `start()` checks queued runs every second and reconciles eligible attempts every 5 seconds; `close()` stops new claims and releases DB resources after bounded drain. Preflight makes read-only database/account checks and reports model/webhook configuration separately from successful integration evidence. `CHECKOUT_ORIGIN` defaults to the portal's localhost/PORT origin and is validated as loopback; do not inherit connected `PUBLIC_ORIGIN`. Public key is safe browser config; all secrets remain server-side. Register `dev:checkout`, `checkout:migrate`, and `preflight:checkout` scripts with `.env` loading only in those commands.
- [ ] **Run green:** checkout API tests, `npm test`, and `npm run build`; start the disabled demo and the enabled injected runtime on separate test ports.
- [ ] **Checkpoint commit:** commit `feat: expose authenticated agent checkout in the portal`.

## Task 7: One-click portal experience and browser verification

**Files:** Create `public/checkout-ui.js`, `scripts/checkout-browser-smoke.js`; modify `public/app.js`, `public/index.html`, `public/style.css`, `package.json`, and the checkout response CSP in `src/server.js`.

**Interfaces:** Browser module exposes `window.CheckoutUI.mount({root,api,onWalletChanged})`, `openProduct(sku)`, and `dispose()`. Use the existing portal API conventions. Stripe enrollment and payment-action client secrets never enter generic app state persisted to storage.

- [ ] **Write the failing browser journey** using temporary portal/auth data, injected pg-mem/model/payment adapters, and ports 3304/3305. Assert one purchase click after prior enrollment; displayed maximum/card set; real tool dispatcher count; best card; success receipt; blocked $140 attempt; duplicate click; refreshed pending order; logout/profile switch clears previous user's UI. Assert escaping of product/model text and usable mobile layout.
- [ ] **Run red:** `node scripts/checkout-browser-smoke.js` with the existing `PLAYWRIGHT_MODULE_PATH` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` conventions. Expect missing UI selectors until implementation.
- [ ] **Implement the UI** from spec section 3. Show a Buy with PerkPilot panel in the current portal's controlled test-store product detail and enrollment in Wallet. The button creates permission and starts the real run, with no second normal-path approval. Default cap to displayed total, require an explicit visible edit for $110. Use saved fictitious destination choices and original enrolled set. Sample users see signup guidance. Label synthetic insights separately from provider-backed test orders.
- [ ] **Implement async states:** 1-second polling/5-second pending backoff; server-derived receipt/progress; cancel before dispatch; clear sensitive in-memory state on user switch; render bank challenge through the current Stripe SDK action handler for the existing intent, then reconcile server-side. Never create a replacement payment from browser code. After refresh use the persisted intent ID, checking owner before rendering. Store at most that opaque ID locally. Provide accessible focus, disabled submitting state, and aria-live status.
- [ ] **Restrict Stripe browser integration:** load Stripe.js directly from its official origin only when enrollment/challenge needs it; change CSP only to the documented origins required by this integration. Verify those origins using Stripe's current browser-security docs during implementation. Keep payment iframe and client secret outside any AI access. Failures must show actual reason/status, not a generic success toast.
- [ ] **Run green:** checkout browser smoke desktop/mobile; inspect screenshots; run existing `npm run test:browser` once to check the unchanged synthetic journey. Record `test:checkout:browser` in package scripts. Challenge rendering is mocked here; Task 8 verifies real provider authentication.
- [ ] **Checkpoint commit:** commit `feat: add Buy with PerkPilot checkout experience`.

## Task 8: Presenter scenarios, integration evidence, and handoff

**Files:** Create `scripts/checkout-demo.js`, `scripts/verify-checkout.js`, `tests/checkout-demo.test.js`, `CHECKOUT.md`; extend merchant/repository only for isolated one-shot scenarios; update `.env.example`, `README.md`, `package.json`.

**Interfaces:** Demo CLI supports `seed`, `arm --subject <portal:uuid> --scenario price-increase`, `arm --subject <portal:uuid> --scenario prompt-injection`, and `clear --subject <portal:uuid>`. Scenarios are persisted in a dedicated prefixed table, consumed once when the subject's next intent is created, and applied by the merchant adapter only to that intent. A scoped cart revision changes with the overlay; no global product is repriced. They never change permission validation.

- [ ] **Write failing scenario tests:** controls disabled by default; flag and loopback/local database fixture required; no public scenario route; subject isolation; one-shot consumption; $140 read after $110 approval yields zero provider calls. Direct malicious `execute_purchase` still fails. Replays retain one payment. Define a test-adapter transport failure after payment acceptance and assert recovery of the original payment.
- [ ] **Run red:** `node --test tests/checkout-demo.test.js`.
- [ ] **Implement CLI and verification script.** Require `PERKPILOT_CHECKOUT_DEMO_CONTROLS=1` for scenario mutation. `verify-checkout.js` requires explicit test-provider configuration and a dedicated registered test subject; it may create only labeled test records. Record provider account/test mode, successful order/payment ID, model tool events, webhook delivery, decline, challenge, blocked amount and replay evidence. Never print keys/client secrets/customer payment references. Save a redacted report to gitignored `test-results/checkout/verification.json`; distinguish automated checks from interactive provider authentication.
- [ ] **Run actual sandbox verification** after provisioning an authorized sandbox and enrolling test cards via the actual fields. Use provider-documented test cards, complete the test authentication challenge, confirm the signed local webhook, and inspect the same payment ID in the dashboard. Run the real PostgreSQL concurrency/restart suite with an isolated database. If keys/model/DB access are unavailable, record that limitation and do not mark integration acceptance complete.
- [ ] **Write CHECKOUT.md** with setup, migrations, seed, local webhook forwarding, credentials-only configuration, registered-user enrollment, commands, 90-second demo, expected refusal copy, recovery, and evidence interpretation. Document that a purchase in PerkPilot Test Store does not place an external merchant order and reward estimates are not posted benefits. Add the optional provider gate below and link this plan/spec from README.
- [ ] **Final verification:** `npm test`; `npm run build`; `node --env-file=.env --test tests/checkout-postgres.test.js`; `npm run test:checkout:browser`; `npm run test:browser`; `node --env-file=.env scripts/verify-checkout.js`. Run each appropriate suite once after changes stabilize; rerun only relevant failures/new changes. No passing claim for skipped integrations.
- [ ] **Checkpoint commit:** commit `test: verify agent checkout and blocked purchase demo` with implementation evidence summarized in the eventual PR.

## Optional provider gate — separate from core acceptance

Do this only if usable access becomes available. Do not silently turn it into a dependency or write an untested adapter into the active path.

| Provider | Evidence required before implementing/claiming integration |
| --- | --- |
| VIC | Team-authorized credentials/certificates and test identities; authenticated instruction plus credential workflow against approved sandbox endpoints; merchant integration compatible with those credentials; accurate sandbox labeling |
| Stripe SPT | Actual agent-issued token granted to the intended test seller, successful seller redemption, and provider rejection for over-limit/expired/wrong-seller use. Test-helper-only issuance is insufficient. |

Record the result and pinned API versions in `CHECKOUT.md`. A provider adapter change retains all application permission tests and adds provider-specific ones. Update UI enforcement labels only with evidence. Creating accounts, requesting Visa access, or emailing representatives is not part of this documentation task.

## Completion checklist for the recruiter demo

- [ ] Registered presenter has two enrolled test methods, mapped clearly to reward products.
- [ ] One click authorizes displayed item/merchant/destination/maximum/card set.
- [ ] Actual Gemini function calls read the cart, rank cards, and invoke guarded execution.
- [ ] Provider confirms a test payment; receipt matches that payment and one persisted order.
- [ ] $140 repricing under $110 permission is blocked before any payment dispatch.
- [ ] Direct invalid tool calls, duplicate clicks and network ambiguity cannot create extra charges.
- [ ] Challenge, decline, restart and signed-webhook paths have recorded evidence.
- [ ] No claim of Visa network enforcement, external-store purchase, or posted rewards exceeds the integration evidence.

## Implementation handoff

The approved plan and product spec now guide implementation in the development branch. Provider verification and recruiter-demo acceptance remain gated by recorded sandbox and real-database evidence. Review should focus on the permission/dispatch boundary, recovery, and truthful evidence labels before declaring the integration complete.
