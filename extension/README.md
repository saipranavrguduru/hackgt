# PerkPilot Chrome extension

This is an unpacked Manifest V3 extension for the **local synthetic demo**. It reads the two controlled storefronts only after a toolbar click or **Analyze this cart**. It does not complete payments or inspect payment fields.

## Load and connect

1. Run `npm run dev` from the repository root and leave the terminal running. The portal uses `http://localhost:3000`; the storefront uses `http://localhost:3001`.
2. Open the portal and explicitly choose **Explore Alex's sample profile** for the full synthetic comparison and no-money checkout. A new account starts empty, and self-reported cards are comparison only.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this `extension/` directory. No build or dependency installation is needed. Pin PerkPilot to the toolbar.
4. Open `http://localhost:3001/store?product=alo-jacket` and click the PerkPilot toolbar icon. The side panel opens and reads the cart.
5. Choose **Connect to PerkPilot**. In the portal tab that opens, review and approve the connection. Return to the store and choose **I approved · finish connecting**, then **Analyze this cart**.
6. The sample $104 Alo cart recommends Wells Fargo Active Cash at **$101.92** effective cost. The conditional sample Discover plan is **$82.96 after activation**. Choose **Activate offer & re-quote** to make the activated plan available; the charge today remains **$104**.
7. Choose a card and **Review demo checkout**. The portal displays the quote and requires a separate explicit confirmation for a simulated purchase. The extension cannot confirm a purchase.

To restrict approval requests to one installed extension, copy its ID from `chrome://extensions` and start the server with `PERKPILOT_EXTENSION_ID=your_extension_id npm run dev`. For this local default, pairing accepts a syntactically valid Chrome extension ID and requires explicit signed-in portal approval; exchanged tokens remain bound to that ID.

## Manual verification

- With the panel connected, increase the Alo quantity to two. The displayed charge updates to **$208** and requests a new authoritative quote. Old responses must not appear over the new cart.
- Switch tabs during a request. The comparison clears. A new tab requires **Analyze this cart** or another toolbar click.
- Open `http://localhost:3001/store?product=nike-pegasus`, click the extension, and compare the Nike cart. Both stores use exactly the portal's quote service.
- Click the extension on an unrelated site. It displays **Site not supported**, without page extraction.
- Reload a store, change quantity while a quote is pending, or let the quote expire. Re-analyze before checkout.
- Disconnect, then attempt another comparison. It requires a new explicitly approved connection. Tokens last 30 minutes; pending pairing secrets last five minutes and can be redeemed once.
- Open checkout review, return to the original storefront, and change quantity. Confirmation of the old checkout must fail and require a fresh quote. Catalog repricing and server cart revisions both invalidate a prepared checkout.

Automated coverage lives in `tests/extension.test.js` and `tests/extension-api.test.js`. Run `npm test` for the full suite. Unit/API tests do not establish that a locally loaded Chrome side panel was manually verified.

## Data and permissions

The manifest uses `activeTab`, `scripting`, `sidePanel`, and `storage`, with host access limited to localhost and 127.0.0.1 on ports 3000 and 3001. There is no automatic content script. The adapter additionally validates the exact store origin/path and the merchant/product pair.

Only product ID, merchant ID, quantity, integer amounts, currency, catalog version, anonymous cart ID and server cart revision are read from a dedicated `data-perkpilot-cart` element. The server validates all financially relevant values against its controlled catalog and cart. The storefront holds its cart update secret in its JavaScript module; the secret never enters the DOM or extension snapshot. Unrelated URL parameters are discarded. No page HTML, passwords, addresses, card numbers, or CVVs are read or sent.

The one-use pairing secret and short-lived token stay in extension-only `chrome.storage.session`. They survive service-worker suspension and clear when the browser session ends. The extension does not put secrets into merchant URLs or page elements. Disconnect revokes the token on the server when reachable and removes local credentials.

Chrome implementation references: [host match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns), [side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
