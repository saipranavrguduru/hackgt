# Shared contracts

All amounts are integer USD cents; rates are integer basis points. `null` means unknown and prevents checkout approval. Errors are `{ "error": { "code": "...", "message": "..." } }`. APIs use `/api/v1`.

Local portal identity uses an HttpOnly `perkpilot_session` cookie. Every private record is scoped to the signed-in user. Cross-origin mutations require the matching local origin or an explicitly paired extension origin. JSON requests are bounded to 64 KiB.

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/demo`; `GET /auth/session` |
| Profile | `GET /bootstrap`; `GET/PATCH /profile`, `/preferences`; `POST /profile/regenerate` |
| Finance | `GET /finance/summary`, `/finance/transactions`, `/finance/cards`, `/finance/card-products`; `POST /finance/cards`; `DELETE /finance/cards/:id` |
| Location | `POST /location/recommendations`, `/location/nearby` (portal authentication only) |
| Discovery | `GET /commerce/offers`; `POST /commerce/offers/:id/activate`, `/feedback`; `GET/PATCH /commerce/notifications/:id` |
| Missions | `GET/POST /commerce/missions`; `PATCH/DELETE /commerce/missions/:id`; `GET /commerce/missions/:id/matches` |
| Research | `POST /research/sessions`; `GET/PATCH /research/sessions/:id`; `GET /research/sessions/:id/candidates`, `/research/products/:id/brief`; `POST /research/comparisons`; `GET /research/comparisons/:id`; `GET/POST /research/watchlist`; `DELETE /research/watchlist/:id` |
| Quotes | `POST /commerce/quotes`; `GET /commerce/quotes/:id` |
| Checkout | `POST /checkout/sessions`; `GET /checkout/sessions/:id`; `POST /checkout/sessions/:id/confirm` |
| Rewards | `GET /rewards/purchases`, `/rewards/purchases/:id`, `/rewards/summary` |
| Assistant | `POST /assistant/messages` with `{message}` |
| Extension | `POST /extension/pairings`, `/extension/pairings/:id/approve`, `/extension/pairings/:id/exchange`; `DELETE /extension/session` |
| Demo | `POST /demo/offers/publish`, `/demo/purchases/:id/events`, `/demo/listings/price`, `/demo/reset` |

Quotes take `{productId,quantity?}` and optionally the extension's `{cart}` snapshot. The server obtains authoritative product prices. It compares cart product, quantity, USD currency, merchandise, shipping, tax, and catalog version. Unknown tax/shipping may be explicitly represented by null. Monetary overrides cannot spoof prices. All plans come from `createQuote` in `src/domain.js`.

Location recommendations take `{category,placeName?,amountCents?}`. Categories are `dining`, `groceries`, `gas`, `drugstores`, and `other`; names are bounded to 120 characters. Optional amount is positive integer USD cents up to 100,000,000; omitted/null returns percentage-only results. The response includes `cards` ranked by reward rate, `bestCardId`, `explanation`, and `disclaimer`. Each card includes canonical issuer rule/source, reward/base rates, optional reward/base cents, and synthetic or self-reported ownership. Unknown card products are excluded and counted in `unsupportedCardCount`; an empty Wallet stays empty. Ties use the user's preferred card, then stable card ID. Submitted user IDs or reward rates cannot override authenticated identity or issuer metadata. `getRewardRule` in `src/card-catalog.js` is shared with quotes, where the category comes from the server's merchant record.

Nearby search takes `{latitude,longitude,accuracyMeters,consent:true}` with finite numeric coordinates and accuracy from 0 to 1,000 meters. It issues a bounded, fixed-host HTTPS POST to Overpass with a 10-second timeout and 1 MiB response cap. Up to 12 nearest mapped candidates within 500 meters are returned as `{id,name,category,categoryLabel,distanceMeters,sourceUrl}`, alongside accuracy, search radius, OpenStreetMap attribution, and `requiresConfirmation:true`. Mixed-use stores are `other`. No automatic merchant-code verification is implied. Missing consent/invalid coordinates return 400; rate limiting returns 429; unavailable/malformed provider responses return 502; timeouts return 504. No fabricated-place fallback is used. Six requests per user per minute are permitted; the limiter stores only user IDs and timestamps in memory. Coordinates and visit context are never written to application state or logs. Neither location endpoint creates a quote or purchase, and neither is available to extension tokens.

Quote plans expose `checkoutCents`, `statementCreditCents`, `rewardCents`, `effectiveCostCents`, conditional activation benefits, prerequisites, and disallowed benefit reasons. Quote expiration, product snapshot, activation state, card ownership, offer rules, and eligibility are checked again before approval.

Checkout creation takes `{quoteId,cardId}`. Confirmation requires `{approved:true,outcome?:"approved"|"declined"|"processing"}` from portal authentication. Repeated confirmation returns the same purchase. Extension tokens can prepare checkout but cannot approve it. Registered users' self-reported cards cannot execute payments.

Demo events are `settled`, `qualified`, `credit_posted`, `reward_posted`, and `returned`/`refunded`, with an optional stable `eventId`. Event identity and benefit identity both deduplicate recognition. Returns append signed reversal entries. Confirmed totals exclude expected benefits and use the user's demo-calendar year.

Pairing creation returns `{id,secret,approvalUrl,expiresAt}`; the portal explicitly approves the ID. A one-use exchange of `{secret}` returns a 30-minute bearer token. The token scope permits quotes, offer activation, product briefs, checkout preparation, and revocation only.

Fixture dates are based on `state.clock`, injected into `createFixtures`. Runtime sessions and approval expiration use wall time. Persisted files are single-process local demo storage only.

Public map capacity is shared across signed-in users within one application process: one active query, 100 attempts per 24 hours, and a conservative 10,000,000-byte response budget. Each new request reserves room for the 1 MiB response cap before admission. HTTP 406/429 from Overpass triggers a shared 30-second cooldown; cooldown, capacity, and daily-budget errors return 503 with manual-entry guidance. `createNearbyPlacesService` keeps only counters/timestamps, never location history. Its clock and fetch dependency are injectable for deterministic tests.
