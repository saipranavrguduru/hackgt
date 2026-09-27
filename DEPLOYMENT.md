# Free Render deployment

Deploy the complete PerkPilot app from `main` as a **Free Node web service** in Oregon. The repository's `render.yaml` reuses an existing PostgreSQL database; it creates no database, paid disk, or paid compute plan.

## Service settings

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/saipranavrguduru/hackgt` |
| Branch | `main` |
| Runtime | Node 24 |
| Compute | Free |
| Build | `npm ci && npm run build` |
| Start | `npm run start:hosted` |
| Health check | `/api/health` |
| Portal and storefront | `https://<allocated-name>.onrender.com` and `/store` |

The hosted entrypoint binds to Render's `PORT` on `0.0.0.0`, uses PostgreSQL for portal accounts, sessions, wallet cards, and tracked rewards, and performs idempotent schema setup. Hosted tables use the separate `perkpilot_hosted` schema so local and hosted checkout workers cannot claim each other's jobs. Local `npm run dev:checkout` continues using local JSON identity and the original database schema unless explicitly configured otherwise.

## Environment

Transfer the needed credentials directly from local `.env` into Render's environment settings. Never commit `.env` or include it in a deployment artifact.

- `DATABASE_URL`: reuse the existing database. Prefer its internal connection URL when the service and database are in the same Render account and Oregon region. Check the database's current plan and expiration; this Blueprint does not extend its lifetime or change its billing.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_CHECKOUT_MODEL`: retain the working provider/model configuration.
- `SERPAPI_API_KEY`, `SERPAPI_LOCATION`, `SERPAPI_GL`, `SERPAPI_HL`: Explore catalog search.
- `PLAID_ENV=sandbox`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_TOKEN_ENCRYPTION_KEY`: optional connected bank sandbox. Preserve the existing encryption key when reusing encrypted Plaid records.
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_EXPECTED_ACCOUNT_ID`: the authorized Stripe **test** account, never live keys.
- `PERKPILOT_PORTAL_STORAGE=postgres`, `PERKPILOT_DATABASE_SCHEMA=perkpilot_hosted`, `PERKPILOT_MODE=demo`, `PERKPILOT_CHECKOUT_DEMO_CONTROLS=0`.

Do **not** copy local `PORT`, `STORE_PORT`, `PUBLIC_ORIGIN`, `CHECKOUT_ORIGIN`, or the local CLI `STRIPE_WEBHOOK_SECRET`. Render injects `RENDER_EXTERNAL_URL`, which supplies the exact public HTTPS origin automatically. For a custom domain, explicitly set the matching `PUBLIC_ORIGIN` and checkout webhook URL.

## Enable Stripe checkout

The initial Blueprint sets `PERKPILOT_CHECKOUT_ENABLED=0` so a public URL can be allocated before configuring Stripe's webhook. This initial deployment is not a completed checkout deployment.

1. In the authorized Stripe test account, create an endpoint for `https://<allocated-name>.onrender.com/api/v1/agent-checkout/webhooks/stripe`.
2. Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `payment_intent.requires_action`, and `payment_intent.canceled` using the app's pinned Stripe API version (`2026-08-26.dahlia`).
3. Save this endpoint's signing secret as Render's `STRIPE_WEBHOOK_SECRET`. The local Stripe CLI secret is a different secret.
4. Set `PERKPILOT_CHECKOUT_ENABLED=1` and redeploy. Startup checks the sandbox account and enables the checkout worker only after its schema and providers are ready.

Purchases remain controlled sandbox orders with Stripe test cards. Public hosting does not enable real retailer orders or live payments. The local presenter controls remain disabled on public hosts.

## Verification

- Check `/`, `/store`, and `/api/health` at the public HTTPS address.
- Register a hosted account; sign-in cookies must be `Secure`, `HttpOnly`, and `SameSite=Strict`.
- Add a wallet card, mark a recommended purchase bought, and confirm its estimated reward in Saved. Redeploy and confirm the same account, card, and reward remain.
- Search Explore, select a product, inspect the best-card recommendation, enroll a Stripe test card, and complete an explicitly approved sandbox order.
- Confirm Stripe delivers a signed event to the hosted endpoint and the app displays one confirmed order. An unsigned webhook must be rejected.
- Confirm a different signed-in user cannot view the order or use its saved payment method.

Local registration and database records are not automatically uploaded or copied. Hosted accounts start separately, so a presenter should register at the public URL and enroll their sandbox card there. Keep the hosted schema setting off the local file-backed checkout worker; sharing checkout job tables across independent identity stores can cancel each other's queued work.

## Free-tier limits and persistence design

Render Free services sleep after 15 minutes without incoming traffic and take about a minute to wake. Free Render PostgreSQL databases expire after 30 days; check the existing database's expiration before the demo. Free hosting also has monthly usage limits. No keep-alive traffic or paid upgrades are configured by this app.

For this hackathon workload, portal identity and wallet state are stored together in a versioned PostgreSQL JSONB snapshot. Requests reload it under a row lock and commit before publishing a response or session cookie. A local queue prevents concurrent requests from replacing in-flight memory; the database row lock prevents overlapping deployment instances from overwriting each other. Checkout workers read committed identity separately before authorization checks. This favors correctness for a small demo over high request throughput; one long portal API request can delay other portal API requests. Static pages, health probes, and signed Stripe webhooks bypass this queue.

References: [Render free instances](https://render.com/docs/free), [Render web services](https://render.com/docs/web-services), [Render environment variables](https://render.com/docs/environment-variables), [Stripe webhooks](https://docs.stripe.com/webhooks).
