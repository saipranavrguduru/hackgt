# Live integration boundary

`PERKPILOT_MODE=live` returns HTTP 503 for application API operations. It never substitutes synthetic financial records. The preflight command intentionally fails until the following capabilities are implemented and verified:

- Production identity, explicit consent, verified account ownership, recovery, HTTPS and deployed CSRF/session controls.
- Transactional durable storage for user records, quotes, approvals, provider attempts, stable events and ledger entries.
- Approved finance access with transaction status, replacement identifiers, coverage, freshness and outage handling.
- Current merchant offers and user-specific issuer assignment, activation, terms and consumption.
- Permitted product/search/listing sources with citations, observed prices, availability and evidence freshness.
- An approved payment sandbox or merchant adapter with exact cart validation, separate payment tokens and explicit approval.
- Signed/stable settlement and benefit events, refund reversal and duplicate delivery recovery.
- Operational probes, privacy-conscious logging, restart recovery and a consenting test-account rehearsal.

Setting an API key or toggling a flag does not satisfy these gates. The optional model provider only interprets requests and explains structured conclusions. Real card names and base rules do not establish a user's account, current issuer eligibility, or posted rewards.

The demo's optional location picker can query live public OpenStreetMap places after an explicit browser permission request. This is a separate map-data integration, does not make financial data live, and cannot verify issuer merchant category codes. The app does not retain coordinates or visits; provider availability/coverage and merchant coding remain uncertain. Production use should review public Overpass capacity/usage policies and provider privacy terms. Manual category recommendations remain available without a map request.
