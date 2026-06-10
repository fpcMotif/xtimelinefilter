# PRD — Lasso (X List Assigner)

> Status: draft for review · 2026-06-07 · Owner: f · Companion docs: [blueprint](blueprint/2026-06-07-lasso-blueprint.md), [ADRs](adr/), [CONTEXT](CONTEXT.md), [research](research/README.md)

## 1. Summary
A Manifest V3 Chrome extension that lets a user, while browsing the x.com timeline / explore / search, select one or many tweets and assign their **authors** to one of the user's X **Lists** — without leaving the feed. Minimalist, extensible, swift. Built test-first in strict TypeScript.

## 2. Problem
Curating X Lists is tedious: adding accounts means leaving the timeline, opening each profile, and clicking through a buried menu. There is no bulk path. Power users who discover good accounts while scrolling have no fast way to file them into a List.

## 3. Users
- **Primary:** the author (f) — a power user curating topical Lists from the live feed.
- **Secondary:** anyone who maintains X Lists and wants fast, bulk, keyboard-friendly curation.

## 4. Goals / Non-goals
**Goals**
- Select one tweet (quick action) or many (multi-select) from the live feed.
- Assign selected authors to an existing List via a swift, keyboard-friendly picker.
- Minimalist UI that respects x.com's visual language and never blocks the feed.
- Extensible by construction (pluggable backends + actions).
- Respect X's official policy (assistive, human-paced, user's-own-data — see ADR-0005).

**Non-goals (v1):** creating Lists inline; saving tweets to Bookmarks/Collections; Firefox/Edge packaging; any autonomous/background action; the paid X API v2 path (reserved as a future backend).

## 5. User stories
1. As a curator, I hover a tweet and click **+List** to add its author to a List in one action.
2. As a curator, I press a hotkey to enter **select mode**, check several tweets, and assign all their authors to one List at once.
3. As a curator, I pick the target List from a **fuzzy, keyboard-first** picker showing my Lists.
4. As a curator, I see a **summary toast** ("Added 3 · 1 already in list · 1 failed") and trust nothing happened silently.
5. As a privacy/policy-conscious user, I keep the **safe DOM backend** by default and can opt into the faster GraphQL backend with a clear disclosure.

## 6. Functional requirements
- **FR1 Detect tweets** in the virtualized timeline (MutationObserver + dedupe), skipping promoted tweets.
- **FR2 Extract author** `{screenName, displayName, tweetId, avatarUrl}` per tweet; `userId` resolved lazily.
- **FR3 Select** one or many authors; reactive count; clear/toggle; select-mode toggle.
- **FR4 List picker** lists the user's Lists (cached), fuzzy-searchable, keyboard-navigable.
- **FR5 Assign** selected authors to the chosen List via the active backend; per-item `AssignResult`.
- **FR6 Two backends** behind `XListApi`: DOM (default) + GraphQL (opt-in); selectable in settings; shared contract test.
- **FR7 Result feedback** summary toast; never silent; loud failures.
- **FR8 Policy enforcement** human-paced, stop-on-rate-limit, idempotent already-member, explicit-gesture-only.
- **FR9 Settings** backend strategy, default list, hotkeys, UI prefs in `chrome.storage.sync`.

## 7. UX flows
- **Quick (single):** hover tweet → `+List` → picker → pick → toast.
- **Bulk (multi):** hotkey → select mode → check tweets → ActionBar "N selected · Add to list" → picker → pick → toast.
- **Keyboard:** in the picker, type to filter, ↑/↓ to move, Enter to confirm, Esc to cancel.

## 8. Success metrics
- Time to add an author to a List from the feed < 3s (quick path).
- Bulk-assign 10 authors in one gesture with a correct per-item summary.
- Zero style bleed / no interference with normal x.com use.
- Test suite green; core logic covered by unit tests; both backends pass the contract test.

## 9. Milestones (vertical slices)
1. Scaffold + green sample test ✅ (selection-store done)
2. Core logic TDD: types + GraphQL backend → auth → extractor → list-cache → assign-to-list
3. DOM backend + page-driver + contract test
4. Shadow-DOM Preact UI + content wiring
5. Load-unpacked smoke verification on x.com; settings
6. Playwright E2E; polish; package

## 10. Risks (see blueprint §0, §8 and ADRs)
GraphQL id/bearer/transaction-id drift; x.com DOM churn (dialog internals); ToS exposure of internal endpoints; rate limits on bulk; crxjs 2.0-beta build viability (fallback WXT); happy-dom has no layout engine (geometry only testable in E2E).

## 11. Open questions (need decision / live check)
1. Retweets → original author (assumed) or retweeter?
2. UI injection → always-on static vs `activeTab` + dynamic (permission/UX tradeoff)?
3. Live DOM facts: Lists-dialog container/row testids, `aria-checked`, commit-on-click vs Save, web menuitem label.
4. Live GraphQL facts: current queryIds/features, bearer freshness, transaction-id enforcement on list mutations.
