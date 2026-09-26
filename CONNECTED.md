# Connected PerkPilot

The connected app is a separate path from the local synthetic demo. It stores registered users and imported bank records in PostgreSQL, uses Plaid Link for permissioned account connection, calls Gemini (or optional OpenAI) for assistant answers, and searches Google Shopping through SerpApi when configured. eBay and an authorized Shopify store remain optional catalog fallbacks. It does not show fictional offers, simulate payment, or claim that card rewards posted.

## What access is needed

1. PostgreSQL and `DATABASE_URL`.
2. Plaid `PLAID_CLIENT_ID` and `PLAID_SECRET`. Start with `PLAID_ENV=sandbox`. Sandbox connects test institutions and returns test transactions; it is **not live personal financial data**. Use an approved Development or Production environment for actual accounts. For desktop web Sandbox, leave `PLAID_REDIRECT_URI` unset. A redirect is needed for embedded webviews; register its exact URL in the Plaid Dashboard. Sandbox permits `http://localhost:3400/`; a public URL needs HTTPS.
3. A 32-byte base64 `PLAID_TOKEN_ENCRYPTION_KEY`. Keep and back up this key; changing it makes stored Plaid tokens unreadable. Generate one with `openssl rand -base64 32`. A random key has been generated in the local gitignored `.env` for this workspace.
4. `GEMINI_API_KEY` for assistant answers (or `OPENAI_API_KEY` as an alternative). When both are set, Gemini takes precedence. The connected assistant returns an error if the selected provider has no key. It sends aggregate spending facts, not raw bank transactions or account credentials, and requests `store:false`.
5. `SERPAPI_API_KEY` for broad Google Shopping results. `SERPAPI_LOCATION` is only the fallback for accounts that have not chosen a location; it defaults to `United States`. Each user can enter a city during signup, edit it beside product search, or use browser location to save a city-level value. `SERPAPI_GL` and `SERPAPI_HL` control country and language. SerpApi takes precedence over the existing eBay and Shopify fallbacks. This is optional for bank connection and AI. Without a catalog provider, search returns an explicit unavailable error and the assistant works on spending facts only.
6. `PUBLIC_ORIGIN`, exactly matching the browser origin, including `https://` on a public host. Local default is `http://localhost:3400`.

The app does not load `.env` automatically. Put local secrets in the gitignored `.env` (never `.env.example`) and run commands with `node --env-file=.env`, or configure a host secret manager. For example:

```sh
npm ci
node --env-file=.env scripts/verify-plaid.js
node --env-file=.env scripts/verify-serpapi.js
node --env-file=.env scripts/preflight-connected.js
node --env-file=.env scripts/verify-connected.js
node --env-file=.env src/connected-server.js
```

Open `http://localhost:3400`. The process creates its PostgreSQL tables on startup. The existing `npm run dev` remains the controlled synthetic demo on ports 3000/3001.

`preflight:connected` checks required configuration and database reachability. `verify:connected` makes real Plaid link-token and selected AI provider requests, and a catalog request only if catalog credentials are present. It does not link a bank or charge anything.

If you only have Plaid credentials so far, run `npm run verify:plaid`. It checks a Sandbox link-token request without a database, model key, or catalog key and prints no secrets.

## What the connected path does

- Registers and signs in a separate user account. Sessions use a hashed random token in an HttpOnly, SameSite=Strict cookie. Public HTTPS origins also set Secure.
- Saves an optional city, region, and country for each account and sends it with that user's SerpApi searches. “Use my location” requires browser permission, sends coordinates once to OpenStreetMap Nominatim for city-level reverse geocoding, and stores only the returned location text. Exact coordinates are not stored. The lookup is user initiated, rate limited, and cached; a commercial or self-hosted geocoder can replace it through `GEOCODER_URL` if public traffic grows.
- Requires explicit spending-insights consent before creating a Plaid Link token. Link returns a public token to the browser; the server exchanges it and encrypts the access token at rest.
- Imports accounts and the `added`, `modified`, and `removed` pages from Plaid `/transactions/sync`. Transactions, accounts, and the sync cursor commit in one database transaction. A posted transaction replaces its matching pending record when Plaid supplies that identity.
- Supports manual refresh, disconnect with imported-data deletion, and account deletion. There is no background bank sync or webhook receiver yet.
- Shows Spend DNA from gross posted connected USD purchases, with coverage and last-sync labeling. Refunds are excluded from those totals. Bank categories and merchant names are provider data; item-level purchases are unknown.
- Searches Google Shopping through SerpApi and briefly caches identical searches to limit paid API usage. Search results carry observed time and merchant source. Depending on the result, the link opens either the merchant listing or Google Shopping product options. Tax, final shipping, inventory, and card offers are **not** verified by PerkPilot.
- Sends the user's question, aggregate Spend DNA, and up to five fresh server-fetched listings from the last search to Gemini or OpenAI with `store:false`. The model cannot authorize purchases, and the app does not send bank credentials or raw transactions.

## Deploy

`render.yaml` defines a Render web service and a private PostgreSQL instance. Create a Blueprint from this repository, enter the `sync:false` secrets in Render, including a 32-byte base64 encryption key, and set `PUBLIC_ORIGIN` to the final `https://...onrender.com` URL or custom domain. Render's proxy terminates HTTPS; the Node server binds to `0.0.0.0:$PORT`. The defined compute/database plans may incur charges; review them in Render before creating resources. The health endpoint is `/api/health` and probes the database.

Do not invite real users until you have a privacy policy, data-retention policy, account-recovery flow, email verification, backup/restore rehearsal, provider-access approval, and security review. The implementation has origin checks, session controls, limited login attempts, encrypted Plaid tokens, a narrow CSP, and user-scoped database reads, but those controls alone are not a production financial-data program.

## Current boundaries

- Plaid Sandbox transactions are test data. Real accounts require Plaid Development or Production authorization and a consenting test user.
- A self-reported card is not issuer-verified ownership. No issuer offer assignment, activation, credit posting, or Visa payment token is connected.
- A listing price is not a final cart total. Connected mode does not calculate a purchase quote or confirmed savings.
- PostgreSQL, Plaid Sandbox, and Gemini have been verified locally. SerpApi still needs `SERPAPI_API_KEY`, and a public deployment has not been verified.

Provider references: [Plaid Transactions](https://plaid.com/docs/transactions/), [Plaid OAuth redirects](https://plaid.com/docs/link/oauth/), [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), [SerpApi Google Shopping](https://serpapi.com/google-shopping-api), [SerpApi Locations](https://serpapi.com/locations-api), [Nominatim reverse geocoding](https://nominatim.org/release-docs/latest/api/Reverse/), [OpenStreetMap Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/), [eBay Browse API](https://developer.ebay.com/develop/api/buy), [Shopify Storefront products](https://shopify.dev/docs/api/storefront/latest/queries/product), [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text), [Render web services](https://render.com/docs/web-services).
