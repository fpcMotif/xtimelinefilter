# Convex membership Mirror — design

**Status:** approved via grilling 2026-06-13 · **Branch:** `claude/convex-mirror` · **ADR:** [0009](../../adr/0009-convex-membership-mirror.md)

## Goal

Add a personal, cross-account **Mirror** of Twitter-List membership on top of the existing backend-free extension, giving three things a stateless extension can't: a durable **log** of every add/remove, **instant "already in"** marks that survive across devices, and **cross-account** visibility of which of your Lists (across your several X accounts) a person is in.

The Mirror is **additive and optional**: X stays the source of truth, the existing `XListApi` add/undo path is untouched, and with no device key configured the extension behaves exactly as before.

## Decisions (from grilling)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Convex's role | **Mirror + audit log.** X is source of truth; extension mutates X directly; every change is *also* written to Convex. Convex never drives X. |
| 2 | Owner identity | Captured **at action time** — the account logged into x.com right then. No registry, no polling. |
| 3 | Surface | Backing store **+ live-synced "already in"** powered by the snapshot. |
| 4 | Snapshot source | **Seed + reconcile from X**, done **per-author, lazily** (X's `memberships.json`), not full per-List rosters. |
| 5 | Cross-account | Picker shows **all Owners' Lists**; only the **active Owner**'s Lists are writable; foreign Lists are read-only with a "Switch to @owner" hint. UX = **account tabs + search** (prototype verdict below). |
| 6 | Off-session checks | Cached, shown **"as of last use"**; fresh reconcile only for the active Owner. |
| 7 | Log scope | **All outcomes**, including failures. Snapshot mutates only on a real membership change. |
| 8 | Tenancy / auth | **Personal, single-tenant**, one **device key** in `chrome.storage.sync`, validated by every Convex function. |
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
   │  picker ─► MembershipStore.listsContaining / allLists      │
   │  getCurrentAccount() ─► Owner (twid cookie)                │
   └───────────────────────────┬────────────────────────────────┘
                                │ reactive WS, deviceKey on every call
                                ▼
                      Convex Mirror (accounts/lists/members/events)
```

`MembershipStore` is a seam exactly like `XListApi`: `ConvexMembershipStore` (real) + `NullMembershipStore` (no-op when unconfigured), chosen by a factory, pinned by a shared contract test.

## Convex data model (`convex/schema.ts`)

- **accounts** `{ userId, screenName, label?, firstSeenAt, lastSeenAt }` — Owners. index `by_userId`.
- **lists** `{ listId, name, ownerUserId, isPrivate?, memberCount?, lastReconciledAt? }` — the cross-account catalog. index `by_listId`, `by_owner`.
- **members** (snapshot) `{ listId, memberScreenName, memberUserId?, present, source: "x-seed" | "extension", addedAt, lastSeenAt }` — keyed by (List, screenName). index `by_list`, `by_list_member`, `by_member` (screenName → lists, for "already in").
- **events** (audit log) `{ listId, ownerUserId, memberScreenName, memberUserId?, action: "add" | "remove", outcome, message?, at }`. index `by_list`, `by_owner`, `by_at`.

## Convex functions

Every function takes `deviceKey`, validated first against env `LASSO_DEVICE_KEY`; mismatch throws.

- `recordAssign({ deviceKey, owner, list, results })` *(mutation)* — upsert Owner + List; per result, append one event and (on `added`/`already-member`/successful remove) upsert the snapshot row. Maps `AssignResult[]` straight from the controller.
- `reconcileAuthor({ deviceKey, owner, screenName, listIds })` *(mutation)* — write X's truth for one Account: snapshot `present:true source:"x-seed"` for `listIds`, `present:false` for that Account's other rows under this Owner's Lists.
- `reconcileCatalog({ deviceKey, owner, lists })` *(mutation)* — mirror the active Owner's owned-List catalog (from `ownerships.json`) into `lists`; sets `lastReconciledAt`.
- `listsContaining({ deviceKey, screenName })` *(query, reactive)* — `{ listId, ownerUserId, present, lastSeenAt }[]` → drives "already in" across Owners.
- `catalog({ deviceKey })` *(query, reactive)* — all Lists grouped by Owner → the cross-account picker.

## Extension wiring

- `core/membership-store/{types,null,convex,factory}.ts` — seam + impls + factory (Convex if `convexUrl` + `convexDeviceKey` set, else Null; mirrors `x-client/factory`).
- `core/convex-client.ts` — builds the reactive `ConvexClient` from `{ url, deviceKey }`, injects `deviceKey` into every call.
- `core/settings.ts` — add `convexUrl?`, `convexDeviceKey?` to `LassoSettings`; Options gets a "Sync (Convex)" section with a test-connection affordance.
- `content/get-current-account.ts` — `getCurrentAccount(): Promise<Owner | null>` from the `twid` cookie (+ best-effort screenName). **Must be live-verified** (see ADR-0009 / verify-by-effect) — a wrong read mis-attributes every record.
- `content/controller.ts` — after `runAssign` resolves, `void membershipStore.recordAssign(owner, list, results)`; in `undoAdds`, record the removals. **Failures swallowed/logged** — never touch the toast/undo/selection.
- `core/picker-controller.ts` — `memberships` becomes Convex-backed `listsContaining` (instant, reactive); still fire X's `memberships.json` for the active Owner to reconcile. Add an **Owner dimension**: `owners` + `activeOwner` (from `getCurrentAccount`), a `selectedOwner` tab and a `scope` (`account | all`) driving `groups`, and per-row `writable = owner === activeOwner`. Catalog from `catalog()`; active Owner's Lists merged live from X.

## Prototype verdict (2026-06-13)

Three layouts were prototyped (Owner sections / account tabs / unified search). **Winner: account tabs + search (mix of B + C).**
- **Owner tabs** across the top (avatar + `@handle`, active highlighted, freshness inline: "active" / "as of 2d ago"). Account-first — the multi-account story reads at a glance.
- A **search** box with a scope: within the selected Owner, or **All accounts**. In "All accounts" scope, rows carry an Owner badge (C's treatment).
- Active Owner's rows are **writable** (Enter to add); a foreign Owner's view shows an amber **"Switch to @owner on X to add here"** banner and read-only rows.
- "Already in" ✓: **blue = live** (active Owner, fresh), **grey = cached** (foreign, "as of last use").
- Manifest — add `https://*.convex.cloud/*` to `host_permissions` + CSP `connect-src`.

## Tests (TDD order)

1. `MembershipStore` **shared contract test** (Null + a fake-backed Convex impl).
2. Convex functions via `convex-test`: recordAssign upserts + appends; reconcileAuthor mirrors truth incl. removals; listsContaining reactive correctness; **wrong device key rejected**.
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
