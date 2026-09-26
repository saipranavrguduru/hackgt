# PerkPilot implementation plan

> **For agentic workers:** Use the executing-plans workflow with independent implementation tasks delegated and a final integration review.

**Goal:** Build the local synthetic application described in PERKPILOT.md, with a working discovery-to-verification journey.

**Architecture:** Dependency-free Node HTTP servers share a deterministic domain layer, user-scoped JSON persistence, and local authentication. A responsive JavaScript portal and narrowly scoped MV3 extension consume the same quote API. Sections 18–20 resolve conflicts with earlier proposed architecture.

**Tech stack:** Node.js 20+, ES modules, HTML/CSS, built-in Node test runner.

**Spec:** [PERKPILOT.md](../../../PERKPILOT.md), supplied by the user with an instruction to implement.

## Constraints

- Synthetic demo only. Live mode fails closed. No external purchases or financial connections.
- Integer USD cents and integer basis points; unknown tax/shipping cannot authorize checkout.
- Fixed injected September 23, 2026 demo clock; authentication and quote expiration use actual elapsed time.
- Explicit sample login; registered users start empty with consent disabled.
- No dependencies required to run; work in the supplied empty repository (no committed baseline for a worktree).
- Preserve PERKPILOT.md as the supplied requirements record; document actual validation separately.

## Tasks

- [x] Domain and research: `src/fixtures.js`, `card-catalog.js`, `domain.js`, `research*.js`. Test transaction filtering, profile differences, relevant alert without mission, mute/suppression, $104/$101.92/$82.96 quotes, ledger $0→$26→$26→$46→$47.04, duplicate/reversal events, canonical research and watch deduplication.
- [x] Local runtime: `src/auth.js`, `state.js`, `providers.js`, `ai.js`, `server.js`. Tests before implementation for password/session persistence, empty registration, ownership, origin validation, quote revalidation, idempotent checkout, extension one-use pairing and live 503.
- [x] Portal: `public/index.html`, `app.js`, `research-ui.js`, `style.css`. Implement explicit login, discovery, Spend DNA corrections, Explore, missions, wallet, quote and approval, Saved, assistant and notifications. Verify desktop/mobile core journey.
- [x] Extension/store: `extension/**`, `public/store.*`. Pair explicitly, extract only controlled cart, reject stale results, use shared quotes. Unit-test cart/stale response helpers and document Chrome installation.
- [x] Integration/runbook: package commands, static checks, preflight, reset, README, CONTRACTS and live integration notes. Run full tests, build, demo/live preflight, HTTP journey and browser checks. Review final security and financial boundaries.

## Interfaces

`createFixtures(now)` returns arrays keyed by users, transactions, accounts, cards, products, offers, notifications, missions, quotes, checkoutSessions, purchases, ledger, events, researchSessions, watches and comparisons. All domain calls receive `(state, userId, input)` and enforce ownership. Runtime saves after successful mutations. Browser receives a user-scoped bootstrap and common `{error:{code,message}}` errors under `/api/v1`.

## Review focus

- Repriced/expired carts must require a fresh explicit review, including from extension.
- Users cannot read or mutate another user's records; extension bearer scopes exclude unrelated finances.
- Duplicate approvals and event replay must not create additional purchases or savings.
- New accounts never inherit sample financial records; sample reset preserves registered data.
- Unknown values and provider failures must remain unavailable, not become zero or synthetic live success.

## Execution and verification record

Implemented in the provided repository. Independent review findings were resolved: quote-level purchase deduplication, extension identity scope, mission input validation, budget-basis-aware research, and cumulative transaction corrections. Controlled cart identities now invalidate checkout after merchant-side changes, and an explicit refresh fetches the latest amount for a new approval.

Verification on September 25, 2026: 52 domain/API/auth/research/extension/state tests passed with local sockets permitted; static build and demo preflight passed; live preflight failed for the required unavailable-provider reasons. Isolated Chromium smoke passed the discovery-to-$47.04 ledger journey, consecutive exclusions, research/compare/watch, five mobile routes, authoritative store quantity changes, and stale checkout recovery to a new $312 review.

The browser connector could not initialize (`node:process` import unavailable); the browser checks used installed Playwright with an isolated Chromium context and in-memory demo servers. Actual Chrome side-panel installation and configured-key OpenAI calls remain unverified. Live integrations are intentionally absent. No branch existed beyond an unborn main baseline; work remains in the requested workspace without an unsolicited merge, push, or deployment.
