# Plan 900: Make "Clear Lasso data" wipe settings again

> **Provenance** — batch `review` · found by the 2026-07-17 adversarial review of plan [007](../improve/007-move-settings-to-storage-local.md), confirmed shipped at `6fafd6b`. The review flagged it before 007 landed; 007 landed anyway with the defect. Batch contract: [review/README.md](README.md). Root index: [plans/README.md](../README.md).

## Status

- **Priority**: P1
- **Effort**: S — one line of source, one test.
- **Risk**: LOW
- **Depends on**: none (007 is DONE; this repairs it)
- **Category**: bug (privacy claim vs code)
- **Planned at**: commit `6fafd6b`, 2026-07-17

## Why

Plan 007 moved settings from `chrome.storage.sync` to `chrome.storage.local` to make the product's privacy copy true. It updated the key's doc comment and the store's default area — but not the wipe. `clearLassoData` still removes the settings key from **sync**, the area settings no longer live in.

So the Options "Clear Lasso data" button leaves `backend` and `defaultListId` on disk, and the page's post-clear `settings.get().then(setCurrent)` re-renders the un-cleared values. Story beat 9 — "names the data it keeps and wipes all of it" — is false for the one key 007 touched. 007 fixed the copy and broke the wipe.

## Current state

`src/core/storage-keys.ts:18,21-26` — `settings` is documented as local but absent from `LOCAL_KEYS`:

```ts
const LOCAL_KEYS = [STORAGE_KEYS.lists, STORAGE_KEYS.listUsage, STORAGE_KEYS.coach];

/** Wipes everything Lasso keeps ("Clear Lasso data"). */
export async function clearLassoData(local: StorageLike, sync: StorageLike): Promise<void> {
  if (local.remove) await local.remove(LOCAL_KEYS);
  else await local.set(Object.fromEntries(LOCAL_KEYS.map((k) => [k, undefined])));
  if (sync.remove) await sync.remove(STORAGE_KEYS.settings);
  else await sync.set({ [STORAGE_KEYS.settings]: undefined });
}
```

The sync removal stays: it clears a pre-migration straggler. Only the local list is wrong.

No existing test catches this: `tests/options/OptionsApp.test.tsx:35` wires the **sync** fake as the store's primary area, so its "wipes all of it" assertion passes vacuously for settings.

**Check PR #3 first** (`add-tests-clearLassoData-…`, not draft): it adds tests to `tests/core/storage-keys.test.ts` — this plan's test file. If it merged first, either it pins the current (wrong) behaviour, in which case re-pin it here rather than deleting the test, or it already covers the local wipe, in which case only Step 2 remains.

## Scope

**In scope**: `src/core/storage-keys.ts`, `tests/core/storage-keys.test.ts` (or the file that owns `clearLassoData` coverage — grep first), `plans/review/README.md` (status row).

**Out of scope**: `src/core/settings.ts` (007's migration is correct); the sync removal (keep it); `src/options/OptionsApp.tsx` (it calls the helper correctly).

## Steps

### Step 1: Add the failing test first

Assert that a settings blob in **local** is gone after `clearLassoData`. Model it on the existing `clearLassoData` tests.

**Verify**: the new test FAILS (settings survive today).

### Step 2: Add settings to the local wipe

```ts
const LOCAL_KEYS = [
  STORAGE_KEYS.lists,
  STORAGE_KEYS.listUsage,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.coach,
];
```

**Verify**: the new test passes; the existing sync-removal test still passes.

### Step 3: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test; echo "gate=$?"` → `gate=0`.

## Done criteria

- [ ] Each step passes its own **Verify** line
- [ ] `grep -q "STORAGE_KEYS.settings" src/core/storage-keys.ts` matches inside `LOCAL_KEYS`
- [ ] A test asserts local settings are removed by `clearLassoData`
- [ ] `git status --short` lists only the in-scope files

## STOP conditions

- **`OptionsApp.test.tsx` breaks** — it wires the sync fake as the primary area. Report the coupling; do not rewire the options test from inside this plan.
- **`clearLassoData`'s signature has changed** (no longer takes both areas) — the premise moved; report before adapting.
