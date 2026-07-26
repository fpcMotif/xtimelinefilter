# Convex membership Mirror — design

**Status:** implemented; architecture review amended 2026-07-18 · **ADR:** [0009](../../adr/0009-convex-membership-mirror.md)

## Goal

Add a personal, cross-account **Mirror** of Twitter-List membership on top of the existing backend-free extension, giving three things a stateless extension can't: a durable **log** of every add/remove, **instant "already in"** marks that survive across devices, and **cross-account** visibility of which of your Lists (across your several X accounts) a person is in.

The Mirror is **additive and optional**: X stays the source of truth, the existing `XListApi` add/undo path is untouched, and with no device key configured the extension behaves exactly as before.

## Decisions (from grilling)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Convex's role | **Mirror + audit log.** X is source of truth; extension mutates X directly; every change is *also* written to Convex. Convex never drives X. |
| 2 | Owner identity | Checked before the X run and read again after it completes. A changed Owner stops the run or suppresses its Mirror write. No registry or polling. |
| 3 | Surface | Backing store **+ live-synced "already in"** powered by the snapshot. |
| 4 | Snapshot source | **Seed + reconcile from X**, done **per-author, lazily** (X's `memberships.json`), not full per-List rosters. |
| 5 | Cross-account | Picker shows **all Owners' Lists**; only the **active Owner**'s Lists are writable; foreign Lists are read-only with a "Switch to @owner" hint. UX = **account tabs + search** (prototype verdict below). |
| 6 | Off-session checks | Cached, shown **"as of last use"**; fresh reconcile only for the active Owner. |
| 7 | Log scope | **All outcomes**, including failures. Snapshots use direction-matched facts: add `added`/`already-member`; remove `removed`/`already-absent`. |
| 8 | Tenancy / auth | **Personal, single-tenant**, one **device key** in `chrome.storage.local`, validated by every Convex function. |
| 9 | Remove | **Mirror existing removals only** (undo path + any future remove). No new remove UI. |
| 10 | Git | New branch `claude/convex-mirror` off main; open PR, keep open. |
| 11 | Topology | Approach 1 — `MembershipStore` seam, Convex client in the content script (reactive WS survives; SW would be killed). |

## Domain terms

Captured in [CONTEXT.md](../../CONTEXT.md): **Owner**, **Mirror**, **MembershipStore**, **Membership snapshot**, **Audit event**, **Reconcile**, **Cross-account catalog**, **Device key**. "Account/Author" stays reserved for the *member*.

## Architecture (Approach 1)

```
                         x.com (source of truth)
                          ▲           │
              addMember / │           │ memberships.json / ownerships.json
              removeMember│           ▼
   ┌───────────────────── content script ──────────────────────┐
   │  controller ──assign/undo──► XListApi (unchanged)          │
   │      │                                                     │
   │      └─ after run ─► MembershipStore.recordAssign(owner,…) │
   │  picker ─► MembershipStore.observe                          │
   │  getCurrentAccount() ─► Owner (twid cookie)                │
   └───────────────────────────┬────────────────────────────────┘
                                │ reactive WS, deviceKey on every call
                                ▼
                      Convex Mirror (accounts/lists/members/events)
```

`MembershipStore` is a seam exactly like `XListApi`: `ConvexMembershipStore` (real) + `NullMembershipStore` (no-op when unconfigured), chosen by a factory, pinned by a shared contract test.

## Convex data model (`convex/schema.ts`)

- **accounts** `{ userId, screenName, label?, firstSeenAt, lastSeenAt, catalogGeneration?, catalogObservedAt?, catalogFactObservedAt?, profileObservedAt? }` — Owners. Missing legacy generation means `0`. Complete-catalog and direct-action clocks fence catalog races; the profile clock stops stale handle regressions. Index `by_userId`.
- **lists** `{ listId, name, ownerUserId, isPrivate?, memberCount?, lastReconciledAt?, catalogGeneration? }` — the cross-account catalog. Only rows stamped with their Owner's current generation are readable. Indexes `by_listId`, `by_owner`, `by_owner_generation`.
- **members** (snapshot) `{ listId, memberScreenName, memberUserId?, memberIdentity?, present, source: "x-seed" | "extension", observedAt?, addedAt, lastSeenAt }` — keyed by (List, stable member identity). Missing legacy `observedAt` means `0`. Older observations lose; at equal time, direct extension actions beat X seed reads. Numeric user ID wins; tweet ID is a conservative fallback. Legacy handle-keyed rows remain inert. Indexes include `by_list_member_identity` and `by_member_identity`.
- **events** (audit log) `{ listId, ownerUserId, memberScreenName, memberUserId?, memberIdentity?, action: "add" | "remove", outcome, message?, observedAt?, at }`. `observedAt` is X completion; `at` is Mirror receipt. Indexes `by_list`, `by_owner`, `by_at`.

## Convex functions

Every function takes `deviceKey`, validated first against env `LASSO_DEVICE_KEY`; mismatch throws.

- `recordAssign({ deviceKey, owner, ownerObservedAt, list, results })` *(mutation)* — append one event per result; each result carries its X completion time. A direction-matched fact (add: `added`/`already-member`; remove: `removed`/`already-absent`) newer than the complete catalog stamps List existence into the current Owner generation and fences older catalog answers. It never overwrites catalog metadata. Stable identities update causally fenced snapshots; missing identities and mismatches stay audit-only. Failed-only batches do not advance the catalog fact clock.
- `reconcileAuthor({ deviceKey, owner, ownerObservedAt, screenName, memberIdentity, observedAt, listIds })` *(mutation)* — write X's truth for one Account across only the current Owner catalog. `observedAt` is membership fetch start. Older rows and snapshots lose. Missing stable identity is a no-op.
- `replaceCatalog({ deviceKey, owner, ownerObservedAt, observedAt, lists })` *(mutation)* — replace the active Owner's catalog from a complete, terminal-pagination `ownerships.json` result. The millisecond fetch-start `observedAt` rejects older cross-tab answers and answers no newer than a proven direct List fact. Complete-catalog ties use last arrival; equal direct facts win. An accepted answer advances that Owner's catalog generation and stamps reported Lists; older Lists and snapshots become immediately unreadable but remain available if a List returns. Audit events stay append-only.
- Every write carries `ownerObservedAt`, captured with its Owner handle. Profile data never borrows a later action/fetch clock.
- `listsContaining({ deviceKey, memberIdentity })` *(query, reactive)* — current-generation `{ listId, ownerUserId, present, lastSeenAt }[]` → drives cached "already in" across Owners. The query enumerates authoritative current Lists, then performs one exact member lookup per List: `O(Owners + current Lists)`, independent of inert history. Generation `0` keeps the legacy fallback. `lastSeenAt` exposes source observation time, with receipt time only as a legacy fallback.
- `catalog({ deviceKey })` *(query, reactive)* — current-generation Lists grouped by Owner → the cross-account picker.

## Extension wiring

- `core/membership-store/{types,null,convex,live,factory}.ts` — seam, adapters, and the live settings-driven facade. Convex exists only when URL and device key are complete; otherwise the Null adapter preserves the X flow.
- `core/membership-store/convex-client.ts` — builds HTTP writes and reactive reads from `{ url, deviceKey }`, injecting the device key into every call.
- `core/settings.ts` — owns `convexUrl?`, `convexDeviceKey?`, and opaque `mirrorConfigId?`. Options gets a "Sync (Convex)" section with a test-connection affordance.
- `content/get-current-account.ts` — `getCurrentAccount(): Owner | null` from the `twid` cookie (+ best-effort screenName). **Live-verified on x.com 2026-06-13**: `twid` IS readable from `document.cookie` (not HttpOnly), raw `twid=u%3D<id>`; screenName from `a[data-testid="AppTabBar_Profile_Link"]` href `/<handle>`. Returns null when logged out so callers skip the Mirror rather than mis-attribute a record.
- `content/controller.ts` — each assign/remove result is timestamped immediately after its X attempt settles, then sent through `recordAssign`; in-flight assignment locks Escape and pointer selection until Stop/finally releases it. **Mirror failures are swallowed/logged** — never touch the toast/undo/selection.
- `core/picker-controller.ts` — `memberships` becomes Convex-backed `listsContaining` (instant, reactive); still fire X's `memberships.json` for the active Owner to reconcile. Queue catalog fetch first, membership second; persist the fresh catalog before optional enhancements settle. Add an **Owner dimension**: `owners` + `activeOwner` (from `getCurrentAccount`), a `selectedOwner` tab and a `scope` (`account | all`) driving `groups`, and per-row `writable = owner === activeOwner`. Catalog from `catalog()`; active Owner's Lists merged live from X.

## Prototype verdict (2026-06-13)

Three layouts were prototyped (Owner sections / account tabs / unified search). **Winner: account tabs + search (mix of B + C).**
- **Owner tabs** across the top (avatar + `@handle`, active highlighted, freshness inline: "active" / "as of 2d ago"). Account-first — the multi-account story reads at a glance.
- A **search** box with a scope: within the selected Owner, or **All accounts**. In "All accounts" scope, rows carry an Owner badge (C's treatment).
- Active Owner's rows are **writable** (Enter to add); a foreign Owner's view shows an amber **"Switch to @owner on X to add here"** banner and read-only rows.
- "Already in" ✓: **blue = live** (active Owner, fresh), **grey = cached** (foreign, "as of last use").
- Manifest — add `https://*.convex.cloud/*` to `host_permissions` + CSP `connect-src`.

## Tests (TDD order)

1. `MembershipStore` **shared contract test** (Null + a fake-backed Convex impl).
2. Convex functions via `convex-test`: generation replacement, stale-response rejection, per-member causal ordering and equal-time source priority, direct-action catalog fences, migration defaults, append-only audit, Owner isolation, reactive reads, and **wrong device key rejection**.
3. `getCurrentAccount` fixtures **+ a live check** against x.com.
4. **Controller invariance test**: a rejecting `ConvexMembershipStore` yields the *same* toast/undo/selection as `NullMembershipStore` — Mirror is never load-bearing.
5. Picker: snapshot drives "already in"; Owner grouping; foreign Lists disabled; "as of last use" cue.

## Verifiable goals

```
1. Branch + Convex project scaffolded     -> verify: `bunx convex dev` boots; schema typechecks; deviceKey env set
2. MembershipStore seam + Null + factory  -> verify: shared contract test green; no convexUrl ⇒ Null ⇒ existing suite unchanged
3. Convex schema + functions              -> verify: convex-test suite green incl. wrong-deviceKey rejection
4. getCurrentAccount                       -> verify: unit fixtures green AND live read returns the logged-in handle on x.com
5. recordAssign wired into controller      -> verify: controller-invariance test green (Mirror failure ⇒ identical UX)
6. Per-author reconcile + listsContaining  -> verify: opening picker on a known member shows blue check from Convex; matches memberships.json
7. Account-tab + search picker             -> verify: tabs per Owner; foreign view shows amber "switch to @owner" + read-only rows; active Owner writable; "All accounts" search shows Owner badges
8. Full quality gate                        -> verify: lint + typecheck + unit + e2e all green on the branch
```

Hand to **tdd** (steps 2–7 are red-green-refactor units) after a fast **prototype** of step 7's Owner-grouped picker to settle the UX.
