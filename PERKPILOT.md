# PerkPilot — Complete Product and Implementation Design

> **The deals that matter should find you. Finance stays in the background. Personalized savings intelligence stays in the foreground.**

**Working name:** PerkPilot; the name is a placeholder, not a branding decision.  
**Version:** 2.0 - consolidated design and implementation record  
**Prepared:** September 25, 2026  
**Audience:** The three-person hackathon team, new developers, and coding agents such as Codex  
**Challenge:** Visa - Reimagine Shopping with Generative AI  
**Artifact status:** Consolidated design based on the supplied research/UI brief and the current PerkPilot repository. Current behavior and future requirements are explicitly separated below.

## Read this first

PerkPilot is a **personalized deal-discovery system powered by a user's own spending history**. The product begins with a simple observation: finance apps know where a person spends money, while deal apps know what is on sale, but those two datasets are usually disconnected. PerkPilot connects them.

The core experience is proactive. The user should not have to search through coupons, remember every card offer, or open a shopping extension before the product becomes useful. With consent, PerkPilot learns a correctable **Spend DNA** from transactions and explicit preferences, continuously evaluates incoming merchant promotions and card-linked offers, and surfaces only the small number that are unusually relevant to that user.

The north-star interaction is:

> “You shop at this merchant or category often, this promotion is unusually relevant to your history, and one of your existing cards may make it even better.”

Everything after that is an **exploration, action, and verification layer**. If the user wants to investigate a discovered opportunity or starts with a shopping question, PerkPilot can search for products, research evidence, compare alternatives, and explain tradeoffs before asking the user to buy anything. If the user chooses to act, the same system calculates the real deal stack, recommends an existing card, carries the recommendation into a supported merchant page, prepares an explicitly approved checkout, and later verifies which benefits actually posted.

This is **not a budgeting app** and it is **not primarily a checkout assistant**. We are not asking users to create monthly budgets, categorize every transaction, manage investments, or begin with a shopping request. A price limit for an individual shopping mission is a purchase constraint, not a budgeting workflow. The Chrome extension, checkout, and rewards flow strengthen the experience, but they must not replace the original differentiation: **transaction-aware proactive deal discovery**.

The ten product capabilities are grouped by product role:

**Core discovery loop**
1. Personalized Spend DNA profile.
2. Personalized offer feed and relevance ranking.
3. Intelligent notifications for relevant merchant promotions and card offers.

**Explore layer**
4. Product search, sourced product research, comparison, and watchlists.
5. AI shopping missions for explicit purchase intent.

**Optimization and action layer**
6. Deal Stack calculation engine.
7. Best-card recommendations in the portal and a Chrome extension.
8. Streamlined, explicitly approved checkout.

**Verification and access layer**
9. Post-purchase reward tracking and a “Saved this year” dashboard.
10. An overall AI assistant for spending, offers, products, research, purchases, and reward questions.

**The most important product decision:** a user can receive meaningful value before expressing purchase intent. The system must be able to turn transaction history plus a newly available offer into a relevant, explainable opportunity without requiring the user to search first.

**The most important architectural decision:** Spend DNA, offer ranking, notifications, product research, missions, extension, and checkout must rely on shared structured data. Product facts must have evidence references, and one authoritative quote/calculation engine must own financial arithmetic. They must not implement separate versions of eligibility, relevance facts, or savings arithmetic.

**The most important scope decision:** preserve the proactive discovery loop as the product center. The repository now has a controlled Explore, action, and verification path. Use clearly labeled synthetic data where external access is unavailable. Do not attempt universal merchant coverage or claim a production banking platform.

**The most important trust decision:** distinguish what is observed from transaction history, what is inferred, why an offer was selected, what is estimated, what requires activation, what is charged now, and what benefit has actually been received.

**The most important UI decision:** the application should feel much closer to the Apple Card and Apple Wallet ecosystem than to a traditional banking dashboard, rewards portal, or coupon marketplace. Use large information hierarchy, generous whitespace, rounded surfaces, restrained color, focused interactions, strong typography, subtle material effects, and carefully staged detail. The UI should feel calm even when the underlying product is doing complex financial reasoning.

## Current implementation at a glance

The repository now implements a **local synthetic demo**, not a live financial-data product. Two explicit sample profiles demonstrate the transaction-aware discovery loop. A new user can register and sign in, but starts with no connected financial data; they can choose an existing card product for a **self-reported**, comparison-only reward estimate. Published base reward rules are sourced from issuer pages, while sample card ownership, last-four digits, card-linked offers, products, prices, transactions, payments, and posted events remain synthetic. The live mode is deliberately unavailable until production identity, durable storage, and verified providers are connected. See sections 18-20 for exact implementation, gaps, and run instructions.

This version consolidates `PROJECT_OVERVIEW_REFOCUSED.md`, `PROJECT_OVERVIEW_APPLE_UI.md`, and `PROJECT_OVERVIEW_APPLE_UI_RESEARCH.md`. The research/UI brief is the detailed base; the earlier two documents established the product thesis and Apple-inspired visual direction.

## Contents

- [1. Product intent, assumptions, and boundaries](#1-product-intent-assumptions-and-boundaries)
- [2. The end-to-end experience](#2-the-end-to-end-experience)
- [3. How the product answers the Visa challenge](#3-how-the-product-answers-the-visa-challenge)
- [4. UI design system, product surfaces, and navigation](#4-ui-design-system-product-surfaces-and-navigation)
- [5. Feature specifications](#5-feature-specifications)
- [6. Financial calculations and the savings ledger](#6-financial-calculations-and-the-savings-ledger)
- [7. System architecture](#7-system-architecture)
- [8. Core data model and shared contracts](#8-core-data-model-and-shared-contracts)
- [9. External integrations and demo boundaries](#9-external-integrations-and-demo-boundaries)
- [10. Privacy, security, and failure behavior](#10-privacy-security-and-failure-behavior)
- [11. Three-person ownership and parallel development](#11-three-person-ownership-and-parallel-development)
- [12. Build sequence and Codex handoff](#12-build-sequence-and-codex-handoff)
- [13. Acceptance tests and definition of done](#13-acceptance-tests-and-definition-of-done)
- [14. Demo dataset and presentation flow](#14-demo-dataset-and-presentation-flow)
- [15. Scope cuts, risks, and unresolved external dependencies](#15-scope-cuts-risks-and-unresolved-external-dependencies)
- [16. Sources and verification notes](#16-sources-and-verification-notes)
- [17. New-developer onboarding checklist](#17-new-developer-onboarding-checklist)
- [18. Current implementation and behavior](#18-current-implementation-and-behavior)
- [19. Remaining work for a live-data demo](#19-remaining-work-for-a-live-data-demo)
- [20. Run, verify, and troubleshoot](#20-run-verify-and-troubleshoot)
- [21. Implementation evidence and issuer sources](#21-implementation-evidence-and-issuer-sources)

---

## 1. Product intent, assumptions, and boundaries

### 1.1 The problem

A shopper's transaction history, favorite merchants and categories, retailer promotions, card benefits, and purchase timing exist in separate systems. Generic deal feeds solve this by showing more offers. PerkPilot solves it by deciding **which few offers deserve this particular person's attention**.

The primary product question is:

> “Given what this person already spends money on and the deals available now, which opportunities are genuinely relevant enough to surface?”

Only after the user chooses to act does the product answer a second question:

> “For this opportunity or shopping intent, what will the user actually pay, which existing card is best, and which benefits are expected later?”

This ordering is intentional. PerkPilot is discovery-first, research-aware, optimization-second, and verification-last.

The product serves four moments:

1. **Discover:** notice a worthwhile opportunity before the user begins actively shopping.
2. **Explore:** search for products, investigate evidence, compare tradeoffs, or research an opportunity before buying.
3. **Act:** optimize the chosen purchase across merchant price, promotions, existing cards, and checkout.
4. **Verify:** track the purchase and confirm which promised benefits actually posted.

The finance portal is supporting context and evidence. It is not the principal product experience.

### 1.2 Confirmed requirements versus proposed defaults

**Confirmed by the team:** the product capabilities above, a simple finance app in the background, a Chrome extension for card recommendations, alignment with Visa's challenge, and a three-person development split that supports parallel agent-assisted implementation.

**Product-priority clarification:** the capabilities are not equally important to the product thesis. Spend DNA, personalized offer ranking, and intelligent notifications form the differentiated core. Missions, Deal Stack, card recommendations, extension, checkout, rewards, and assistant functionality should deepen that core rather than redefine the product around active checkout.

**Implemented defaults:** a responsive dependency-free JavaScript/Node web app; USD only; two explicit synthetic sample profiles; local registration and sign-in; four named real card *products* with sourced base rewards; a small synthetic offer/product catalog; two controlled merchant storefronts; and simulated finance, checkout, and settlement. These are implementation choices, not requirements imposed by Visa.

**Future architecture option:** the TypeScript/React/PostgreSQL layout in section 7 remains a proposed production migration. It is not the repository's current stack. No sponsor credentials, finance provider, issuer connection, merchant feed, live payment, or reward webhook is configured. Adapter boundaries and data contracts should survive a stack change.

### 1.3 Product principles

- **Deals find the user:** the product must create value from transaction history and new offer data without requiring a search query first.
- **Relevant, not noisy:** a smaller set of high-confidence opportunities is better than a large generic coupon feed.
- **Explain the match:** every personalized opportunity should say why it appeared, using evidence such as familiar merchant, category affinity, purchase recency/frequency, explicit preference, active mission, or card eligibility.
- **History informs, it does not overclaim:** merchant-level transactions can support merchant/category affinity and cadence, but not item-level assumptions.
- **Explicit intent strengthens implicit intent:** an active mission may raise relevance, but the product still works when no mission exists.
- **Research before persuasion:** a relevant discount is not proof that the underlying product is good. Users must be able to research a surfaced deal before taking action.
- **Evidence over generated confidence:** product facts, current prices, compatibility claims, review findings, and comparisons must remain attributable to retrieved or fixture evidence.
- **Personalization changes the lens, not the facts:** Spend DNA and user requirements influence which products and tradeoffs are emphasized; they must not alter objective specifications or source content.
- **Assist, do not pressure:** a discount does not make an unnecessary purchase a saving. Never frame spending as money earned.
- **One financial truth:** deterministic code calculates; AI interprets requests and explains structured results.
- **Approval before payment:** recommendations, alerts, and saved missions never authorize a charge.
- **Show provenance:** every monetary claim and personalization reason should link to its source, conditions, or recorded evidence.
- **Graceful uncertainty:** “We cannot verify this benefit” or “We do not have enough evidence to personalize this” are valid outcomes.

### 1.4 Explicit non-goals

No monthly budgeting, credit-score tools, investment advice, lending, new-card recommendations, credit applications, balance transfers, universal coupon scraping, automatic checkout on arbitrary websites, or unapproved autonomous purchases. Loyalty-point valuations, split-tender payments, native mobile clients, price-adjustment claims, and delivery/return automation are later extensions, not required MVP features.

The MVP is also **not** trying to become a universal shopping search engine. Its first job is to rank a limited set of known offers against a user's known spending profile well enough that the user can understand why a deal was selected and why most other deals were ignored.

## 2. The end-to-end experience

### 2.1 Learn the user's Spend DNA

The user connects demo accounts and cards, consents to transaction-based personalization, and reviews a generated Spend DNA profile. The profile summarizes merchant affinity, category affinity, purchase recency, purchase frequency, observed transaction-size ranges, and explicit likes/dislikes without pretending that a card transaction is an itemized receipt.

The user can correct the profile, exclude a gift or one-off transaction, mute a merchant/category, or add an explicit preference. These corrections influence future deal ranking.

### 2.2 Proactive deal discovery - the hero experience

A new merchant promotion or user-specific card offer arrives. The user has not searched for anything.

The system:

1. validates that the offer is active and potentially usable;
2. compares it against the user's Spend DNA and preferences;
3. evaluates familiar-merchant, category, recency/frequency, similarity, discount strength, and card-eligibility signals;
4. suppresses low-relevance or noisy opportunities;
5. creates an explainable opportunity only if it clears the notification/feed threshold.

An illustrative notification is:

> “Worth a look: you shop in premium athletic apparel frequently, and this demo Alo promotion is relevant to that pattern. One of your cards also has an eligible offer. See why this matched you.”

Another merchant may have a larger headline discount but receive no alert because there is little evidence that the user cares about that merchant or category. That selective suppression is part of the product, not a failure to show inventory.

Brand names in this document illustrate the team's scenario. **All example products, promotions, card benefits, and prices are synthetic, not claims about current Nike, Alo, Lululemon, Chase, or Visa offers.**

### 2.3 Explore and research before buying

The user may enter the Explore layer from either direction:

- **Research this deal:** investigate a product surfaced by proactive discovery before deciding whether the discount is worth acting on.
- **Ask PerkPilot:** start with an explicit product need such as “best noise-cancelling headphones for long flights under $350.”

The system classifies the request as an exact product lookup, category search, constrained search, comparison, or open-ended research question. It then creates a structured research session.

The Explore layer separates three jobs:

1. **Search:** identify plausible products and current merchant listings.
2. **Research:** collect structured facts, evidence, recurring review findings, tradeoffs, compatibility, and source freshness.
3. **Personalize:** explain which candidates best match the user's stated requirements and relevant Spend DNA without rewriting objective facts.

A research session may end with “keep watching” rather than a purchase. If the user chooses to act, a selected product/listing flows into the same Deal Stack, card recommendation, extension, checkout, and verification systems used elsewhere.

### 2.4 Optional intent-driven shopping

If the user is already looking for something, explicit intent can sharpen the same system. The user says, “Find me a black running jacket under $120.” The AI extracts a mission, retrieves products from the supported catalog, and asks the shared Deal Stack engine to price candidates using that user's cards.

A mission is an additional relevance signal, not a prerequisite for personalization. The system should distinguish:

- **Discovered for you:** opportunity originated from Spend DNA plus new deal data.
- **Watching for you:** opportunity matches an active mission or explicit request.

### 2.5 Act on an opportunity

From a personalized opportunity or mission result, the user can inspect terms, see the charge today versus later benefits, compare existing cards, and open the supported merchant flow.

If the user visits a controlled merchant page, the Chrome extension reads a minimal cart snapshot with permission and requests the same authoritative quote. It does not invent a new recommendation model. It carries PerkPilot's existing intelligence into the shopping context.

### 2.6 Checkout and verification

For the controlled demo merchant, the user can open a prepared checkout. The backend revalidates the cart, chosen card, offer activation, and quote version. A clear approval screen precedes a simulated or sandbox payment.

After settlement, the purchase appears in the portal. Reward records progress separately from the payment. The annual savings dashboard includes observed discounts and posted cash benefits, not every projected benefit from every viewed offer.

**Feedback loop:** new transactions, explicit corrections, saves, dismissals, and completed purchases can improve future relevance. Browsing, rejected offers, and one-off gifts must not automatically become enduring preferences.

## 3. How the product answers the Visa challenge

The product's Visa alignment begins with **AI-powered discovery and personalization**, then extends through decision-making, payment, and post-purchase verification. This sequence should be reflected in both the demo and presentation.

| Visa challenge element | Our implementation | Demonstrable evidence |
|---|---|---|
| Generative AI-powered commerce | Explainable Spend DNA, grounded offer explanations, natural-language missions, grounded assistant | AI explains a structured user profile and interprets a novel shopping request without performing financial arithmetic |
| Discovery | Spend-history-aware merchant promotion and card-offer matching | A newly published offer is evaluated against the user's history before the user searches for anything |
| Personalization | Editable Spend DNA, explicit preferences, transaction exclusions, relevance reasons | Two fixture users receive different ranked deals; correcting an inferred interest changes future results |
| Product research | Search, evidence-backed product briefs, comparisons, and personalized tradeoff explanations | A user asks a novel product question or researches a surfaced deal and receives sourced findings before any checkout recommendation |
| Decision-making | Deal Stack and card comparison after a relevant opportunity is selected | The same purchase is compared across three existing cards with visible conditions |
| Frictionless checkout | Reuse opportunity/mission/cart context and the selected card in a prepared checkout | The user does not re-enter the shopping request or repeat the comparison |
| Secure and trusted payments | Approval-bound checkout, opaque provider references, quote revalidation, audit trail | No charge before approval; changed amount requires renewed approval |
| Loyalty and rewards | Card-offer qualification and posted benefit tracking | Pending and received credits have different statuses |
| Post-purchase | Purchase history, reward status, annual savings ledger | Duplicate events do not inflate savings; a return adjusts totals |
| Merchant value | Higher-relevance discovery instead of generic promotion exposure | Show that the same offer ranks differently for different spending profiles; do not claim unmeasured conversion lift |

### Visa integration direction

Visa Intelligent Commerce's public overview describes agent-specific payment tokens and authenticated payment instructions, and lists sandbox use while noting that the product is still in development/deployment. Our payment adapter is designed around explicit authorization, but actual access and enabled flows must be verified with the sponsor. [S1]

Visa Offers Platform describes consent-based transaction qualification and statement-credit capabilities. Its detailed documentation is restricted. Treat it as a possible integration for an enrolled program, **not** an assumed feed of every issuer's private offers. [S2][S3]

A Visa-branded mock card is not a Visa API integration. The presentation must clearly distinguish a simulated flow, a sandbox request that actually ran, and future production architecture.

## 4. UI design system, product surfaces, and navigation

### 4.1 Visual direction

The visual target is **Apple Card / Apple Wallet-inspired**, adapted into PerkPilot's own identity.

The intended feeling is:

- financial information that feels understandable immediately;
- one primary idea per screen rather than a dense dashboard;
- large, confident values with supporting detail revealed progressively;
- content-first layouts with generous negative space;
- white and soft-neutral surfaces with selective color;
- rounded cards and sheets rather than hard-edged dashboard panels;
- subtle depth, translucency, and blur for navigation and temporary layers;
- smooth, restrained motion that helps explain hierarchy;
- very little visual noise, chrome, table density, or persistent borders.

Apple Card is a reference for **clarity, hierarchy, simplicity, color-as-information, and transaction presentation**, not a template to reproduce pixel for pixel. PerkPilot must not use Apple logos, Apple Card artwork, Wallet branding, copied proprietary illustrations, exact Apple screen layouts, or misleading Apple-style payment claims. [S9][S10][S11][S12][S13]

The product should feel like:

> Apple Card's calm financial clarity + Wallet's card-centric organization + PerkPilot's personalized deal intelligence.

It should **not** feel like:

> a coupon site, cashback portal, bank admin dashboard, spreadsheet, crypto app, or enterprise analytics console.

### 4.2 Design principles

#### A. One focal object per screen

Every major screen should have one dominant object or message.

Examples:

- Home: the most relevant opportunity today.
- Spend DNA: the user's visual spending identity.
- Deal detail: the effective purchase economics.
- Card choice: the recommended existing card.
- Savings: the confirmed amount saved this year.

Secondary information can appear below or behind a disclosure interaction. Avoid grids of equally weighted KPI cards.

#### B. Progressive disclosure

Show the simple answer first, then let the user inspect evidence and terms.

For example:

```text
30% off at Alo
Relevant to you

Potential card offer available
```

The first view should not immediately show:

```text
merchant affinity = 0.842
category similarity = 0.711
offer rule version = 3
eligibility source = fixture_17
```

Those facts exist and remain auditable, but they belong behind “Why this matched,” “See calculation,” or a detail sheet.

#### C. Color communicates meaning, not decoration

Use color sparingly in controls and navigation. Put most personality in the content layer.

Recommended uses:

- dynamic Spend DNA visualization;
- merchant/category accent;
- savings and confirmed reward status;
- subtle opportunity hero backgrounds;
- card artwork;
- charts and category summaries.

Avoid full-page saturated backgrounds, neon gradients, or every card having a different loud color.

#### D. Financial truth must remain visually obvious

The Apple-like simplicity must never hide financial distinctions.

Always visually separate:

- **Pay today**
- **Expected later**
- **Confirmed received**
- **Estimated effective cost**

Do not make an expected statement credit look like an immediate checkout discount.

#### E. The product feels personal without becoming invasive

The UI may say:

> “You shop in this category often.”

It should avoid creepy or overly specific phrasing such as:

> “You usually buy clothes on Friday night every 63 days.”

Detailed evidence can be available on demand, but the default presentation should stay human and respectful.

#### F. Content is more important than branding

PerkPilot should have its own logo, icon, and accent language, but branding should remain understated. Avoid filling valuable screen space with a large logo or decorative brand elements.

### 4.3 Design tokens

These are design defaults for the hackathon. The current app expresses many of them in `public/style.css`; a shared `packages/ui` package remains a possible future refactor.

#### Canvas and surfaces

Use a soft neutral canvas rather than pure white everywhere.

Suggested light-mode hierarchy:

```text
App background:        near-white / very light warm-neutral gray
Primary surface:       white
Secondary surface:     subtle neutral fill
Floating material:     translucent white with backdrop blur
Primary text:          near-black charcoal
Secondary text:        medium neutral gray
Tertiary text:         lighter neutral gray
Hairline separator:    low-contrast neutral
Savings positive:      restrained green
Warning/pending:       restrained amber
Error:                 restrained red
```

Do not make a single global PerkPilot blue dominate the interface. If an accent color is selected, reserve it for selected states, primary CTAs, small status marks, and brand identity.

Dark mode is optional for the hackathon. If implemented, preserve hierarchy rather than simply inverting colors.

#### Radius

Use visibly rounded geometry.

```text
Small controls:        12-14px
Input fields:          16-18px
Standard cards:        20-24px
Hero cards:            28-32px
Sheets / large panels: 28-32px
Circular controls:     fully rounded
```

Avoid mixing many unrelated radii.

#### Spacing

Use a consistent 4px base grid with generous outer margins.

```text
4   micro spacing
8   icon/text spacing
12  tight internal spacing
16  standard internal spacing
20  compact card padding
24  standard card padding
32  section spacing
40  major section spacing
48+ hero separation
```

Desktop content should generally sit inside a centered content column rather than stretching full width.

#### Typography

Use a system-first font stack on web:

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Do not bundle or redistribute Apple font files.

Typography hierarchy should resemble a native financial app rather than a marketing site:

```text
Hero amount / key number:  40-56px, medium/semibold
Page title:                28-36px, semibold
Section title:             20-24px, semibold
Card title:                17-20px, semibold
Body:                      15-17px, regular
Secondary / metadata:      13-15px, regular
Micro labels:              11-13px, medium
```

Prefer sentence case. Avoid all-caps section labels except tiny optional metadata.

Numbers should use tabular figures where practical so monetary values do not jump when updated.

### 4.4 Materials, elevation, and borders

The visual system should use **surface separation more than visible borders**.

Primary financial cards:

- white or lightly tinted solid surface;
- minimal or no border;
- subtle shadow only where needed;
- rounded 24px or greater;
- no heavy drop shadow.

Floating navigation, modal sheets, side panels, and compact transient controls may use a restrained Apple-like material treatment:

```text
background: translucent light surface
backdrop blur: moderate
border: 1px low-opacity white/neutral hairline
shadow: soft, broad, low opacity
```

Do not apply blur to every card. Information cards should usually remain solid and readable. Translucency belongs primarily to chrome and temporary layers.

### 4.5 Navigation model

The app should not look like an enterprise sidebar dashboard.

#### Mobile / narrow layout

Use a compact bottom navigation with a floating-material appearance:

```text
For You
Spend
Wallet
Saved
```

The Assistant is accessed through a floating contextual button or expandable input rather than requiring a permanent fifth tab.

Missions live inside `For You` and Assistant flows instead of becoming a top-level destination unless usability testing proves otherwise.

#### Desktop / hackathon web layout

Use a narrow left rail or compact top-level floating navigation, not a wide admin sidebar.

Preferred desktop structure:

```text
+------------------------------------------------------+
| PerkPilot                         profile / settings |
|                                                      |
|  For You   Spend   Wallet   Saved                    |
|------------------------------------------------------|
|                                                      |
|            centered content column                   |
|                                                      |
+------------------------------------------------------+
```

The maximum main content width should generally be around 760-900px for reading and financial surfaces. Wider layouts may use a supporting side inspector, but the core experience stays centered.

### 4.6 Home / For You - the most important screen

Home is the product's hero experience. It should feel closer to opening Apple Card in Wallet than opening a coupon marketplace.

The screen should answer:

> “What is worth my attention right now?”

Recommended order:

#### 1. Quiet top summary and universal Explore entry

Small greeting or date, then one compact summary such as:

```text
Saved this year
$127.40
```

Do not open with bank balances or net worth.

Under the summary, provide one understated universal input:

```text
Ask PerkPilot...
```

This input can begin product search, product research, comparison, or a shopping mission. It should look like a native search/composer, not a large chatbot panel.

#### 2. Primary opportunity hero

Show one dominant personalized opportunity using a large rounded card.

Example structure:

```text
[merchant mark]                        For You

Alo
30% off select outerwear

This matches your athletic apparel spending.

Use Discover it Cash Back
$20 card offer may also apply

[View deal]
```

The card should use a subtle category/merchant tint or gradient, large typography, and substantial empty space.

Do not use coupon-style dashed borders, clipping scissors, flashing percentages, countdown urgency, or “ACT NOW” language.

#### 3. A very short opportunity stack

Below the hero, show perhaps 2-4 additional opportunities.

The default feed should communicate scarcity of attention:

```text
3 deals worth your attention
```

not:

```text
247 deals available
```

#### 4. Optional “Watching” section

Active mission matches appear separately under:

```text
Watching
```

This visually distinguishes explicit purchase intent from proactive “For You” discovery.

#### 5. Recent confirmed value

A quiet lower section may show recent confirmed savings/rewards, not a wall of finance metrics.

### 4.7 Spend DNA screen

Spend DNA should become one of the most visually distinctive parts of the app.

At the top, show a large personalized visual object, inspired by Apple Card's use of color to make spending patterns understandable.

Do **not** make this object look like a credit card. It is a profile visualization.

Recommended concept:

```text
+--------------------------------------+
|                                      |
|             Spend DNA                |
|                                      |
|        soft multi-color field        |
|   generated from category weights    |
|                                      |
|  Shopping  34%   Dining  27%         |
|  Travel    18%   Other   21%         |
+--------------------------------------+
```

The gradient/color field should be derived from category proportions so the profile feels personally generated.

Below it, use Apple Card-like summary sections:

```text
Frequent merchants
Nike           6 purchases
Chipotle      18 purchases
Publix        31 purchases

Patterns
Athletic apparel        High affinity
Dining                  High affinity
Travel                  Medium affinity
```

Include week/month/year segmented controls only where they genuinely change the analysis.

Every inferred profile row should support tap/click to reveal evidence and controls:

```text
Why?
Not relevant
This was a gift
Mute merchant
```

Avoid radar charts, dense dashboards, 3D visualizations, or dozens of statistical metrics.

### 4.8 Personalized opportunity cards

Opportunity cards are the signature reusable component.

Each card has four layers:

1. **Identity:** merchant logo/mark and merchant name.
2. **Offer:** simple benefit headline.
3. **Personal relevance:** one human-readable reason.
4. **Action economics:** optional card-stack hint or estimated value.

Example:

```text
Lululemon

25% off selected outerwear

You shop in premium athletic apparel often.

Discover it Cash Back may add $20 back

Expires Sunday                         >
```

Rules:

- no more than two accent colors per card;
- use merchant imagery only when licensed/available;
- do not place long legal text in the feed card;
- one primary CTA;
- use small secondary metadata;
- avoid badge overload;
- relevance explanation is more important than generic labels like “Hot deal.”

### 4.9 Deal detail screen

Opening an opportunity transitions into a clean detail view or sheet.

Recommended hierarchy:

```text
Merchant
30% off select outerwear

Why this is for you
You frequently shop in athletic apparel.
4 relevant purchases in the last 6 months.

Best way to pay
Discover it Cash Back

Pay today                 $104.00
Expected card credit      -$20.00
Estimated rewards          -$1.04
Estimated effective cost   $82.96

[Research this product]   [Use this deal]
```

The “Why this is for you” section should be prominent, because explainable relevance is the product differentiation.

Financial values should be aligned and easy to scan. Put terms, eligibility evidence, and source freshness under expandable sections.

### 4.10 Explore and product search UI

Product search should feel like a focused native workflow, not a marketplace grid.

Entry points:

- the global `Ask PerkPilot...` composer;
- `Research this product` from an opportunity;
- `Research` from the Chrome extension;
- a saved/watchlist item;
- an assistant request.

The first step asks the user what they need in natural language:

```text
What are you looking for?

[ Best headphones for long flights under $350 ]
```

The system shows its interpreted requirements in an editable compact sheet:

```text
Budget              ≤ $350
Priority            Noise cancellation
Priority            Comfort
Use case            Long flights
Preference          iPhone compatible
```

For broad searches, display one primary candidate first, then a short list of alternatives. Avoid a 4-column commerce grid unless the user explicitly switches to browse mode.

### 4.11 Research brief UI

Each researched product receives a structured Research Brief.

Recommended hierarchy:

```text
Sony WH-1000XM6

Strong match for your request

Why it fits
Excellent ANC
Strong battery
Comfortable for travel
Within budget

Worth knowing
Limited improvement in ...
Common owner concern: ...

Current price
$349 at Merchant A

Estimated effective cost
$271 with current eligible stack

[Compare]   [Watch]   [See purchase options]
```

Below the summary, use progressive disclosure:

- **Research findings**
- **Specifications**
- **Professional testing**
- **Owner experiences**
- **Compatibility**
- **Price & purchase options**
- **Sources**

Every nontrivial finding should expose evidence. Do not make the user read a citation wall by default, but each claim must be traceable.

Source type should be visually distinguishable with restrained labels such as:

```text
Manufacturer
Retailer
Independent review
Community
PerkPilot calculation
```

Do not merge manufacturer claims and independent testing into one unattributed statement.

### 4.12 Product comparison UI

Comparison begins with conclusions and tradeoffs, then reveals the full table.

Example:

```text
Sony XM6                 Bose QC Ultra

Lower effective cost     Stronger comfort signal
Longer battery           Excellent ANC
More portable            Higher current price

$271 effective           $324 effective

[See full comparison]
```

The detailed comparison may include:

- price and effective cost;
- dimensions/weight;
- battery;
- compatibility;
- feature differences;
- independent test findings;
- recurring owner concerns;
- warranty/return information where sourced;
- source freshness.

Do not collapse subjective dimensions into a fake universal numeric score. If PerkPilot identifies a “best match,” it must explain that the result is relative to the user's stated requirements, not an objective global ranking.

### 4.13 Card recommendation UI

Existing cards should be represented visually as a horizontally swipeable or selectable card stack.

The current cards use original gradient treatments and real product names, with no copied issuer or Apple card artwork. Sample holdings must always be marked synthetic; user-added products must be marked self-reported.

Interaction:

```text
<  Discover it Cash Back  >     best after activation
   Wells Fargo Active Cash        best available now
   Capital One Quicksilver
```

When selection changes, the financial summary underneath updates smoothly.

The recommendation should not simply say “BEST CARD” in a loud badge. Prefer calmer language:

```text
Best available now
```

or:

```text
Lower effective cost after activation
```

### 4.14 Wallet screen

Wallet is supporting infrastructure.

The current sample profile shows a visual stack of **synthetic card holdings using real named product rules**. A registered profile starts empty and can add self-reported card products; this does not establish issuer ownership or payment eligibility. A future provider-connected version may show verified linked cards with masked details.

Below that:

- account connection status;
- reward-rule summary;
- recent card activity;
- source freshness.

Do not reproduce a conventional online banking account table unless necessary for debugging.

Net worth can appear as a secondary summary, but should not dominate the product.

### 4.15 Saved screen

The Saved screen should borrow the simplicity of Apple Card's summary views.

Hero:

```text
Saved this year
$127.40
```

Then a simple segmented time selector:

```text
Month   Year
```

Below:

```text
Merchant discounts        $74.00
Card offers               $38.00
Card rewards              $15.40
```

Use one clean chart at most, preferably a simple bar or trend visualization. Avoid multiple simultaneous charts.

Pending benefits appear in a clearly separate section:

```text
Expected
$21.04 pending
```

Never visually blend pending amounts into the confirmed hero total.

### 4.16 Transactions and purchase details

Transactions should resemble a native activity list:

```text
Nike                         -$104.00
Shopping                         Today

Publix                        -$82.41
Groceries                    Yesterday
```

Use recognizable merchant names, category labels, and subtle category icon/color cues.

Clicking a relevant purchase opens a detail sheet with:

- merchant;
- date;
- amount;
- card;
- category;
- matched PerkPilot opportunity, if any;
- merchant discount evidence;
- card-offer status;
- reward status.

Do not expose raw provider strings by default.

### 4.17 Notifications

Notifications should read like useful system intelligence, not marketing copy.

Good:

> Alo has a 30% promotion. It matches your athletic-apparel profile, and one of your cards may add $20 back.

Bad:

> 🔥 INSANE DEAL!!! SAVE BIG NOW!!!

In the in-app inbox, each notification should use a simple list row with merchant mark, one-line headline, short reason, timestamp, and unread state.

### 4.18 AI assistant UI

The assistant should feel integrated into the product rather than a separate chatbot application.

Use a compact floating input or bottom composer:

```text
Ask PerkPilot...
```

When the user asks a question, responses should prefer structured native cards over long chat bubbles.

Examples:

- spending summary card;
- offer card;
- product research brief;
- product comparison;
- card comparison;
- reward timeline;
- “why this matched” evidence card.

Text explanation surrounds the structured UI, not the other way around.

### 4.19 Chrome extension UI

The side panel should look like a compact continuation of the main app.

Recommended structure:

```text
PerkPilot

Alo
Cart total                     $104.00

Best available now
Wells Fargo Active Cash
Effective cost                 $101.92

After activation
Discover it Cash Back
Effective cost                  $82.96

[Research product]
[Open PerkPilot]
```

Use one primary action and one clear card selection area.

Do not crowd the side panel with transaction history, balances, profile charts, or the entire offer feed.

### 4.20 Checkout UI

Checkout must retain the calm visual language while making authorization extremely explicit.

Use a centered review card or sheet:

```text
You're paying

$104.00

Alo
Discover it Cash Back · 4821

Expected later
$20.00 statement credit
$1.04 estimated reward

Estimated effective cost
$82.96

[Confirm demo purchase]
```

The amount charged today must remain the largest payment number.

Do not style the effective cost as though that is the amount being charged.

### 4.21 Motion and interaction

Motion should make state changes understandable.

Recommended behaviors:

- cards gently scale or elevate on hover/tap;
- selection changes use short spring transitions;
- number changes animate subtly without slot-machine effects;
- a detail card can expand into a sheet using shared geometry where practical;
- newly confirmed savings may count smoothly once, then remain static;
- navigation material can subtly adapt to content underneath.

Typical duration:

```text
Micro interaction:   120-180ms
Standard transition: 180-260ms
Large sheet/card:    260-360ms
```

Respect `prefers-reduced-motion`.

Avoid:

- parallax for decoration;
- constant floating animations;
- confetti for normal savings;
- aggressive haptics;
- auto-advancing carousels.

### 4.22 Empty, loading, and failure states

Do not use blank dashboard skeletons for long periods.

Prefer meaningful placeholders:

```text
Learning your Spend DNA
We are organizing your recent merchant activity.
```

No relevant offers:

```text
Nothing worth interrupting you for right now.
We'll surface something when it matches your profile.
```

This state reinforces the core product philosophy.

Insufficient history:

```text
Help PerkPilot learn what matters to you.
Choose a few categories or merchants you care about.
```

Unknown financial data:

```text
We can't verify this benefit yet.
```

Do not silently replace unknown with `$0`.

### 4.23 Accessibility and responsiveness

The UI must preserve the Apple-inspired visual restraint without depending on color alone.

Requirements:

- WCAG AA contrast for body text and controls;
- keyboard-operable web interactions;
- visible focus treatment;
- semantic headings and buttons;
- reduced-motion support;
- labels in addition to category colors;
- large enough tap targets;
- scalable text without clipping;
- tables only where a list/card representation is not sufficient.

On smaller screens, content becomes a single-column native-app-like flow. On desktop, increase whitespace rather than simply adding more columns.

### 4.24 Product surfaces and ownership

| Surface | Main contents | Primary owner |
|---|---|---|
| Home / For You | One hero opportunity, universal Explore entry, short personalized feed, Watching section, compact savings summary | A integrates B/C components |
| Spend DNA | Personalized visual identity, merchant/category affinities, evidence, corrections | A |
| Offers / opportunity detail | Ranked opportunities, relevance reasons, terms, Research-this-product action, deal economics | B |
| Explore / Research | Product search, research briefs, comparisons, purchase options, source evidence, watch actions | B |
| Missions | Optional conversational intent, editable constraints, matching products | B |
| Wallet | Connected accounts/cards, visual card stack, freshness, reward rules | A |
| Saved | Confirmed savings hero, category breakdown, pending benefits, purchases | C with A shell |
| Notifications | Quiet inbox of relevant deal and reward-status events | B |
| Assistant | Contextual composer and structured answer cards | A |
| Chrome side panel | Compact merchant/cart/card comparison and handoff | C |
| Demo storefronts | Controlled merchant product/cart pages | C |

The first meaningful Home state must answer **“What is worth my attention?”**, not merely “What is my balance?”

Home composes personalized opportunity cards from B and `SavingsSummary` from C through public component exports or the shared API. A must not recreate their ranking or calculations.

### 4.25 UI implementation requirements

Create shared UI primitives early so all three developers produce one visual system.

Minimum shared components:

```text
AppShell
FloatingNav
PageHeader
HeroMetric
OpportunityCard
OpportunityDetail
ExploreComposer
ResearchBrief
ResearchSourceList
ProductCandidateCard
ProductComparison
WatchButton
SpendDNAVisual
SectionHeader
FinancialBreakdown
CardStack
CardPicker
TransactionRow
RewardTimeline
StatusPill
MaterialSheet
EmptyState
AssistantComposer
PrimaryButton
SecondaryButton
SegmentedControl
```

Keep domain logic outside these components. They receive validated data and presentation states.

All feature work must use the shared spacing, radius, typography, and material tokens rather than creating local visual conventions.

## 5. Feature specifications

### 5.1 Personalized Spend DNA profile

**Purpose:** turn consented transaction history into a transparent, correctable model of **where and how the user tends to spend**, so the system can judge whether a new deal is actually relevant.

**Build:** a profile service and editable profile screen. Aggregate posted purchases by normalized merchant/category, recency, frequency, and transaction amount. Derive merchant/category affinity and simple purchase-cadence evidence from structured data. Give only a small approved aggregate to the language model to generate a human-readable summary with evidence references.

**Inputs:** consented transactions, merchant metadata, user-stated preferences, excluded transactions/categories, and previous corrections.

**Outputs:** frequent merchants; category affinities; merchant/category recency; observed purchase frequency/cadence; observed transaction-size ranges; explicit style/product preferences; suggested similar merchants; evidence counts; and a generated-at timestamp. Every inferred entry needs `origin`, `evidenceRefs`, and an uncertainty label. “User stated” overrides “inferred.”

**Important limitation:** a card transaction is not a receipt. A $120 merchant charge does not prove which product, size, color, or number of items was purchased. Plaid's transaction schema documents merchant/category information, which should not be treated as item-level product evidence. [S8] Say “Typical transaction at apparel merchants” rather than “Typical jacket price” without itemized evidence. Merchant category is also not automatically the payment network's merchant category code.

**Behavior:** generate on first consented import; regenerate after meaningful new data or a manual refresh, not on every page load. Allow “This was a gift,” merchant/category mute, manual preference entry, and removal of an inference. Store corrections so the next regeneration does not resurrect them. With insufficient history, ask for explicit interests and show a cold-start profile rather than invented habits.

Do not treat cadence as certainty. “You often shop here every 2 to 3 months” is acceptable when supported. “You are due to buy now” is not. The cadence signal may increase relevance, but it must remain explainable and probabilistic.

**Acceptance:** an excluded transaction disappears from evidence and derived aggregates; a preference correction persists; merchant/category recency and frequency match the fixture data; the profile does not invent item-level details; no consent means no history-based personalization.

**Owner:** A. **Consumed by:** B's offer ranking, notification selection, and optional mission ranking.

### 5.2 Personalized offer feed

**Purpose:** transform a broad deal catalog into a **small ranked set of opportunities that matter to this user**. This is one of the three core differentiated features.

**Build:** a normalized offer catalog, user-specific offer eligibility/enrollment state, relevance-ranking service, and feed screen. Support retailer percentage promotions and card-linked fixed/percentage cash offers in the model; the demo must exercise at least a retailer percentage sale and a fixed card credit.

**Inputs:** Spend DNA, explicit preferences, merchant/category recency and frequency, active missions when present, offer records, card ownership, user-offer assignments, activation state, terms, and mute/dismiss feedback.

**Outputs:** ranked opportunity cards containing merchant, benefit, relevance reason, expiry, source freshness, conditions, and CTA. Distinguish “Available to your card,” “Activation required,” and “Eligibility not verified.”

**Ranking semantics:** the feed must work even when there is no active mission. Use deterministic or inspectable relevance features such as:

- familiar merchant strength;
- category affinity;
- recency and frequency of spending at the merchant/category;
- explicit likes/dislikes;
- explainable similar-merchant/category relationship;
- relative strength and freshness of the promotion;
- known card-linked eligibility or stacking potential;
- active mission match, when one exists.

An active mission can strongly boost an offer, but it is not the default source of relevance. A generic 40% promotion at an unrelated merchant should be allowed to rank below a 20% promotion from a merchant or category the user repeatedly uses.

Use structured catalog attributes first. AI may explain similarity or summarize why an offer matched, but it cannot invent an eligible offer or silently override deterministic exclusions. Filter expired offers, muted categories, inaccessible card offers, unsupported currencies, and low-confidence opportunities before ranking.

**Feed structure:** support at least two explainable labels:

- **For You:** derived primarily from Spend DNA and explicit preferences.
- **Watching:** derived primarily from an active mission or explicit shopping request.

A generic “20% off selected items” listing is not a promise of a particular dollar saving until a cart is known.

**Actions:** view terms; save; dismiss; tell the system “not relevant”; mute merchant/category; start a mission; activate through a supported adapter or open the issuer/merchant activation flow. Opening an activation page does not prove activation succeeded.

**Acceptance:** two different fixture profiles produce materially different rankings from the same deal catalog; a strong but irrelevant deal can rank below a weaker but high-affinity deal; an expired offer disappears; a card offer assigned to another user never appears as usable; each personalized result explains its relevance; the feed remains useful with zero active missions.

**Owner:** B. **Consumed by:** Home, notifications, missions, extension, assistant, and checkout entry points.

### 5.3 Product search, research, comparison, and watchlists

**Purpose:** let the user investigate products before purchasing, either because PerkPilot surfaced a relevant deal or because the user begins with a product question.

This feature must strengthen the original consumer-first differentiation. PerkPilot should not become a generic product search engine whose main output is a list of sponsored-looking results. The output is a small, evidence-backed decision set connected to the user's requirements, current prices, existing card benefits, and optional Spend DNA context.

#### Search modes

The request classifier supports at least:

- **Exact lookup:** “Sony WH-1000XM6.”
- **Category search:** “noise-cancelling headphones.”
- **Constraint search:** “running shoes under $150.”
- **Research question:** “best laptop for CS grad school under $1,500.”
- **Comparison:** “Sony XM6 vs Bose QuietComfort Ultra.”
- **Research this deal:** investigate the actual product behind a personalized opportunity.
- **Research from extension:** analyze a supported product page or normalized manual product input.

#### Structured research intent

Extract and persist:

- category;
- explicit budget and price basis;
- must-have requirements;
- nice-to-have preferences;
- excluded brands/products;
- compatibility requirements;
- use case;
- urgency or deadline;
- location/shipping constraints when available;
- whether alternatives are allowed;
- whether Spend DNA should be used as a secondary personalization signal.

Show the interpreted requirements to the user before a long research run when a misunderstanding would materially change the results.

#### Product search

Search returns **canonical products**, not duplicate retailer listings.

Each `Product` is a model/product identity. Each `ProductListing` is a merchant-specific commercial representation containing current observed price, URL/reference, shipping/availability information, and freshness.

For example:

```text
Product
Sony WH-1000XM6

Listings
Merchant A   $349
Merchant B   $329
Manufacturer $399
```

Do not compare retailer listings as if they were separate products.

The MVP should return a small candidate set, generally 3-5 products. The user can broaden the search explicitly.

#### Research evidence model

Research sources must retain `sourceType`, publisher/domain or fixture provider, retrieval time, optional publication date, product association, and source reference.

Supported evidence categories include:

- manufacturer specifications/documentation;
- retailer price/availability/return information;
- professional or independent reviews/testing;
- owner/community discussions or aggregated user feedback;
- PerkPilot-derived calculations such as effective cost.

The system must keep evidence categories distinct. A manufacturer specification may establish dimensions or supported protocols. It should not automatically establish real-world battery performance. Community discussion may reveal recurring complaints but should not be presented as a measured universal fact.

#### Product facts and findings

Store two related concepts:

**ProductFact**
- structured attribute/value;
- evidence references;
- confidence/verification state;
- freshness;
- conflicts if sources disagree.

**ResearchFinding**
- synthesized observation or tradeoff;
- finding type;
- concise summary;
- evidence references;
- optional affected requirement.

Examples:

```text
Fact:
weight = 254 g
source = manufacturer

Finding:
Multiple independent reviews describe ANC as a major strength.
sources = review_12, review_19
```

An LLM may synthesize a finding only from retrieved evidence. It may not create a factual claim and backfill a citation afterward.

#### Personalized research

Personalization uses an explicit hierarchy:

1. user-stated requirements for this research session;
2. hard compatibility/budget constraints;
3. explicit long-term user preferences;
4. Spend DNA/category/merchant context as a secondary signal;
5. general product quality/tradeoffs from evidence.

Spend DNA may change which tradeoffs are emphasized, but it may not change specifications or suppress a clearly superior match to hard requirements.

Do not generate universal product scores such as “9.3/10 best overall” unless the score is an externally sourced metric being quoted with context. Internally, PerkPilot may compute a match score for ranking, but the UI should explain the requirements that caused the ranking rather than presenting false objectivity.

#### Research brief

For each shortlisted product, generate a structured brief containing:

- why it matches the stated request;
- major strengths;
- meaningful tradeoffs;
- compatibility findings;
- current observed purchase options;
- price freshness;
- current Deal Stack estimate when the listing is sufficiently known;
- source summary and evidence links;
- uncertainty/conflicting evidence.

The research brief should be regenerable as sources/prices change.

#### Comparison

A comparison selects 2-3 products and creates:

- shared comparison dimensions;
- requirement-relative differences;
- current observed prices;
- effective-cost calculations where available;
- source-backed advantages/tradeoffs;
- unresolved unknowns.

The first view explains “which is better for what,” not a 40-row specification table.

#### Research this deal

Every product-level personalized opportunity should support a `Research this product` action.

That flow asks:

- Is the product itself a strong fit for the user/request?
- What are the credible strengths and weaknesses?
- Is there a newer or materially different alternative?
- What purchase options exist now?
- What would the product cost after verified/estimated stack components?

A strong discount must never automatically produce a strong product recommendation.

#### Watchlists

The user may save a canonical product to a watchlist without creating purchase permission.

A watch may track supported signals such as:

- merchant price changes;
- new retailer promotion;
- new eligible card offer;
- stock/availability changes;
- active mission threshold becoming true;
- newly observed competing product or refreshed model where the source data supports it.

MVP watch behavior should focus on price/offer changes. Product-release-cycle predictions are future scope unless supported by a reliable structured source.

Watch notifications use the same notification gates and quiet-hour/deduplication rules as the rest of the product.

#### AI role

AI may:

- interpret the research request;
- propose search queries/provider requests;
- extract structured facts from retrieved material;
- cluster recurring findings;
- generate evidence-grounded summaries;
- identify comparison dimensions;
- explain user-relative tradeoffs.

AI may not:

- invent specifications;
- invent current prices or availability;
- infer a product listing from an unrelated merchant transaction;
- perform Deal Stack arithmetic;
- fabricate review consensus;
- cite a source that was not retrieved;
- claim historical price rarity without price-history evidence.

#### Acceptance

- an exact lookup resolves retailer duplicates to one canonical product with multiple listings;
- a broad research request returns a bounded candidate set with structured requirements;
- every material research finding contains evidence references;
- conflicting factual sources remain visible rather than silently reconciled;
- comparison conclusions change when the user's hard requirements change;
- a product can be researched from a personalized deal before checkout;
- watchlist price/offer events deduplicate correctly;
- research still works when Spend DNA is disabled, using explicit session requirements only;
- no product recommendation requires the user to make a purchase.

**Owner:** B. **Consumed by:** Home/Explore, opportunity detail, missions, assistant, extension, notifications, and Deal Stack entry points.

### 5.4 AI shopping missions

**Purpose:** add explicit, short-term purchase intent when the user already knows what they want. When the user does not yet know what to buy, the request should begin as a Research Session and may later become a Mission. Missions complement proactive discovery; they do not define the product.

**Build:** mission creation/editing, structured extraction, product/catalog retrieval, candidate evaluation, and a results screen. Missions may reference an existing Research Session or selected canonical Product. The natural-language entry is real; the product catalog may be synthetic.

**Mission fields:** original request; product category; optional color/size; preferred or excluded merchants/brands; maximum amount; `priceLimitBasis`; currency; optional delivery deadline; alternative-brand permission; notification preferences; and status.

**Default:** “under $120” means **maximum checkout charge**, including known tax and shipping, not a lower cost after a credit arrives. Only use `effective_cost` when the user explicitly chooses it, and still show the full charge. A mission never grants payment permission.

**Flow:** extract validated fields → show editable interpretation → persist mission → retrieve a small candidate set → apply hard constraints → call the shared quote engine → rank and explain tradeoffs → offer a checkout handoff. If size is necessary to verify stock, or shipping is unknown, label that uncertainty instead of claiming a guaranteed match. Unknown delivery dates cannot satisfy a hard arrival deadline.

**Lifecycle:** `active`, `paused`, `completed`, `cancelled`. A mission can have zero, one, or many matches. New offer/catalog events re-evaluate active missions; an inactive browser extension is not the scheduler.

Mission matches may also feed the notification system, but the UI should label them as “Watching” so users can distinguish explicit-intent alerts from history-based “For You” discovery.

**Acceptance:** the request produces correct fields; editing the price ceiling changes matches; an empty result explains which constraint prevented a match; mission and extension quotes agree for the same cart, user, and data versions; deleting all missions does not disable personalized offer discovery.

**Owner:** B. **Consumed by:** notifications, extension context, checkout.

### 5.5 Deal Stack engine

**Purpose:** once a relevant opportunity or shopping intent exists, produce an auditable explanation of eligible savings and actual payment amounts.

**Build:** a pure deterministic calculation package and a server endpoint that loads authoritative cards, rules, and offers. The package must have no dependency on React, browser APIs, an LLM, or the database.

**MVP supported stack:** an observed retailer discount, one eligible card-linked cash benefit, and the selected card's known cash reward. Add coupon permutations, multiple card-offer combinations, loyalty redemption, and points conversion only after this works end to end.

**Inputs:** normalized cart, current price stage, already-applied discounts, tax/shipping amounts or explicit unknowns, supported card rules, user offer assignments, activation state, terms versions, eligibility evidence, and evaluation time.

**Outputs:** per-card quote plans with checkout amount, expected statement credit, estimated cash rewards, estimated effective cost, applied rules, disallowed benefits, prerequisites, source references, and validity period.

**Rules:**

- Do not apply a displayed sale a second time.
- Check minimum spend against the offer's specified basis, not an arbitrary subtotal.
- Enforce expiry, channel, merchant identity, exclusions, caps, usage limits, and per-card assignments.
- Treat unknown stacking as unknown, not as compatible.
- Do not infer a category bonus solely from the product title or an AI category guess.
- Do not subtract credit earned on another card unless split tender is explicitly supported; it is not in the MVP.
- Keep card-linked cash benefits separate from ordinary card rewards.
- If tax/shipping or required eligibility evidence is missing, expose a provisional estimate, not a final executable quote.

**AI role:** interpret unstructured requests and provide grounded explanations. AI-extracted offer terms are proposals until confirmed against the source/structured fixture. They cannot alone establish eligibility.

**Acceptance:** golden arithmetic tests pass; known incompatible benefits never combine; unactivated or unknown benefits are not silently counted as ready-to-use savings; results are reproducible without an LLM.

**Owner:** B. **Consumed by:** every shopping surface.

### 5.6 Best-card recommendations, including Chrome

**Purpose:** after a user chooses to act on an opportunity, tell them which of their existing cards produces the best modeled result for that purchase.

**Build:** one shared ranking response and two renderers: portal comparison and Chrome side panel. Show all supported card options, not just a winner.

**Recommendation semantics:** distinguish `bestAvailableNowCardId` from `bestAfterActionsCardId`. A potentially superior card requiring activation must say so. Among fully evaluable ready plans, rank by lowest effective cost; break ties using the user's preferred card, then a stable ID. Unknown plans appear separately. “Best” means among connected cards with modeled, known rules, not a claim about every card on the market or total financing cost.

**Extension MVP:** Manifest V3; user-initiated analysis of two controlled demo storefronts; plain-JavaScript side panel (React is optional in a future migration); small site adapters; authenticated quote requests; masked card labels; terms/prerequisites; and handoff to prepared checkout for the demo store. On ordinary unsupported sites, provide a manual merchant/amount form or “Site not supported,” not a guessed quote.

Chrome's `activeTab` access is temporary and user-initiated; it does not authorize continuous inspection of arbitrary browsing. Start with click-to-analyze. Automatic badges on selected sites are a later opt-in requiring appropriate site permissions. [S4][S6] Programmatic side-panel opening requires a user interaction; do not design around unsolicited auto-opening on every checkout. [S5]

**Read only:** allowlisted merchant origin, selected product identifiers, visible prices, currency, quantity, and cart totals. Do not capture complete HTML, passwords, PANs, CVVs, addresses, or unrelated browsing. Use a host-validated adapter; strip query strings unless an explicitly supported identifier is required.

**State behavior:** recompute on supported cart changes after permission; bind the result to a cart fingerprint; drop stale responses if the user changes tabs or cart; show a disconnected state when session expires. Store persistent state deliberately, because an extension service worker is not a permanently running process. [S7]

**Acceptance:** an actual locally loaded extension reads a controlled cart, displays the backend's exact ranking, and updates after the amount changes. It never fills or inspects real payment-card fields.

**Owners:** B owns ranking/math; C owns extension, adapters, and browser integration.

### 5.7 Streamlined, approved checkout

**Purpose:** provide an optional action path from a discovered opportunity or mission while reducing repetition without hiding what the user is authorizing.

**Build:** a shared checkout service and portal review screen. Both mission and extension entry points call it. The demo merchant is the only merchant on which the prototype completes a checkout.

**Review screen:** merchant; items and quantities; selected card nickname/last four; amount charged now; tax/shipping; expected later credit; estimated rewards; estimated effective cost; activation state; quote freshness; and a prominent demo/sandbox label when applicable.

**Flow:** select a valid quote plan → fulfill prerequisites → request a new quote if activation or conditions changed → create a short-lived checkout session → review current server-validated details → explicit approval → backend revalidation → provider adapter → payment result.

Bind the approval to user/session, merchant, cart fingerprint, card reference, amount, currency, and quote version. A changed price or expired offer invalidates approval. Require another review rather than silently charging the new amount. Use idempotency for session creation and confirmation so double-clicks or retries cannot create duplicate purchases.

**Three permissions are separate:** linking account data, accessing a particular issuer offer, and provisioning a payment credential. Our data-link screen must not imply the other two have occurred.

**Demo payment:** use an opaque reference such as `demo_payment_card_a`, not a real PAN. The adapter simulates success, decline, processing, and cancellation. Label simulated authorization as simulated. A normal confirmation click is not biometric authentication or proof of production payment security. Real authentication must come from an actually integrated flow.

**Real-site behavior:** recommend the card and let the user complete the merchant's normal checkout. Do not promise arbitrary-site payment automation. The provider adapter is an integration boundary, not permission to charge any merchant.

**Acceptance:** no approval means no purchase; a stale quote fails safely; duplicate confirms return the same checkout result; failed/declined payments never create confirmed savings.

**Owner:** C. **Dependencies:** B's validated quotes/activation; A's authenticated user context and card references.

### 5.8 Post-purchase rewards and “Saved this year”

**Purpose:** close the loop by verifying whether the benefits attached to a discovered opportunity were actually obtained and make the product's value visible.

**Build:** purchase records, reward-event ingestion, benefit status tracking, append-only savings ledger, purchase timeline, and annual summary component.

**Payment and reward are different lifecycles.** A payment authorization is not a posted transaction. A matched transaction is not proof that an issuer credit has posted. Track each benefit separately:

`expected → transaction_matched → qualified → posted`

Alternative states include `rejected`, `reversed`, and `needs_review`. Settlement, qualification, and credit posting are distinct demo events; never advance them because a timeout finished.

**Annual metric (updated for purchase tracking):** display “Saved $X this year” with “Includes estimated cashback” whenever the total includes estimates. Show confirmed ledger benefits and estimated cashback separately. Completed sandbox purchases contribute their persisted cashback estimates; standalone card comparisons contribute only after the user selects “I bought this.” Pending or failed payments and merely viewing recommendations add nothing. Purchase history identifies sandbox, sample, and self-reported estimates. The confirmed ledger subtotal remains observed checkout discounts plus posted statement credits and cash rewards, net of adjustments.

Only count a merchant discount when an attributable completed/settled purchase includes evidence of that discount. Only count card credits/rewards in the **confirmed ledger** once a trustworthy provider/fixture event marks them posted. Keep tracked cashback estimates labeled separately, replacing a sample estimate when its reward posts so the total does not double-count. Do not count viewed deals, unredeemed points, pending credit, a hypothetical alternative purchase, or a catalog's unsupported reference price.

**Acceptance:** settlement, qualification, and posting show different states; replayed events do not double-count; returns reverse recognized purchase-related benefits; an unexplained credit remains unassigned/under review rather than being falsely matched.

**Owner:** C; A embeds C's summary in Home.

### 5.9 Intelligent notifications

**Purpose:** deliver the core promise that **the right deal finds the user**, without turning PerkPilot into a generic sale-spam app.

**Build:** a server-side offer evaluation job, relevance thresholds, deterministic notification gates, deduplication/cooldown, and an in-app notification inbox. Real browser/OS push is optional; the required demo notification is persistent in-app, with a toast while the app is open.

**Triggers:** new or materially improved merchant promotion; new or changed card offer; newly eligible user/card assignment; meaningful Spend DNA change that changes relevance; a mission price condition becoming true. Re-evaluate when relevant data changes, not on every page view. Expiry reminders are optional and must not create a new false “deal.”

**Two notification classes:**

1. **For You discovery:** originated from Spend DNA or explicit long-term preferences. No active shopping request is required.
2. **Watching alert:** originated from a mission or explicit short-term intent.

The user should be able to control these independently.

**Gating order:** consent → valid offer → correct user/card eligibility where applicable → not muted → relevance scoring → minimum relevance/discount thresholds → cooldown/deduplication → quiet-hours/channel behavior.

A notification should normally contain a concise relevance explanation such as:

> “You shop at this merchant frequently, and this is a stronger promotion than the other active offers we currently have for that merchant.”

or:

> “You frequently spend in this category. This similar merchant has a relevant promotion and one of your cards may add an additional benefit.”

Do not claim that an offer is historically unusual unless the system actually stores enough promotion history to support that comparison.

**Proposed defaults, configurable:** at most one promotional notification per merchant in 24 hours and three promotional interruptions per day; save overflow as a digest/inbox entry. Quiet hours default to 9 p.m.-8 a.m. in the user's stored timezone. These defaults are product choices, not external standards. Transaction/reward status updates are a separate category and must not falsely imply savings.

Without a known basket, say “20% retailer promotion” or “$20 back on a qualifying $100 purchase,” not “You will save $40.” A combined stack is shown only when the engine can evaluate it. Explain why the alert was sent and deep-link to the offer or mission with supporting evidence.

**Demo operation:** start with one user's Spend DNA and a catalog containing several irrelevant or weakly relevant offers. An authenticated demo control publishes one new high-relevance fixture offer. The backend runs the real evaluation handler, suppresses the irrelevant offers, and creates exactly one personalized notification. This directly demonstrates the differentiated product thesis.

**Acceptance:** the same offer can notify one fixture user and remain silent for another; a relevant offer generates one record; replay does not duplicate it; a muted merchant does not trigger it; an expired/ineligible offer cannot send a valid-offer alert; history-based discovery works with zero missions; mission-only mode is available as a user preference rather than the product default.

**Owner:** B. **Dependencies:** A's preferences/profile and the same offer/quote data used elsewhere.

### 5.10 Overall AI assistant

**Purpose:** give users a conversational way to understand **why PerkPilot surfaced something**, inspect spending evidence, and access supporting shopping features.

**Build:** one assistant UI, an allowlisted server-side tool router, structured results, and response cards. The assistant may answer “Why did you show me this deal?”, “How much have I spent at Nike this year?”, “What offers match me?”, “Which card should I use here?”, or “Did my $20 credit arrive?” It can link to a mission or prepare its editable form, but it cannot authorize payment.

**Minimum real tools:** `getSpendingSummary`, `getSpendProfile`, `getRelevantOffers`, `searchProducts`, `getResearchSession`, `compareProducts`, `getMissionMatches`, `getQuote`, and `getRewardStatus`. A owns the router; B/C own their domain tool implementations. An unavailable tool returns a typed unavailable response, not an invented answer.

**Spending flow:** extract merchant/time range → resolve the merchant against known records → execute a parameterized, user-scoped aggregate query → return purchase count, gross posted purchases, posted refunds, net spending, interval, last-sync timestamp, and evidence links → have the model explain the tool output.

**Research flow:** parse the user's product question → create or continue a user-owned research session → call the research/search domain tools → return structured candidates/findings with evidence references → let the model explain the results and ask only for missing constraints that materially change the search.

**Offer-explanation flow:** resolve the offer and stored ranking facts → return the concrete features that contributed to relevance, exclusions that were applied, eligibility state, and freshness → have the model explain those facts without inventing motives or hidden data.

Do not let the LLM sum transaction amounts, create relevance facts that were not computed, or generate arbitrary SQL. Exclude transfers, card-bill payments, removed records, and pending transactions from the default spending total. Refunds reduce spending. A pending-to-posted replacement counts once. Merchant ambiguity should be resolved through selectable known merchants, not guessed silently.

The default reporting interval for “this year” is January 1 through now in the user's stored timezone. A request without an interval defaults to this year and states that choice. Totals describe the connected/imported dataset, not every purchase the user has ever made.

**Acceptance:** answers exactly match the database aggregate and stored relevance facts; currency, interval, and freshness are visible; “why this deal?” explains actual ranking evidence; clicking evidence opens corresponding transactions or offer terms; prompts embedded in merchant names or offer text cannot change tool permissions.

**Owner:** A. **Domain dependencies:** B and C expose read-only typed tools.

## 6. Financial calculations and the savings ledger

### 6.1 Common conventions

Use integer USD cents for stored/API amounts. Use integer basis points for percentage rates: `2000` means 20%, `300` means 3%, and `150` means 1.5%. Round at each documented rule boundary using the fixture/provider's specified policy; the demo uses half-up rounding to the nearest cent. Never use language-model arithmetic.

Store explicit amount bases: original item price, observed merchandise amount, already-applied discount, additional eligible discount, shipping, tax, and final checkout charge. `null` means unknown; it must not become zero. Support USD only in v1 and reject mixed/unsupported currencies rather than silently converting.

```text
checkout charge
  = observed merchandise amount
    - additional eligible checkout discounts
    + validated shipping
    + validated tax

estimated effective cost
  = checkout charge
    - eligible expected statement credits
    - estimated cash rewards

confirmed savings & rewards
  = recognized observed merchant discounts
    + posted card-linked credits
    + posted ordinary cash rewards
    + signed reversal/adjustment entries
```

A sale already reflected in observed merchandise is recorded for explanation, but not subtracted again. Discounts/rewards must not exceed their eligible bases or contractual caps. Unmodeled interest, annual fees, late fees, and financing effects are excluded; the comparison is of purchase benefits, not the user's overall cost of credit.

### 6.2 Golden scenario - one arithmetic truth across the whole demo

All values below are synthetic. The fixture explicitly sets tax and shipping to zero so the core demo arithmetic is easy to inspect; unknown real-world tax/shipping must never be treated as zero.

**Cart:** one demo Alo running jacket. Observed pre-sale reference price $130; 20% retailer sale already applied; current merchandise amount $104; shipping $0; tax $0.

**Card product rules and synthetic holdings:** The 1%, 2%, and 1.5% base rates below are published product rules checked on September 24, 2026. The sample person-to-card assignments, last four digits, and Discover-linked $20 Alo offer are *fictional fixtures*. No issuer has verified those accounts or assigned that offer. Rotating/category bonuses are excluded. See [S15]-[S18].

| Card | Rule | Expected card credit | Estimated ordinary cash reward | Checkout charge | Estimated effective cost |
|---|---|---:|---:|---:|---:|
| Discover it Cash Back · 4821 | 1% cash reward; assigned $20 offer on at least $100 discounted merchandise; activation required | $20.00, only after activation and qualification | $1.04 | $104.00 | **$82.96 after activation** |
| Wells Fargo Active Cash · 9274 | 2% base cash reward; no linked offer | $0.00 | $2.08 | $104.00 | $101.92 |
| Capital One Quicksilver · 1502 | 1.5% cash reward; no linked offer | $0.00 | $1.56 | $104.00 | $102.44 |

Before activation, Wells Fargo Active Cash is best available now. Discover it Cash Back is a conditional alternative because of the synthetic assigned offer. After activation and a new quote, Discover it Cash Back is best available now. Without that fixture credit, its effective cost is $102.96.

The engine must express the credit's threshold basis as **discounted merchandise excluding tax/shipping**. The fixture explicitly permits stacking this merchant sale, synthetic assigned card credit, and ordinary cash reward. Do not infer that a real Discover account has this offer or that all real offers use these rules.

**Annual ledger progression from a zero-savings seed:**

| Event | Confirmed savings & rewards | Pending expected benefits |
|---|---:|---:|
| Quote viewed, offer activated, or payment only authorized | $0.00 | Not counted as purchase savings |
| Purchase settled and $26 merchant discount evidenced | $26.00 | $21.04 |
| Card offer qualified but not yet posted | $26.00 | $21.04 |
| $20 statement credit posts | $46.00 | $1.04 |
| $1.04 ordinary cash reward posts | **$47.04** | $0.00 |

The difference between Wells Fargo Active Cash's and Discover it Cash Back's estimated effective cost is **$18.96**, not $47.04. The latter includes the retailer discount and the ordinary reward. Do not claim the entire $47.04 was incremental savings caused by choosing the sample Discover card.

### 6.3 Required edge fixtures

- **Below threshold:** discounted merchandise $99.00. The sample Discover card's synthetic $20 credit does not qualify, even if shipping/tax lift the charge above $100.
- **Boundary:** exactly $100.00 discounted merchandise qualifies when all other conditions hold.
- **Tax known:** with $104 merchandise, $8.32 synthetic tax, and $0 shipping, charge $112.32; the sample Discover card's 1% cash reward rounds to $1.12; effective cost after the eligible $20 credit is $91.20. Keep the threshold basis at $104.00.
- **Tax unknown:** show a provisional quote; no final approval at an invented all-in amount.
- **Expired or unassigned offer:** exclude the credit from ready plans.
- **Already applied sale:** $104 must not become $83.20 from accidentally applying 20% again.
- **Unknown merchant category bonus:** do not grant a 5% reward merely because a page describes running shoes.
- **Repeated provider event:** no extra ledger entry.
- **Full return:** reverse recognized benefits for that purchase; track pending provider clawbacks separately. A returned item cannot continue increasing the savings headline.

### 6.4 Ledger and attribution details

Each ledger row contains a user, purchase, benefit/source reference, kind, signed amount, currency, recognition timestamp, external deduplication key, and optional reversal-of reference. Do not store only a mutable grand total.

Use unique external event IDs and benefit IDs to deduplicate. A reversal is a new negative entry, not deletion of history. Keep uncertain or partial-refund cases out of confirmed benefit claims until reviewed. Full-refund reversal is required; automated partial-refund allocation is stretch scope.

The annual total is the sum of signed entries recognized during the user's local calendar year. A reversal recognized this year for a previous-year benefit reduces this year's figure, with an explanatory detail entry. Currency must match the summary currency.

A sale can only contribute an observed discount if there is a reliable reference price/receipt adjustment. Without that evidence, count only demonstrable posted cash benefits. Do not count tax/shipping counterfactual savings in the MVP headline; show such amounts separately if later supported. A refund is not itself a new saving.

---

## 7. System architecture

### 7.1 Recommended implementation baseline

**Current repository:** dependency-free Node 20 ESM, one local HTTP server in `src/server.js`, browser UI in `public/`, Chrome Manifest V3 extension in `extension/`, pure decision functions in `src/domain.js`, and local JSON state/auth files in `data/`. This is suitable for controlled local demo behavior, not a production deployment.

**Proposed production migration:** a TypeScript monorepo with a responsive React/Next.js portal, server-side API handlers, a React/Vite Chrome extension, controlled demo storefronts, and PostgreSQL. Use runtime schemas for shared contracts and a transactional SQL-backed repository layer. This is a target option, not a claim about the current codebase. Pick and pin compatible package versions when making that migration.

For the UI, create a small shared design-system package rather than styling each feature independently. Use CSS variables or equivalent tokens for surface colors, text hierarchy, radii, spacing, blur, shadows, typography, and motion. The portal and extension should share these tokens where practical.

A lightweight motion library such as Framer Motion is acceptable if already familiar to the team, but motion must remain optional to core behavior and respect reduced-motion preferences. Do not add a heavy component framework whose default appearance overwhelms the Apple Card-inspired visual direction.

One deployable backend is enough. Organize it as independently owned modules, not separately deployed microservices. No message broker, vector database, or complex agent framework is necessary for the initial catalog size. A database-backed job/event handler plus an explicit demo runner is sufficient.

This stack is a proposed engineering choice. If the team is stronger in another stack, retain the boundaries, contract semantics, and design-system rules rather than the exact libraries.

### 7.2 Logical data flow

The primary architecture should mirror the differentiated user loop: **transaction context + new offer → relevance decision → opportunity/notification → optional purchase optimization**.

```text
 Finance fixtures / future data provider       Merchant + offer fixtures / future feeds
                    |                                           |
          A: normalized transactions                   B: normalized offers
                    |                                           |
                    v                                           v
          A: Spend DNA + preferences ----------------> B: relevance ranking
                                                               |
                                              +----------------+----------------+
                                              |                                 |
                                      Personalized feed                 Notification gate
                                              |                                 |
                                              +----------------+----------------+
                                                               |
                                                       relevant opportunity
                                                               |
                                             user may ignore, save, or act
                                                               |
                                +------------------------------+-------------------+
                                |                                                  |
                         B: optional mission                               C: merchant page
                                |                                           / extension
                                +-------------------+------------------------------+
                                                    |
                                           B: shared Deal Stack
                                                    |
                                           card choice / quote
                                                    |
                                      C: approved demo checkout
                                                    |
                                    settlement + reward evidence
                                                    |
                                         C: savings ledger
                                                    |
                                  A/B: future relevance feedback
```

The diagram is a dependency view, not a requirement to deploy many services. The critical architectural point is that **relevance evaluation happens before the checkout path**. The application must be useful even when the user never opens the extension or creates a mission.

### 7.3 Proposed repository ownership

```text
apps/
  web/
    app/
      (core)/                         # A: home, wallet, profile, assistant, settings
      (commerce)/                     # B: offers, missions, notifications
      (purchase)/                     # C: checkout, purchases
      api/v1/
        finance/                      # A
        profile/                      # A
        preferences/                  # A
        assistant/                    # A
        commerce/                     # B
        checkout/                     # C
        rewards/                      # C
        extension/                    # C pairing/session API, using A auth
    src/
      modules/finance/                # A
      modules/profile/                # A
      modules/assistant/              # A
      modules/commerce/               # B
      modules/notifications/          # B
      modules/checkout/               # C
      modules/rewards/                # C
      server/bootstrap/              # A integrates module public exports
  extension/                          # C
  demo-store/                         # C
packages/
  contracts/                          # A is merge steward; frozen with all three
  fixtures/                           # A identity/finance; B catalog/offers; C events
  decision-engine/                    # B: pure calculations, no I/O
  ai-runtime/                         # A: provider interface, validation, fallbacks
  ui/                                 # A: Apple Card-inspired shared visual system, tokens, primitives; no domain business logic
  db/                                 # A connection/bootstrap; domain migrations by owner
  api-client/                         # A: typed client; all consumers use same contracts
```

The paths above describe a possible future organization; the actual current paths are listed in section 18. They are not existing files. Domain-owned route groups must not define conflicting URLs. Feature modules expose a small `public.ts` or equivalent interface; consumers do not import private repository code.

### 7.4 The boundaries that make parallel work possible

- **A → B:** `getShoppingContext(user)` supplies masked cards, profile, relevant preferences, and source versions. No raw account balances are needed to rank offers.
- **B → A/C:** `searchProducts`, `createResearchSession`, `getResearchBrief`, `compareProducts`, `watchProduct`, `createQuote`, `validateQuote`, `getOffers`, `createMission`, `getMissionMatches`, and `activateOffer` expose research/commerce functions.
- **C → A/B:** `getSavingsSummary`, `getPurchase`, and `getRewardStatus` expose read models.
- **C → A:** confirmed demo settlement can call A's `ingestExternalTransaction` port so the finance history receives the synthetic transaction exactly once. C never writes A's tables directly.
- **A → B/C assistant tools:** A owns authorization/routing; each domain owns tool execution and its result schema.

Use in-process interfaces inside the backend and authenticated HTTP for browser/extension clients. Do not make internal modules call their own deployment over HTTP unless necessary.

Every boundary has a fixture-backed implementation. Each teammate can build and test their complete screen/service flow before the other implementations are merged.

### 7.5 Event handling

Use versioned event envelopes with `eventId`, `type`, `userId` set by trusted infrastructure, `occurredAt`, `sourceMode`, and `payload`. Required events include:

| Event | Producer | Main consumer |
|---|---|---|
| `finance.transactions_changed` | A | A profile refresh; B relevance invalidation |
| `profile.updated` | A | B feed/mission refresh |
| `research.watch_changed` | B | B watch evaluator / notifications |
| `research.listing_changed` | B provider/fixture | B research freshness and watch evaluator |
| `commerce.offer_changed` | B | B notification and mission evaluator |
| `commerce.offer_activated` | B | B quote invalidation; C re-quote UI |
| `purchase.authorized` | C | C purchase status only |
| `purchase.settled` | C adapter or trusted provider | A transaction-ingest port; C purchase/reward tracking |
| `reward.qualified` | C provider/fixture handler | C reward timeline |
| `reward.posted` | C provider/fixture handler | C ledger and summary |
| `purchase.refunded` / `reward.reversed` | C provider/fixture handler | C adjustments; A financial transaction update via its port |

Consumers must tolerate duplicates and unknown event ordering. Record unresolvable events for review/retry; do not fabricate intermediate proof. A full production outbox/retry system is later work, but a persisted event log and idempotent demo replay are required.

---

## 8. Core data model and shared contracts

### 8.1 Domain entities

| Entity | Essential fields and invariants | Writer |
|---|---|---|
| User / consent / preferences | Timezone; allowed data uses; muted categories/merchants; notification rules | A |
| Account | Asset/liability type, current balance, currency, source, last sync | A |
| Card | Opaque ID, user/account relationship, nickname, network, last four, linked reward-rule references | A |
| Transaction | Provider ID, account/card, normalized merchant, amount, kind, status, posted time, replacement/refund links | A |
| SpendProfile | Structured affinities, explicit preferences, evidence references, exclusions, source versions | A |
| Merchant | Canonical ID, verified demo origins/aliases, category/tags; known MCC only when sourced | B |
| Product | Canonical product identity, brand/model/category, normalized attributes, image/reference metadata | B |
| ProductListing | Product/merchant relationship, merchant product ID, observed price, shipping/availability, URL/reference, freshness | B |
| ResearchSession | Original query, structured requirements, candidate references, status, user ownership, source versions | B |
| ResearchSource | Source type, publisher/provider, URL/reference, retrieved/published timestamps, provenance | B |
| ProductFact | Product/attribute/value, evidence references, confidence/verification state, freshness, conflicts | B |
| ResearchFinding | Product, finding type, evidence-backed summary, affected requirement, evidence references | B |
| ProductComparison | Research session, selected products, dimensions, requirement-relative findings, source versions | B |
| WatchItem | User/product, target conditions, notification preferences, status, last evaluated source versions | B |
| Offer | Merchant/card targeting, benefit type, activation requirement, spend basis, limits, exclusions, dates, source and terms version | B |
| UserOffer | User/card assignment, eligibility evidence, activation status/timestamp, usage counters | B |
| CardRewardRule | Rate, eligible category/merchant/basis, caps, known evidence, version | B |
| Mission | Structured request, constraints, status, user ownership, result references | B |
| Quote | Cart fingerprint, per-card plans, prerequisites, certainty, source versions, expiry, user ownership | B |
| Notification | Trigger/reference, dedupe key, reason, channel, read/dismiss/delivery states | B |
| CheckoutSession / approval | Quote/plan, immutable approved inputs, user/session binding, idempotency key, status | C |
| Purchase | Provider/order IDs, merchant, card reference, actual charge, currency, authorized/settled/failed/refunded state | C |
| RewardRecord / event | Purchase/benefit link, expected/posted amounts, qualification state, trusted event ID | C |
| SavingsLedgerEntry | Signed cash amount, kind, recognition time, evidence, source event, reversal link | C |

Balances are normalized explicitly: asset amounts contribute positively and owed liabilities subtract from net worth. Cards associated with credit accounts must not introduce duplicate liabilities. The displayed figure is “Net worth across connected accounts,” with freshness and coverage, not a claim of complete financial net worth.

A card ID or account-data token is not a usable payment credential. The payment adapter resolves approved opaque references in its own server-side scope.

### 8.2 Common contract rules

Every public request/response is runtime-validated. Authenticate once and derive the user server-side; clients must not select another user's identity through a `userId` field. Reject access to a card, quote, mission, or purchase not owned by that session.

Money is integer cents; timestamps use ISO 8601 UTC; date-only constraints carry an explicit timezone. Preserve `demo`, `sandbox`, or `live` provenance. All lists are bounded/paginated. Unknown is not the same as zero, false, eligible, or complete.

Shared objects include `ShoppingContext`, `Product`, `ProductListing`, `ResearchIntent`, `ResearchBrief`, `ResearchFinding`, `ProductComparison`, `WatchItem`, `CartSnapshot`, `QuoteRequest`, `Quote`, `CardPlan`, `RequiredAction`, `CheckoutSession`, `RewardStatus`, `SavingsSummary`, `SpendingSummary`, and `DomainEvent`.

The implemented local routes and shared objects are documented in **[CONTRACTS.md](CONTRACTS.md)**. The original `SHARED_CONTRACTS.md` referenced by the supplied brief was not attached. This design remains the product reference; `CONTRACTS.md` reflects the current code.

### 8.3 Endpoint groups and ownership

All routes below have the `/api/v1` prefix. Use session authentication, schema validation, and common error envelopes.

| Routes | Responsibility | Owner |
|---|---|---|
| `GET /finance/summary`, `/finance/cards`, `/finance/transactions` | Background finance and wallet data | A |
| `POST /finance/spending-summary` | Bounded deterministic spending aggregate | A |
| `GET /profile`, `POST /profile/regenerate`, `PATCH /profile` | Spend DNA read, rebuild, corrections | A |
| `GET/PATCH /preferences` | User privacy and relevant preferences | A |
| `POST /assistant/messages` | Tool-grounded assistant | A |
| `GET /commerce/offers`, `POST /commerce/offers/:id/activate` | Feed and supported activation | B |
| `POST /research/sessions`, `GET /research/sessions/:id` | Create/read product research sessions | B |
| `GET /research/sessions/:id/candidates`, `GET /research/products/:id/brief` | Candidate results and evidence-backed product briefs | B |
| `POST /research/comparisons`, `GET /research/comparisons/:id` | Structured product comparison | B |
| `GET/POST/PATCH /research/watchlist` | Product watches and supported trigger preferences | B |
| `GET/POST /commerce/missions`, `PATCH /commerce/missions/:id`, `GET /commerce/missions/:id/matches` | Mission lifecycle/results | B |
| `POST /commerce/quotes`, `GET /commerce/quotes/:id` | Authoritative calculation and quote details | B |
| `GET /commerce/notifications`, `PATCH /commerce/notifications/:id` | Inbox and read/dismiss state | B |
| `POST /checkout/sessions`, `GET /checkout/sessions/:id`, `POST /checkout/sessions/:id/confirm` | Shared review/approval/checkout | C |
| `GET /rewards/purchases`, `/rewards/purchases/:id`, `/rewards/summary` | Purchase/reward/annual views | C |
| `POST /extension/pairings`, `/extension/pairings/:id/approve`, `/extension/pairings/:id/exchange` | Explicitly approved extension pairing | C using A auth |

Provider webhooks and demo event publishing are separate authenticated internal routes, never general assistant tools. Checkout confirmation is a direct approved UI action, not a tool the LLM may invoke.

---

## 9. External integrations and demo boundaries

### 9.1 What must be real in the prototype

The application logic must really run, with particular emphasis on the core differentiated loop:

1. Spend DNA is generated from supplied transaction data and explicit preferences.
2. Multiple offers are evaluated against that profile.
3. At least one offer is suppressed as irrelevant while another is ranked highly for explainable reasons.
4. A newly published relevant offer creates a personalized notification **without requiring an active mission**.
5. The user can inspect why that offer matched.

The supporting action path must also be real: structured mission extraction; exact quote arithmetic; best-card ranking; an actual locally loadable extension; explicit checkout gating; persistent reward state; ledger accounting; and tool-grounded spending/offer questions.

“Real logic” does not require real money or live consumer accounts. A controlled demo store with synthetic products is acceptable when labeled honestly. A polished checkout demo does not compensate for a hardcoded or generic personalized-deal feed.

### 9.2 Integration plan

| Capability | MVP implementation | Future/optional integration | Boundary |
|---|---|---|---|
| Accounts and transactions | Seeded provider with normalized records | Authorized financial-data provider | `FinanceProvider` owned by A |
| Card selection | Named issuer products with sourced base rates; synthetic sample holdings or user self-report | Provider-verified ownership, current personalized rules, and payment eligibility | A cards + B reward-rule catalog |
| Merchant products/prices | Small canonical product catalog with multiple listing fixtures | Permitted merchant/affiliate/product-search feeds | `CatalogProvider` / `ProductSearchProvider` owned by B |
| Product research evidence | Curated source fixtures with typed manufacturer/review/community evidence | Permitted web/search/review/product-data providers | `ResearchProvider` owned by B; evidence references required |

| Retailer promotions | Structured fixture offers with known terms | Merchant feeds/approved integrations | `OfferProvider` owned by B |
| User-specific card offers | Explicit fixture assignments | Issuer/program-specific access | `CardOfferProvider` owned by B |
| Offer activation | Fixture state transition | Supported issuer/program activation or external handoff | B activation adapter |
| Payment | No-money demo adapter | Enabled sponsor sandbox / merchant payment integration | `PaymentProvider` owned by C |
| Qualification and credit posting | Signed/internal synthetic event replay | Enrolled Visa program or issuer/provider events | `RewardProvider` owned by C |
| Notifications | In-app inbox/toast | Email or browser push after opt-in | B delivery adapter |

Financial transaction updates are not necessarily instant. For example, Plaid documents institution-dependent transaction refresh behavior and update webhooks. Do not promise instant purchase verification from a generic account-link integration. [S8]

### 9.3 Sponsor-access decision rule

At bootstrap, identify which sponsor credentials, sample applications, and approved use cases are actually available. If one integration can be exercised reliably, place it behind its adapter and demonstrate the exact request/result. Otherwise, complete the fixture-backed flow without mislabeling it as live.

Before claiming integration, record the product, environment, authenticated request, actual response, and which displayed behavior that response powers. Merely installing an SDK or showing a Visa logo does not count.

Do not scrape issuer dashboards or collect bank passwords to compensate for unavailable access. Do not treat public API documentation as authorization to operate a production program.

---

## 10. Privacy, security, and failure behavior

### 10.1 Data boundaries

Keep provider credentials and signing keys only on the server. Neither extension, ordinary frontend bundle, logs, nor language-model prompts may contain real payment credentials, full card numbers, CVVs, bank passwords, or reusable provider tokens.

Minimize model input: merchant/category aggregates for Spend DNA; a structured intent for missions; validated tool results for explanations. Do not send unrelated financial history to explain one card recommendation. Do not use net worth or account balances to nudge purchases.

Consent covers account linking, transaction-based personalization, and site access separately. Preferences must be editable and revocable. A personalization exclusion affects profile/recommendations; it need not delete the user's own transaction record. Account disconnection stops future sync. Profile deletion removes derived data and invalidates relevant caches; security/audit retention, if any, needs an explicit production policy.

### 10.2 Untrusted inputs and AI controls

Merchant descriptions, page content, product metadata, research sources, review/community text, offer text, and transaction memos are untrusted data, not instructions. Tool permissions, identity, database access, and payment approval live outside the model. Validate extracted objects against schemas; sanitize rendered text/HTML; impose token/result limits; and reject arbitrary URLs or database queries from the model.

For the MVP, ingest only controlled catalog/offer/research data and known storefronts. If URL fetching is later added, enforce an allowlist, block private/internal destinations and unsafe redirects, and apply size/time limits. Do not add a generic server URL fetcher simply to support pasted links.

### 10.3 Extension/session boundary

A pairs the logged-in user context with C's extension session through a server-mediated approval flow. Use a short-lived, one-use pairing secret; explicit confirmation in the logged-in portal; a short-lived revocable extension token; origin/extension validation; and rate limits. A visible pairing ID alone must not redeem the session.

Never accept payment instructions from arbitrary page `postMessage` content. Content-script input is only shopping context. Secrets belong in extension-controlled storage, not a page DOM field. Reject other users' quote IDs and enforce ownership on every backend read.

Use HTTPS outside localhost. Restrict CORS/allowed origins to the portal and known development/production extension origins as appropriate; origin checks complement authentication, not replace it. Avoid global `<all_urls>` permissions for the demo.

### 10.4 Fail safely

| Condition | Required behavior |
|---|---|
| AI unavailable or invalid JSON | Keep deterministic quotes and raw spending results available; show an honest interpretation/explanation fallback |
| No transactions | Offer explicit preference onboarding; do not fabricate a profile |
| Offer source stale or terms incomplete | Label unverified; exclude from ready-to-execute benefits |
| Unsupported site / unreadable cart | Manual input or unsupported-state UI; no pretend automatic extraction |
| Unknown tax or shipping | Provisional total; require a verified final charge before approval |
| Merchant/card identity unresolved | No category/merchant bonus claim until resolved |
| Quote expired or changed | Re-quote and request new approval |
| Activation requires issuer action | Open the appropriate handoff; retain unverified status until evidence returns |
| Payment declined, cancelled, or pending | Accurate status; no fabricated success or posted rewards |
| Duplicate/out-of-order event | Idempotent handling, replay/review queue, no inflated ledger |
| Missing credit | Pending/review state; no invented issuer posting date |

The prototype must not advertise itself as PCI compliant, bank-grade, universally supported, or production-certified. A sensible security design is not a certification.

---

## 11. Three-person ownership and parallel development

### 11.1 Split by complete feature area, not frontend versus backend

Do not assign one person all frontend, another all backend, and another “AI.” That creates a queue where almost every visible feature depends on everyone else. Each person instead owns a bounded set of screens, services, storage, and tests.

| Person | Workstream | Features owned | Independently demonstrable outcome |
|---|---|---|---|
| **A** | **Finance, Spend DNA & Assistant** | Finance background; Spend DNA (#1); overall assistant (#9); auth/shared bootstrap | Seeded transactions → correctable Spend DNA → exact spending and relevance evidence |
| **B** | **Discovery, Research & Commerce Intelligence** | Personalized offer feed; notifications; product search/research/comparison/watchlists; missions; Deal Stack; card-ranking logic | Profile-specific deal → research this product → evidence brief/comparison → optional quote |
| **C** | **Browser, Checkout & Rewards** | Chrome UI; checkout; tracking/savings; demo storefronts | Discovered opportunity/cart → shared quote → approved demo checkout → posted reward → updated savings |

This is an approximately balanced starting split, not a claim of identical effort. B owns the most important differentiated product behavior: relevance ranking and notification selection. A must provide trustworthy profile evidence for that ranking. C demonstrates that the discovered opportunity can continue through a secure, consistent commerce flow. Optional provider integrations remain outside the critical path.

### 11.2 Person A - Finance, Profile & Assistant

**Own end to end:**

- Repository bootstrap, shared auth context, typed API client, runtime-schema foundation, database connection, Apple Card-inspired shared UI primitives/tokens, and top-level navigation.
- Demo session/login, consent/preferences, accounts, masked cards, transaction importer/fixtures, merchant alias consumption, and connected-account net worth.
- Deterministic spending aggregates with refund/pending/transfer handling.
- Spend DNA evidence generation, model summary, corrections, exclusions, and UI.
- Overall assistant tool router and finance tools; common `ai-runtime` interface/fallback behavior so B can use it without adopting a different AI client.
- Home integration through B/C's public components/read models, not duplicate domain logic.

**Deliver to teammates:** `ShoppingContext` service; session/user middleware; masked-card/transaction fixtures; profile/preference read ports; spending tool; AI provider interface; shared UI tokens/components; reference Home, Spend DNA, and material-sheet patterns; shared client conventions.

**Can work without B/C:** use fixture-backed `CommerceReadPort` and `RewardsReadPort`. The assistant demonstrates its own real finance queries; unavailable shopping actions remain explicit fixture/unavailable responses.

**Does not own:** offer eligibility, Deal Stack arithmetic, browser adapters, purchase authorization, or savings-ledger calculations.

**Completion evidence:** A-only tests pass; a profile correction persists; merchant-spending answers match exact fixture totals; tenant isolation tests pass; core routes run with fixture domain clients.

**Dedicated packet:** [workstreams/A_FINANCE_PROFILE_ASSISTANT.md](workstreams/A_FINANCE_PROFILE_ASSISTANT.md).

### 11.3 Person B - Discovery, Research & Commerce Intelligence

**Own end to end:**

- Merchant/product/offer catalogs, source/terms provenance, reward-rule definitions, and user-specific offer assignments.
- Spend-DNA-driven relevance scoring, personalized opportunity ranking, relevance explanations, and suppression of low-value/noisy offers.
- Offer feed details, save/dismiss/not-relevant/mute interactions, and activation adapter using the shared `OpportunityCard` and opportunity-detail visual patterns.
- Pure Deal Stack package, ready-versus-conditional card ranking, quote creation/validation, and golden test vectors.
- Product search normalization, Research Sessions, evidence-backed research briefs, comparisons, and watchlists.
- Natural-language mission extraction via A's runtime interface, mission persistence, catalog retrieval, results, and quote-backed comparison.
- Notification selection/deduplication, in-app inbox, and the controlled new-offer trigger. History-based notifications must work without any active mission.
- `MissionSummary` and commerce tool implementations consumed by A; quote and activation endpoints consumed by C.

**Deliver to teammates:** normalized `Product`/`ProductListing`; `ResearchBrief`/comparison/watch APIs; validated `Quote` and `CardPlan`; fixture quote responses; offer/mission clients; `validateQuote`; activation result; structured explanation facts; notification records.

**Can work without A/C:** inject a `ShoppingContextPort` fixture and a provider-neutral AI stub or real model adapter. Present results against the shared golden dataset. Checkout buttons may link to an explicit placeholder route until C is integrated; do not build a second payment flow.

**Does not own:** general auth, financial-data ingestion, whole-site browser scraping, actual payment execution, or reward posting.

**Completion evidence:** a broad product question produces a bounded evidence-backed candidate set; `Research this product` works from a personalized deal; the same catalog produces different explainable rankings for two profiles; a high-relevance new offer notifies one user without a mission while irrelevant offers remain silent; arithmetic/boundary tests pass; mission and direct quote agree; duplicate notification events do not spam; no model is needed to calculate a valid quote.

**Dedicated packet:** [workstreams/B_COMMERCE_INTELLIGENCE.md](workstreams/B_COMMERCE_INTELLIGENCE.md).

### 11.4 Person C - Browser, Checkout & Rewards

**Own end to end:**

- Manifest V3 extension, side-panel interface that visually matches the portal design system, Research-this-product handoff, cart adapters, pairing/session flow with A's auth port, stale-context protection, and manual fallback.
- Two controlled demo storefronts on a separate origin from the portal, consuming the shared catalog/fixtures. They are visibly demo stores, not impersonations of a retailer.
- Shared checkout session/review/confirm flow for both mission and extension entry points.
- No-money `PaymentProvider`, optional actually available sponsor integration, request idempotency, approval binding, and provider event normalization.
- Purchase/reward lifecycle, trusted event replay, savings ledger, full-return adjustments, purchases UI, and `SavingsSummary` component.
- End-to-end happy path and payment/reward failure-path demonstration; C coordinates the final browser demo.

**Deliver to teammates:** checkout URL/session API; purchase and reward read tools; savings summary API/component; demo-store adapters; trusted event fixtures; A's settlement-ingest payload.

**Can work without A/B:** use fixture auth/context, quote/activation/validation clients, and shared golden responses. Quotes remain marked fixtures until the live internal B client is connected. Do not reimplement the card calculator to unblock UI.

**Does not own:** Spend DNA, transaction aggregation, offer matching, or the ranking algorithm. It renders B's financial response verbatim except for safe currency formatting.

**Completion evidence:** locally loaded extension reads the demo cart; approval is required; changed cart invalidates approval; repeated confirmations/events are idempotent; the ledger reaches $47.04 only after the specified events.

**Dedicated packet:** [workstreams/C_EXTENSION_CHECKOUT_REWARDS.md](workstreams/C_EXTENSION_CHECKOUT_REWARDS.md).

### 11.5 Prevent merge conflicts and accidental ownership overlap

1. **One bootstrap merge first.** A creates the workspace skeleton, shared contract skeleton, root tooling, and minimum auth/client conventions. All three review the golden fixture and interface shapes before large implementation branches start.
2. **Freeze shared interfaces.** A is the merge steward for `contracts`, root configuration, lockfile, database bootstrap, and global layout. Domain changes are proposed, not silently duplicated with a different field spelling.
3. **Use module-owned tables and migration ranges.** A owns migrations `100_*`, B `200_*`, C `300_*`; order by a shared registry. Each uses its own local database/schema. Nobody resets a shared database while another teammate is testing.
4. **Use separate branches/worktrees.** Suggested names: `feat/finance-profile-assistant`, `feat/commerce-intelligence`, `feat/extension-checkout-rewards`. Do not run several coding agents against the same working directory or let them rewrite the same lockfile concurrently.
5. **Each developer may edit their subtree and tests.** Cross-boundary changes need a small coordinated contract patch. Do not “fix” another module by importing its private storage internals.
6. **Integrate public modules once.** A owns top-level routing/bootstrap composition. B/C export their route/service/component modules with documented props and dependencies.

True zero-dependency work is not possible: the contract/bootstrap agreement and final integration are shared gates. The goal is independent implementation **between** those gates, not pretending three isolated apps will merge automatically.

---

## 12. Build sequence and Codex handoff

### Gate 0 - Shared baseline

Agree the working stack, stable IDs, API prefix, money conventions, user/session context, source labels, Spend DNA shape, offer shape, relevance-reason shape, notification record, quote shape, and golden scenario. Freeze the first-pass UI tokens, navigation structure, OpportunityCard, SpendDNAVisual, FinancialBreakdown, MaterialSheet, and CardPicker before each workstream invents its own styling. Bootstrap the workspace and fixture clients. Decide whether any sponsor integration is actually usable, without blocking the demo adapters.

**Exit condition:** all three can render a minimal route or extension panel using the same schema-validated fixture objects and shared visual tokens. The team can point to the exact structured fields B will use to explain why an offer matches A's Spend DNA. Home, Spend DNA, and one opportunity-detail state share the same spacing, typography, radii, and material language.

### Gate 1 - Prove the differentiated discovery loop

A builds normalized transactions, Spend DNA, corrections, and preferences. B builds offer ingestion, relevance ranking, feed cards, notification gating, and a controlled new-offer trigger. C can proceed in parallel with storefront/extension/checkout fixtures.

The first integrated milestone is:

`transactions → Spend DNA → new offer → relevance decision → personalized feed/notification`

Do not wait for missions, extension, or checkout to prove this loop.

**Exit condition:** from the same offer catalog, two fixture users receive different rankings; publishing one new relevant offer produces an explainable notification for the intended user with zero active missions; irrelevant offers remain suppressed.

### Gate 2 - Add the Explore layer

B adds canonical product search, evidence-backed Research Sessions, Research this product, comparisons, watchlists, and mission handoff. A connects the assistant to the research tools. C connects the extension to the same Research-this-product entry point.

**Exit condition:** a user can research a proactively surfaced deal before buying, and a novel product question can produce a bounded, sourced candidate set and comparison.

### Gate 3 - Add the action layer

B adds quote/Deal Stack, card ranking, and activation flow. C connects the same quote output to the extension and approved demo checkout. Research-selected products/listings use the same financial engine as offer/mission paths.

**Exit condition:** a user can move from proactive discovery, research, or explicit mission into a consistent quote/card decision without duplicating research, ranking, or financial logic.

### Gate 4 - Add verification and feedback

Wire C's purchase, settlement, qualification, posting, and savings status into A/B read models. Allow confirmed transactions and explicit user feedback to influence later profile/relevance refreshes through approved ports.

**Exit condition:** one coherent journey can move from discovery to action to verified benefit, and new evidence can safely feed the next relevance cycle.

### Gate 5 - Trust and demo hardening

Run duplicate-event, irrelevant-offer suppression, muted-merchant, no-consent, return, unknown-data, expired-quote, changed-cart, and authorization tests. Make demo/sandbox labeling consistent. Add useful empty/error states. Freeze the presentation path and use protected reset/publish/replay controls rather than manual database edits.

**Exit condition:** the end-to-end flow passes from a clean seed repeatedly, and the team can explain which parts are live, sandboxed, or simulated.

### What to give each Codex session

Give each developer's agent the overview, shared contracts, and **only that developer's workstream packet** as its primary implementation brief. The packet includes deliverables, ownership, dependencies, build slices, tests, and a paste-ready instruction. If the repository already exists, also provide its actual README and conventions.

A large design document should describe the whole module, but implementation should proceed in internally tested slices. Avoid asking an agent to rewrite the entire application in one unreviewable patch.

**Shared agent instructions:**

> Read `PERKPILOT_COMPLETE_DESIGN.md`, `CONTRACTS.md`, and the current repository code. The original workstream packets were not attached. The product's differentiated core is transaction-aware proactive deal discovery: Spend DNA plus new offer data must produce explainable personalized opportunities and notifications even with no active shopping mission. Inspect the repository before editing. Implement only your owned paths using the shared contracts. Use fixture ports for unfinished dependencies; do not invent new APIs or duplicate another module's logic. Begin with failing tests for the critical rules, implement a vertical slice, and run the relevant checks. Follow section 4's Apple Card-inspired design system instead of introducing a generic dashboard kit or unrelated visual conventions. Keep demo/sandbox/live provenance visible. Do not add live banking or payment behavior without explicit credentials and approval. Finish with changed paths, test results, assumptions, integration instructions, and unresolved blockers. Do not claim tests or integrations passed unless they actually ran.

### Required implementation commands

The codebase should eventually provide documented equivalents of `dev`, `test`, `typecheck`, `lint`, `build`, `db:migrate`, `db:seed`, `demo:reset`, and `test:e2e`, plus extension build/load instructions. These are implementation deliverables, **not commands that exist in this documentation-only bundle**.

## 13. Acceptance tests and definition of done

### 13.1 Required tests by concern

| Area | Test | Owner |
|---|---|---|
| Finance | Credit-card payment/transfer excluded from spending | A |
| Finance | Pending transaction replaced by posted transaction counts once | A |
| Finance | Refund reduces merchant net spending; summary cites interval/coverage | A |
| Isolation | Other user's card/quote/purchase cannot be accessed | A middleware; B/C domain tests |
| Profile | Exclusion/correction survives regeneration; no inferred product details from merchant-only data | A |
| AI assistant | Structured aggregate is the authority; injected merchant text cannot run arbitrary tools | A |
| Offers | Same catalog produces different explainable rankings for different Spend DNA profiles | B |
| Offers | Strong but irrelevant deal can rank below a weaker high-affinity deal | B |
| Offers | Expired, muted, low-confidence, and unassigned offers do not appear as ready benefits | B |
| Notifications | History-based relevant offer can notify with zero active missions; irrelevant offer remains silent | B |
| Research | Exact product lookup normalizes duplicate merchant listings under one canonical product | B |
| Research | Broad request returns bounded candidates with structured requirements and evidence-backed findings | B |
| Research | Material findings retain evidence references; conflicts are not silently hidden | B |
| Research | Comparison changes appropriately when hard user requirements change | B |
| Research | `Research this product` works from a personalized opportunity before checkout | B/C |
| Watchlist | Price/offer event deduplicates and respects notification preferences | B |
| Missions | Hard price/deadline constraints and unknown data are respected | B |
| Arithmetic | All golden values and threshold/rounding cases in section 6 pass | B |
| Stacking | Already-applied sale is not applied twice; unknown compatibility is not assumed | B |
| Card ranking | Best-now vs best-after-activation changes correctly | B |
| Notifications | Replayed event produces one alert; quiet/muted rules apply | B |
| Extension | Cart extraction agrees with store totals; stale tab/cart responses discarded | C |
| Checkout | Expired/repriced quote requires a new review/approval | C with B validation |
| Checkout | Double-click/retry produces a single provider attempt/purchase | C |
| Rewards | Qualification is distinct from posting; duplicates do not increase annual total | C |
| Returns | Full return adjusts benefits; refund is not a new saving | C |
| Resilience | AI/network/provider failure gives an accurate fallback, not fake success | All |
| End to end | App and extension produce identical quote plans for the same current context | B/C |
| UI | Home has one clear hero opportunity and no dense KPI grid | A/B |
| UI | Spend DNA uses one personalized visual plus simple evidence sections, not a dense analytics dashboard | A |
| UI | Shared typography, radius, spacing, and surface tokens are used across portal and extension | A/C |
| UI | Pay-today, expected-later, and confirmed-savings values remain visually distinct | B/C |
| UI | Core screens remain usable at narrow/mobile width and with reduced motion | All |

Use pure unit tests for math and ledger rules, contract tests for module boundaries, API tests for ownership/idempotency, and browser tests/manual extension checks for the integrated journey. Keep the exact golden fixture as a shared regression case, not a slide-only example.

### 13.2 Definition of done for the hackathon

The prototype is not complete merely because all product capabilities have screens. The differentiated discovery loop must be visibly real.

- The finance background shows accounts, cards, transactions, coverage, and net worth without becoming a budgeting workflow.
- Spend DNA is generated from transaction evidence, is editable, and avoids item-level inventions.
- The same set of offers ranks differently for at least two fixture profiles for explainable reasons.
- A newly published high-relevance offer can create a “For You” notification with **zero active missions**.
- At least one attractive but irrelevant offer is intentionally suppressed or ranked low, demonstrating that PerkPilot filters rather than simply aggregates deals.
- Each personalized opportunity explains why it matched using stored relevance facts.
- At least one real model call explains structured user/profile/offer data, and at least one interprets a novel mission; model outages have labeled fallbacks.
- A proactively surfaced product-level opportunity supports `Research this product` before purchase.
- At least one novel natural-language product research request returns 3-5 canonical candidates with evidence-backed briefs.
- At least one comparison explains requirement-relative tradeoffs without relying on a fake universal score.
- The same canonical product can expose multiple merchant listings without appearing as duplicate products.
- The same Deal Stack engine powers portal decisions and the actual extension.
- At least one merchant promotion and one user-specific card offer are modeled together correctly.
- Checkout explicitly confirms a current exact charge for the controlled merchant.
- Purchase, qualification, posting, and savings updates are event-driven and separately visible.
- “Saved this year” is derived from ledger entries and has a readable definition.
- Real external integrations, if any, are documented with evidence; mocked integrations are labeled.
- The Home / For You screen visually prioritizes one or a few relevant opportunities rather than balances, KPI tiles, or an infinite coupon grid.
- Spend DNA, opportunity detail, card comparison, Saved, checkout, and extension surfaces visibly use one coherent Apple Card-inspired design system.
- Pay-today, expected-later, and confirmed-savings states remain visually distinct even in the simplified UI.
- A fresh teammate can seed/run the app and load the extension from the implementation README.
- Tests, type checking, and builds actually run before anyone claims the implementation is complete.

### 13.3 Useful demo measurements

Measure the product in the order of its value proposition:

- profile evidence correctness and correction persistence;
- relevance separation between two different fixture users;
- number of catalog offers evaluated versus opportunities actually surfaced;
- notification precision in the controlled fixture scenarios;
- deduplication and mute/quiet-hour behavior;
- research candidate normalization and evidence coverage;
- successful research intent parsing and comparison generation;
- successful mission parsing when explicit intent is used;
- quote agreement between portal and extension;
- deterministic financial scenarios passed;
- observed quote latency;
- confirmed ledger value.

These are prototype measurements. Do not invent conversion uplift, average customer savings, recommendation accuracy on real consumers, or customer adoption statistics.

## 14. Demo dataset and presentation flow

### 14.1 Shared fixture plan

Use one coherent local dataset. The current IDs and contracts are represented in `src/fixtures.js`, `src/research-fixtures.js`, `src/card-catalog.js`, and `CONTRACTS.md`; the original `SHARED_CONTRACTS.md` was not supplied.

**A fixtures currently present:** Alex Morgan and Taylor Lee; three synthetic account records; four sample card holdings across the two profiles; 53 synthetic transactions; posted purchases, refunds, transfers, pending replacements, and a gift-excluded transaction. Card product names and base rules are real published metadata; sample ownership and last four digits are not. Store dates relative to an injected demo clock for tests and display the active demo date.

**B fixtures currently present:** six merchants, eight controlled checkout products, nine structured offers, a separate fictional research catalog with canonical products and multi-merchant listings, curated typed evidence, product research/comparison/watch flows, and four published base card reward rules. Research sessions, comparisons, watches, missions, notifications, quotes, and purchases are created through the demo journey rather than all being pre-seeded. Include active, expired, below-threshold, incompatible/unknown, and unassigned offer cases. Merchant brands from the discussion are scenario labels; no production offer claims.

**C fixtures:** controlled store pages for two merchants; golden cart; payment success/decline/processing outcomes; settlement, qualification, posting, reversal, and duplicate events; a zero-savings reset state. Fixture event IDs must be stable so replay idempotency can be tested.

**Clock:** the default demonstration date is September 23, 2026, in `America/New_York`, with an explicit injected timestamp used by the tests. Tests must not fail later because an offer used the machine's real current date. Re-anchor the demo intentionally when presenting on a different date.

### 14.2 Presentation sequence

The demo should make the differentiated insight obvious before showing the broader commerce platform.

1. **The problem:** briefly show a fixture catalog with several active promotions and explain that a normal deal app could show all of them. Do not make this catalog the polished hero UI.
2. **Spend DNA reveal:** open the polished Spend DNA screen first. Let the personalized visual and simple merchant/category summaries communicate the user's pattern before showing raw transaction evidence. Correct one preference to demonstrate control.
3. **Deals find you:** return to the Apple Card-inspired For You screen. With no active mission, publish one new synthetic promotion. Show one clean hero opportunity appear with a short relevance reason and personalized notification.
4. **Show the filtering:** briefly show that another larger headline discount did not notify because it lacked sufficient relevance for this profile. This is the key differentiation.
5. **Explain why:** open the opportunity and show concrete reasons such as familiar category, merchant similarity, frequency/recency evidence, and eligible card offer.
6. **Research before buying:** from the surfaced opportunity, tap `Research this product`. Show a calm Research Brief with sourced strengths, tradeoffs, price/listing options, and evidence categories. Emphasize that a strong discount did not automatically equal a strong product recommendation.
7. **Broader product research:** ask “Find me the best noise-cancelling headphones for long flights under $350.” Show editable requirements, 3-5 canonical candidates, and a concise comparison. Save one product to the watchlist.
8. **Optional AI intent:** now ask for a black running jacket under $120. Show how an explicit mission sharpens recommendations rather than creating personalization from scratch.
9. **Decision:** compare the golden product/card plans. Explain charge now versus benefits later and the activation requirement.
10. **Extension:** open the controlled merchant cart in another tab, click the extension, and show the same quote. Activate the fixture offer and re-quote.
11. **Trust:** enter prepared checkout, review $104 charged today, and explicitly approve the no-money demo payment.
12. **Verification:** replay settlement, qualification, $20 credit posting, and $1.04 cash-reward posting separately. Show the annual total reach $47.04 only at the correct stage.
13. **Assistant:** ask “Why did you show me this deal?”, how much was spent at the merchant, and whether the credit arrived; show supporting profile, transaction, offer, and reward evidence.

A separate failure-path demonstration can change the cart after review to show that approval is rejected until the user reviews the new amount.


### 14.3 Product pitch

> Most finance apps know where you spend, deal apps know what is on sale, and shopping search tools can tell you what products exist. PerkPilot connects those worlds around the consumer. With permission, it learns a transparent Spend DNA and proactively surfaces the few opportunities that actually matter. Before you buy, you can ask PerkPilot to research the product, compare alternatives, and show the evidence behind the tradeoffs. If you choose to act, it then calculates the real deal stack, chooses among your existing cards, carries that intelligence into checkout, and verifies the benefits you actually received.

## 15. Scope cuts, risks, and unresolved external dependencies

### 15.1 Protect the differentiated core; cut breadth around it first

If scope becomes too large, **do not reduce the core loop to a hardcoded notification just to preserve every downstream feature**.

The minimum product story that must survive is:

`transaction history → Spend DNA → offer catalog → relevance ranking → proactive personalized opportunity → explain why`

After that works, preserve one thin Explore path (`Research this product` + one novel product research query), one thin action path through Deal Stack/card choice, and one thin verification path through the savings ledger.

Cut optional breadth in this order:

1. real bank linking, while keeping realistic normalized transaction fixtures;
2. real third-party offer ingestion, while keeping multiple structured offers;
3. real payment processing, while keeping explicit no-money checkout;
4. arbitrary-site extension support beyond controlled stores;
5. OS/email push beyond the persistent in-app notification;
6. advanced coupon permutations and loyalty points;
7. multiple currencies;
8. broad research coverage across many product categories, while preserving one well-supported category;
9. long-term price-history/release-cycle intelligence;
10. delivery/return automation;
11. visual breadth in secondary finance screens;
12. decorative motion or advanced material effects, while preserving the core spacing, hierarchy, typography, radii, and information design.

Do not cut Spend DNA evidence, offer relevance logic, history-based notifications, explainability, the shared calculator, accurate source labels, explicit approval, or ledger semantics merely to make the demo look broader.

### 15.2 Risk register

| Risk | Mitigation / owner |
|---|---|
| Offer access unavailable | Seed supported offers behind adapters; B verifies sponsor access before integration work |
| Product looks like a generic coupon app | Demo irrelevant-offer suppression, profile-specific ranking, and no-mission notifications first; A/B |
| Transaction history is overinterpreted | Restrict inference to merchant/category/cadence evidence; no item-level claims without receipts; A/B |
| Notification feed becomes spam | Relevance thresholds, explicit reasons, dismiss/mute feedback, cooldowns, and daily caps; B |
| Research hallucinates product facts | Every material fact/finding carries evidence references; AI synthesizes only retrieved/fixture evidence; B |
| Product search fills with duplicate merchant listings | Canonical Product separated from merchant ProductListing; B |
| Research becomes generic AI shopping search | Personalize requirement tradeoffs and connect research to proactive deal/card context without changing objective facts; B |
| Community anecdotes presented as facts | Preserve source type and phrase recurring community findings with appropriate uncertainty; B |
| Card linking mistaken for offer/payment authorization | Separate connection states and clear UI; A/B/C |
| AI hallucinates prices or terms | Grounded catalog/tools; schema validation; deterministic calculation; A/B |
| Browser scraping breaks | Two controlled adapters, manual fallback, stable demo store; C |
| Amount appears cheaper than the actual charge | Separate charge, pending credit, rewards, effective cost; B/C |
| Discounts or rewards counted twice | Versioned quotes, single calculator, idempotent append-only ledger; B/C |
| Team builds incompatible implementations | Contract freeze, single schema/client, fixture ports, owned paths; A coordinates |
| One person becomes a bottleneck | Domain-owned full-stack slices, early fixture clients, no provider integration on critical path |
| Private data exposed to model or page | Aggregate/minimize inputs, server-only secrets, narrow extension permissions; A/C |
| Demo depends on expired dates/network | Injected clock, local fixtures, honest fallbacks, protected reset/replay controls |
| UI drifts into generic fintech dashboard | Freeze section 4 tokens/components first; review Home and Spend DNA before parallel styling; A coordinates |
| Apple inspiration becomes a literal clone | Borrow hierarchy/material principles only; use PerkPilot branding, original layouts, original icons/assets, and no Apple logos/card art |

### 15.3 Defaults that do not block development

Working name, visual theme, exact LLM provider, real financial-data provider, and sponsor sandbox credentials remain replaceable. The baseline uses a provider-neutral AI interface and demo adapters. The team can start the contract/bootstrap phase without answering those questions.

The one external requirement to verify with organizers is whether an actual sponsor API call is mandatory for eligibility. The prompt provided here does not state that requirement. Do not assume either that it is mandatory or that mocks will satisfy an unstated rule.

---

## 16. Sources and verification notes

These official sources were checked on September 24, 2026 for integration constraints. Product requirements, priorities, interface choices, sample figures, and team assignments in this document are design proposals, not vendor claims. Source availability does not establish that this team has credentials or authorization.

- **[S1] Visa Intelligent Commerce - overview.** Agent-specific tokens, authenticated payment instructions, sandbox positioning, and product-development caveat.  
  <https://developer.visa.com/capabilities/visa-intelligent-commerce>
- **[S2] Visa Offers Platform - overview.** Consented/enrolled transaction qualification and statement-credit capabilities.  
  <https://developer.visa.com/capabilities/vop>
- **[S3] Visa Offers Platform - documentation access.** Public page identifies restricted documentation/access.  
  <https://developer.visa.com/capabilities/vop/docs>
- **[S4] Chrome Extensions - `activeTab`.** Temporary page access after the user invokes the extension.  
  <https://developer.chrome.com/docs/extensions/develop/concepts/activeTab>
- **[S5] Chrome Extensions - Side Panel API.** Side-panel behavior and user-interaction requirement for programmatic opening.  
  <https://developer.chrome.com/docs/extensions/reference/api/sidePanel>
- **[S6] Chrome Extensions - declare permissions.** Host permissions and optional permissions.  
  <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>
- **[S7] Chrome Extensions - service worker lifecycle.** Extension worker lifetime and persistence considerations.  
  <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>
- **[S8] Plaid - Transactions API.** Merchant/category fields, transaction updates, pending/posted records, and refresh behavior. Plaid is an illustrative future adapter, not a required dependency.  
  <https://plaid.com/docs/api/products/transactions/>
- **[S9] Apple Card - Apple.** Current product presentation and Wallet-based financial-health emphasis, including clear spending summaries and category-based views.  
  <https://www.apple.com/apple-card/>
- **[S10] Introducing Apple Card - Apple Newsroom.** Documents Apple Card's easy-to-understand transaction presentation and color-coded spending categories.  
  <https://www.apple.com/newsroom/2019/03/introducing-apple-card-a-new-kind-of-credit-card-created-by-apple/>
- **[S11] Apple Wallet - Apple.** Reference for card-centric organization and simplified Wallet presentation.  
  <https://www.apple.com/wallet/>
- **[S12] Apple Design - Apple Developer.** Entry point for current Human Interface Guidelines and Apple design resources.  
  <https://developer.apple.com/design/>
- **[S13] Liquid Glass - Apple Developer.** Current design-system principles: content focus, restrained color in controls/navigation, familiar iconography, adaptive layouts, and selective material effects.  
  <https://developer.apple.com/documentation/technologyoverviews/liquid-glass>
- **[S14] Branding - Apple Human Interface Guidelines.** Guidance to keep branding subordinate to content, use accent color judiciously, and preserve familiar interface behavior.  
  <https://developer.apple.com/design/human-interface-guidelines/branding>

---

## 17. New-developer onboarding checklist

Before changing the current implementation, understand the product hierarchy, not just the feature list.

The differentiated core is:

`consented transactions → Spend DNA → relevant offer matching → proactive notification`

The Explore layer is:

`opportunity or question → product search → sourced research → comparison/watch → selected product/listing`

The action layer is:

`selected opportunity/product/mission → Deal Stack → card choice → optional extension/checkout`

The verification layer is:

`purchase → qualification/posting evidence → trustworthy savings ledger → future relevance feedback`

Read section 4's UI system before implementing any user-facing surface. Then read `CONTRACTS.md` and the current repository modules. The original workstream packets were not attached. Check the repository's actual stack and implemented interfaces against this proposed baseline. Identify your owned paths, fixture dependencies, and test responsibilities. Agree shared-contract changes before changing consumers.

Before coding a downstream feature, verify that it consumes the shared profile, relevance, offer, or quote data rather than creating a parallel interpretation. Also verify that it uses the shared UI tokens/components rather than importing a generic dashboard style or creating local spacing/radius/color rules. A checkout feature should not invent personalization. A mission feature should not be required for “For You” offers. Product research must not assume that a discount means the product is good. A language model should not invent why an opportunity matched.

During implementation, make your own domain real first, using fixture ports for unavailable teammates/providers. Preserve source labels. Keep calculations, permissions, and eligibility outside the LLM. Prove your module works independently before switching to integrated services.

Before handoff, provide a run guide, changed-path summary, tests actually run, fixture/provider modes, public exports/endpoints, and any remaining limitations. Do not leave a decorative UI that depends on hardcoded financial answers or hardcoded “personalized” deals masquerading as the shared engines.

**Success is one coherent system:** financial context → Spend DNA → relevant deal discovered without a search → explainable notification → optional product research/comparison → selected product or shopping intent → verified calculation → card choice → explicit checkout → purchase/reward evidence → trustworthy savings → better future relevance.


---

## 18. Current implementation and behavior

### 18.1 Runtime status and truth labels

The current application is a **local, synthetic prototype**. `PERKPILOT_MODE=demo` is the default. It runs the real application logic against controlled data: transaction filtering, Spend DNA, offer ranking, alert evaluation, research, quotes, explicit simulated checkout, and event-ledger accounting. The user interface marks the sample experience and no-money payment as demo/synthetic. `PERKPILOT_MODE=live` fails closed: no fixture-backed API response is served and the UI reports that live providers are unavailable.

The three data claims must remain separate:

| Claim | Current status | Required label |
|---|---|---|
| Published card product name and base reward rule | Sourced from official issuer material, checked September 24, 2026 | Published base rule with issuer link and check date |
| Sample user owns a card, has transactions, receives a card-linked offer, or posts a reward | Synthetic fixture | Sample/synthetic |
| Signed-in user selects a card product they own | Self-reported, unverified | Self-reported; comparison only |
| Live account, issuer eligibility, merchant price, payment, or reward posting | No provider connected | Unavailable until verified |

### 18.2 Current repository map

| Path | Responsibility |
|---|---|
| `src/server.js` | Local HTTP server, API routes, ownership checks, demo/live boundary, extension pairing, checkout and event handlers |
| `src/auth.js` | Local account registration, password verification, session issuance/revocation and persistence |
| `src/state.js` | JSON demo-state repository, fixture seeding, atomic saves, preservation of registered profiles on sample reset |
| `src/fixtures.js` | Two sample users and controlled finance, merchant, product, offer, and transaction fixtures |
| `src/card-catalog.js` | Four named card products, published base rates, issuer source URLs, checked dates, and limitations |
| `src/domain.js` | Spend DNA, offer ranking, missions, quotes, benefit math, and savings summaries |
| `src/research.js`, `src/research-fixtures.js` | Search/brief/comparison/watch behavior and typed fictional research evidence |
| `src/ai.js` | Optional model-backed interpretation/explanation and deterministic fallbacks |
| `src/providers.js` | Live adapter interfaces and fail-closed readiness checks |
| `public/app.js`, `public/research-ui.js`, `public/style.css` | Responsive portal, auth/wallet, discovery, Explore, card/quote, and Apple-inspired visual system |
| `public/store.html`, `public/store.js` | Two controlled demo storefront flows |
| `extension/` | Chrome Manifest V3 side panel, controlled-cart read, pairing and quote handoff |
| `tests/` | Domain, research, auth, API, journey, and live-boundary tests |
| `data/state.json`, `data/auth.json` | Local mutable state and auth store; gitignored, owner-only file permissions |

The current implementation has no dependency installation step, production database, background queue, third-party data adapter, or real payment token.

### 18.3 Account creation and authentication

The portal no longer signs the visitor silently into a sample user. It shows a sign-in screen with **Create account**, **Sign in**, and an explicit **Explore Alex's sample profile** path. Registration accepts a name, email, and password of 12-128 characters. Email is normalized. The password is salted and hashed with Node `scrypt`; neither the password nor raw session token is stored in JSON. Session cookies are `HttpOnly`, `SameSite=Strict`, scoped to `/`, and last 12 hours; `Secure` is added when the request uses HTTPS. Session lookup survives a server restart; logout revokes the current token. Incorrect credentials use a generic error, and repeated failed attempts are throttled locally. Cross-origin mutation requests are rejected unless they match the local portal origin or the configured extension origin.

A registered user receives a separate profile with consent off, no transaction history, no accounts, and no cards. Sample profiles remain accessible only by an explicit demo action. The avatar opens account controls and sign-out; sample profiles can switch between Alex and Taylor. API reads and writes scope quotes, purchases, research objects, cards, and other user data to the authenticated user. A demo reset refreshes sample data while retaining registered profiles and their data.

This is **local demo identity**, not production account security. It lacks email verification, recovery, a production identity provider, transactional account/session storage, a deployed HTTPS boundary, a production CSRF strategy, audit monitoring, and abuse protection across multiple server processes. Local credentials do not prove ownership of financial accounts.

### 18.4 Specific card products and reward modeling

The earlier brief used generic fictional Visa A/B/C cards. The current product catalog uses these named products and **base purchase rates only**:

| Product | Modeled base rate | Explicitly excluded from the base estimate | Issuer source |
|---|---:|---|---|
| Discover it Cash Back | 1% | Activated 5% rotating categories and caps | [Discover rewards](https://www.discover.com/credit-cards/cash-back/cashback-bonus.html) |
| Wells Fargo Active Cash | 2% | Issuer exclusions and possible posting/rounding differences | [Wells Fargo terms](https://www.wellsfargo.com/credit-cards/active-cash/terms/) |
| Capital One Quicksilver | 1.5% | Travel/entertainment bonuses | [Capital One rewards](https://www.capitalone.com/learn-grow/money-management/ways-to-use-quicksilver-rewards/) |
| Chase Freedom Unlimited | 1.5% on other purchases | Dining, drugstore, and Chase Travel bonuses | [Chase rewards](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited) |

The local sample holdings use invented last-four digits. The synthetic $20 Alo benefit attached to the sample Discover card is **not a published Discover offer**. It remains a clearly labeled fixture used to test activation, eligibility, checkout math, and reward posting. The app does not assume bonus-category eligibility from merchant names. Reward estimates are not promises of issuer posting.

A registered user can add or remove one of these product definitions from Wallet as a self-reported card. That selection stores a product ID and known base rule; it collects no card number and creates no payment credential. Quotes can compare estimated base rewards for this selection, but checkout remains disabled because the card is not connected to a payment provider. Sample profiles retain the controlled test payment references required for no-money checkout. Wallet detail and quote calculation notes expose the issuer source and check date.

### 18.5 Product surfaces and behavior implemented

- **For You:** one prominent opportunity, a short ranked list, suppression diagnostics, feedback, and a demo publish control that reevaluates relevant offers even without a shopping mission.
- **Spend DNA:** merchant/category patterns derived from posted purchases with consent, explicit interests, corrections, muted categories/merchants, gift exclusion, and evidence references. Pending transactions, transfers, and card payments do not become spending evidence.
- **Explore:** editable intent, canonical products separated from merchant listings, typed source evidence, research briefs, requirement-relative comparisons, and watch alerts. The catalog and evidence are synthetic; the system does not perform live web shopping search.
- **Missions:** optional structured shopping intent, price basis, editable constraints, and relevant matches.
- **Wallet:** card product stack, base reward terms/source, honest sample or self-report label, supporting accounts, and recent activity. New registered accounts show empty states.
- **Deal Stack:** one deterministic quote service for portal and extension; separate charge today, possible later statement credit, estimated cash reward, and estimated effective cost. Unknown tax or shipping makes a provisional, unapprovable quote. Changed carts and stale quotes require a fresh review.
- **Chrome extension:** user-invoked Manifest V3 side panel on two controlled storefronts, narrow cart extraction, explicit pairing, short-lived token, stale cart/tab response handling, quote and research handoff. It does not read or fill payment fields.
- **Checkout and Saved:** explicit no-money approval, simulated authorization outcomes, separate settlement/qualification/credit/reward events, idempotent ledger entries, and reversal on return. Viewed/expected benefits never enter confirmed savings.
- **Assistant:** bounded tool-grounded spending, profile, offer, research, and reward answers. Optional provider explanations/mission extraction require a server-side `OPENAI_API_KEY`; no configured-key model call has been verified in this repository. Deterministic fallback is labeled.

### 18.6 Implemented API and persistence contracts

All current routes use `/api/v1`. Monetary values are integer USD cents and rates are basis points. Error envelopes use `{ "error": { "code", "message" } }`. The important groups are:

| Group | Routes and role |
|---|---|
| Authentication | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` |
| Bootstrap and profile | `GET /bootstrap`, `GET/PATCH /profile`, `GET/PATCH /preferences` |
| Finance and cards | `GET /finance/summary`, `/finance/transactions`, `/finance/cards`, `/finance/card-products`; `POST /finance/cards`; `DELETE /finance/cards/:id` |
| Discovery and missions | `GET /commerce/offers`, offer feedback/activation, mission create/update/matches, notification read/update |
| Research | Session create/update/candidates, product brief, comparison, watchlist, and controlled demo listing events |
| Decision and checkout | `POST /commerce/quotes`, `GET /commerce/quotes/:id`, checkout-session create/read/confirm |
| Verification | Purchase/read/summary endpoints plus demo event replay |
| Extension | Pairing create/approval/one-use exchange; 30-minute scoped bearer token |
| Demo controls | Explicit sample login, offer publish, price change, reward-event replay, sample reset |

`data/state.json` and `data/auth.json` are local files. Atomic file replacement and mode `0600` reduce accidental disclosure but do not provide transaction isolation, multi-process concurrency, backups, production recovery, or durable webhook guarantees. Moving to a transactional database is required before live finance/payment use.

### 18.7 Current golden quote, corrected for published card rates

The sample jacket has a $130 reference amount and a $104 already-discounted merchandise amount. Tax and shipping are explicitly $0 in this controlled scenario, so the charge today is **$104**. Before activation, sample Wells Fargo Active Cash at 2% yields an estimated $2.08 reward and **$101.92** effective cost. The sample Discover card yields $1.04 ordinary reward and $102.96 effective cost before its fictional assigned offer. When the sample $20 offer is activated and a fresh quote is created, the sample Discover plan becomes **$82.96** effective cost; the charge today remains **$104**. The merchant discount is not subtracted twice. After the no-money purchase is settled and benefits post, the ledger sequence is **$0 → $26 → $26 → $46 → $47.04**. These numbers are deterministic fixture checks, not a claim about a real cardholder or actual Alo/Discover offer.

## 19. Remaining work for a live-data demo

A live-data presentation has a separate acceptance gate. Do not switch the current synthetic portal to a “live” label until all required providers and evidence are present. The current `PERKPILOT_MODE=live` path intentionally returns unavailable/503 rather than mixing fixture data into a real account.

1. **Production identity and consent:** approved identity service, verified account ownership, recovery, HTTPS, production CSRF/session controls, explicit finance consent, and user-scoped audit records.
2. **Transactional storage:** users, consent, provider references, quotes, approvals, purchases, webhook events, ledger entries, and idempotency keys in a database that survives restart and duplicate delivery.
3. **Finance connection:** an approved provider for accounts, posted/pending transactions, card identity, sync state, and coverage. Do not treat a linked data card as a payment credential.
4. **Offer and issuer connection:** current structured merchant offers, user-specific card offer eligibility/assignment, activation support, terms, expiry, stacking, and observed source/version. Public card product terms alone do not establish a user's eligibility.
5. **Catalog and research providers:** permitted product/listing data and sources with observed price, stock, merchant, tax/shipping availability, citations, retrieval time, conflict handling, and freshness. Unknown values must remain unknown.
6. **Payment sandbox or approved merchant path:** current exact charge and currency, explicit approval, payment token separate from finance account data, idempotent provider attempt, changed-cart revalidation, and asynchronous status.
7. **Reward verification:** signed/stable provider events for qualification, credit posting, reward posting, refunds, and reversals. Recognize only posted benefits and make replay idempotent.
8. **Operational proof:** healthy provider probes, stale/outage UI, logging without sensitive payloads, automated restart recovery, isolated consenting test account, and a repeatable end-to-end rehearsal. `PERKPILOT_MODE=live npm run preflight` must pass for verified reasons, not by changing a flag.

The UI should preserve the calm hierarchy and explainability in section 4 while showing connection states and missing-data limits clearly. The scope does not include universal merchant coverage or automatic purchases on arbitrary sites.

## 20. Run, verify, and troubleshoot

### 20.1 Local runbook

Requirements: Node.js 20 or newer. There are no package dependencies to install. From the repository root:

```sh
npm run dev
```

The command starts the portal at `http://localhost:3000` and controlled storefront at `http://localhost:3001/store?product=alo-jacket`. Keep the terminal running while using the browser; this local development process is **not deployed as a persistent service**. Open the portal and either create a local account or explicitly choose Alex's sample profile. To reset only the synthetic sample experience, stop the server first and run `npm run demo:reset`; registered profiles are preserved. Avoid running a file reset while the server is active because it holds demo state in memory.

### 20.2 Verification commands

```sh
npm test
npm run build
npm run preflight
PERKPILOT_MODE=live npm run preflight
```

On September 25, 2026, `npm test` passed **23 of 23** tests when local loopback binding was permitted; `npm run build` passed syntax/static checks. The live preflight is expected to fail until provider access and production gates exist. `build`, `lint`, and `typecheck` currently use the same dependency-free static checker; they are not a production bundle, full linter, or TypeScript compilation.

### 20.3 Interpreting the errors seen during local run

| Symptom | Meaning | Action |
|---|---|---|
| Browser cannot load `localhost:3000`; curl says connection refused | The local server process is not running. This happened after the previous task's development process ended. | Run `npm run dev` in a terminal and leave it running; reload the page. |
| `listen EPERM: operation not permitted 127.0.0.1` during start or HTTP tests | The current execution sandbox denied loopback socket binding. The same tests passed when loopback permission was granted. | Run in a normal permitted terminal or grant loopback permission to the task; do not change application logic to hide this error. |
| `EADDRINUSE` on 3000/3001 | Another process already owns a port. | Reuse the running server or stop the old process before starting another. |
| `LOGIN_REQUIRED` from an API | The browser is signed out or its session expired. | Sign in, or explicitly enter a sample profile for synthetic QA. |
| `LIVE_PROVIDER_UNAVAILABLE` / live preflight nonzero | Live providers, production identity, and durable storage are not connected. | Complete section 19; do not relabel synthetic results as live. |
| No cards or transactions in a newly registered account | This is the correct empty state. Card product selection is self-reported only. | Use a sample profile for the complete controlled journey or connect approved providers for a live user. |

## 21. Implementation evidence and issuer sources

The consolidated status is grounded in the repository files named in section 18, `README.md`, `CONTRACTS.md`, `LIVE_INTEGRATION.md`, the `tests/` suite, and the September 25, 2026 local verification above. It should be revised when the implementation changes; proposed features in earlier sections are not evidence that a provider exists.

- **[S15] Discover it Cash Back rewards:** base 1%; activated rotating 5% categories and quarterly limits. <https://www.discover.com/credit-cards/cash-back/cashback-bonus.html>
- **[S16] Wells Fargo Active Cash terms:** two cents in cash rewards per $1 of qualifying net purchases, with issuer exclusions and rounding terms. <https://www.wellsfargo.com/credit-cards/active-cash/terms/>
- **[S17] Capital One Quicksilver rewards:** unlimited 1.5% base cash back on purchases; separate travel/entertainment benefits. <https://www.capitalone.com/learn-grow/money-management/ways-to-use-quicksilver-rewards/>
- **[S18] Chase Freedom Unlimited rewards:** 1.5% on other purchases and higher rates for listed categories. <https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited>

Issuer terms and availability may change. A card product catalog must show its last-checked date and eventually refresh against approved source data. It must never turn a public reward rule into a claim that an individual has an account, has activated a category, or will receive a credit.
