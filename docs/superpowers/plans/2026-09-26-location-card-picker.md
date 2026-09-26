# Location card picker

User-authorized follow-up: add “I'm at…” manual category selection and optional GPS-based nearby places to recommend a card already in Wallet.

## Design

- Entry points in For You and Wallet open a temporary sheet. Manual Dining, Groceries, Gas, Drugstores, or Other / unsure works without location access. Optional place name and USD purchase amount.
- A deliberate Locate me click requests one browser geolocation reading. Before the click, disclose coordinates sent through the server to OpenStreetMap's Overpass service. No coordinates or location history are persisted.
- Return nearby places within 500 meters with distance, mapped category, attribution, and GPS accuracy. Require the user to choose/confirm a place and category; proximity and mapped types cannot verify merchant category codes.
- Rank only owned Wallet cards, using canonical published rules shared with the quote engine. Support Freedom Unlimited's 3% dining/drugstore rules, keep flat rates and Discover's 1% fallback. Exclude rotating-category, promotional and unverified card-linked benefits.
- Category rates are conditional on merchant coding, with base fallback shown. Amount omitted means percentage only. Empty Wallet remains empty.
- Reject stale async responses on sheet close/new lookup/logout. Permission denial, poor accuracy, provider failure and no matches leave manual entry usable.

## API

Authenticated portal-only POST `/api/v1/location/nearby`: `{latitude,longitude,accuracyMeters,consent:true}`. Fixed provider URL, strict inputs, bounded response/query, timeout, user rate limit; response contains places and accuracy, never raw coordinates.

Authenticated portal-only POST `/api/v1/location/recommendations`: `{category,placeName?,amountCents?}`. Returns sorted owned cards, reward/base estimates, issuer source and rule limitations. Neither endpoint changes purchase or financial state.

## Implementation and verification

1. Shared category reward helper and pure ranking function; domain tests preserve Alo golden arithmetic and test ownership, input bounds, unsupported categories and missing amount.
2. Overpass adapter with mocked external responses for mapping, ambiguity, distance, errors and privacy.
3. Server routes with auth, validation, rate limiting and no persistence of submitted location data.
4. Responsive sheet with manual/GPS flows and stale-operation protection.
5. API tests, full suite/build, desktop/mobile browser verification, source/code review, README/API documentation.

Issuer sources: [Chase product](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited), [Chase categories](https://www.chase.com/personal/credit-cards/rewards-category-faq), [Wells Fargo terms](https://www.wellsfargo.com/credit-cards/documents/active-cash-terms/), [Capital One](https://www.capitalone.com/learn-grow/money-management/capital-one-quicksilver-vs-savor/), [Discover](https://www.discover.com/credit-cards/cash-back/cashback-bonus.html). Verified September 26, 2026. [Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition) requires browser permission; [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) is a public service and may be unavailable.
