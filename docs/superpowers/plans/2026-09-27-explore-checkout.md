# Explore product checkout

**Goal:** Open an Explore listing and complete the existing bounded Stripe sandbox checkout for that selected product inside its detail sheet.

**Design:** Registered Explore search issues short-lived, owner/session-bound references for eligible server-observed USD listings. A reference imports an immutable, owner-scoped product into PerkPilot Test Store. The existing preview, approval, card ranking, payment, webhook, and recovery services remain the payment path. Listing price is merchandise; sandbox fees are 10% test tax and $5 test shipping, within the existing $500 total limit. Retailer names remain listing attribution; this does not place an external retailer order.

- [x] Backend: issue bounded references; resolve and import without accepting browser prices; preserve owner isolation and immutable approved product snapshots. Add price, expiry, identity, and tampering regressions.
- [x] Checkout panel: support a locked selected SKU/variant inside a product sheet, preserve enrollment and recovery, and never substitute the default item if selection is unavailable.
- [x] Explore: make listing images/titles/actions open product details; embed checkout with clear source and sandbox labels; handle unavailable listings and stale requests; preserve the product through wallet setup.
- [x] Verify: unit suite, build, and browser journey from Explore through card setup, selected-product approval, receipt, navigation/recovery, and mobile layout. Use isolated provider/model fixtures for regression checks; do not spend real provider quota for every iteration.
- [x] Review and restart the local application. Keep local credentials untracked.

Verification: 231 unit tests passed; the dedicated real-PostgreSQL concurrency test was skipped because its test database was not configured. Static build checked 87 JavaScript files. Explore checkout, existing checkout, and integrated portal browser suites passed with isolated provider/model fixtures. Desktop and mobile screenshots were inspected. Restarted application and test store both returned HTTP 200.

Delivery: publish the code changes on `codex/buy-with-perkpilot` under the user's standing push authorization.

Implementation is split by file ownership: backend agent owns server/merchant/service/routes and backend tests; checkout panel agent owns checkout-ui.js/checkout.css and its tests; root owns Explore/app integration, product sheet styling, docs, and browser verification.
