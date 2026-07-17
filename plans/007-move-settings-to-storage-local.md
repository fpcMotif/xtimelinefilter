# Plan 007: Move settings to `chrome.storage.local` with a one-time sync→local migration

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/core/settings.ts src/core/storage-keys.ts tests/core/settings.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (with the migration; without it existing installs would silently reset — the migration is mandatory, not optional)
- **Depends on**: none
- **Category**: security (privacy claims-vs-code drift)
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

Settings persist to `chrome.storage.sync`, which Chrome replicates to the user's Google account — off-device. The synced blob includes `defaultListId`, an X-derived List identifier. Meanwhile the product's privacy surface makes flatly contradictory claims: the Settings page says "Your X session, your Lists, and your usage stats never leave this browser" (`PRIVACY_LINE`), the welcome/trust copy says "Nothing leaves x.com", the store listing says "Local-only", and ADR-0005 records "no off-device redistribution" as a policy invariant. The payload is small and contains no credentials, so the exposure is modest — but the product's central privacy promise is currently false, and users make trust decisions based on it. After this plan, settings live in `chrome.storage.local` like everything else Lasso stores, existing installs are migrated transparently, and the copy tells the truth.

## Current state

- `src/core/settings.ts` — typed settings store; defaults to `chrome.storage.sync`.
- `src/core/storage-keys.ts` — documents which area each key lives in; wipe-all helper.
- `src/core/strings.ts` — `PRIVACY_LINE` / `TRUST_LINE` (the claims being made true; no copy change needed once storage is local).
- `tests/core/settings.test.ts` — store tests via the global chrome mock.
- `tests/setup.ts` — provides in-memory `chrome.storage.local` and `chrome.storage.sync` mocks (reset per test).

The sync default, `src/core/settings.ts:43-46`:

```ts
/** Typed wrapper over chrome.storage.sync with in-context change notification. */
export function createSettings(
  area: StorageLike = chrome.storage.sync as unknown as StorageLike,
): SettingsStore {
```

The settings shape (`src/core/settings.ts:13-24`): `{ backend, defaultListId?, hotkeySelectMode, activation, highContrast }`, stored under key `"lasso:settings"` (:35).

The claims being made true, `src/core/strings.ts:139-140` and :77:

```ts
export const PRIVACY_LINE =
  "Lasso has no servers. Your X session, your Lists, and your usage stats never leave this browser.";
```

```ts
export const TRUST_LINE = "Lasso runs entirely in your browser. Nothing leaves x.com.";
```

`src/core/storage-keys.ts:12-13` documents the current (wrong) area: `/** chrome.storage.sync — user settings */ settings: "lasso:settings",`. The wipe helper `clearLassoData(local, sync)` (:21-26) already removes the settings key from sync — keep it (it cleans up post-migration stragglers).

Callers of `createSettings()`: `src/content/main.tsx:100,259`, `src/options/OptionsApp.tsx`, `src/popup/PopupApp.tsx` (find exact sites with grep). None pass an area in production — they all ride the default. Tests use `createSettings()` (riding the mock) and `createSettings(memoryArea())`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/core/settings.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/core/settings.ts`
- `src/core/storage-keys.ts`
- `tests/core/settings.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/core/strings.ts` — the copy becomes true once storage is local; no wording change in this plan.
- `src/options/OptionsApp.tsx` / `src/popup/PopupApp.tsx` / `src/content/main.tsx` — they call `createSettings()` with the default area; the default moving to local is the entire change they need. The migration runs inside the store, so every entry point migrates without edits.
- `tests/setup.ts` — the global mock already provides both areas; the migration test uses them directly.
- Removing `sync` from `clearLassoData` — keep it; wiping a stale synced copy is still correct.

## Git workflow

- Branch: `advisor/007-settings-storage-local`
- One commit; message style e.g. `fix: keep settings on-device (storage.local) with sync→local migration`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Change the default area and add the migration

In `src/core/settings.ts`:

1. Change the factory signature to accept the legacy sync area as a second (optional) parameter used only for migration, and default the primary area to local:

```ts
/**
 * Typed wrapper over chrome.storage.local with in-context change notification.
 * Settings used to live in storage.sync; Chrome Sync replicates that area to
 * the user's Google account, which contradicts the product's local-only privacy
 * claims (PRIVACY_LINE / ADR-0005 invariant 3) — so the store is local now and
 * any pre-migration synced copy is moved across once on first read.
 */
export function createSettings(
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
  legacySyncArea: StorageLike | null = chrome.storage.sync as unknown as StorageLike,
): SettingsStore {
```

2. Add a lazy one-time migration inside `get()` — on first read, if local has no settings but sync does, write the synced value to local and remove it from sync:

```ts
  let migrated = false;

  async function migrateOnce(): Promise<void> {
    if (migrated) return;
    migrated = true;
    if (!legacySyncArea) return;
    try {
      const localRaw = (await area.get(KEY))[KEY];
      if (localRaw !== undefined) return; // local already authoritative
      const synced = (await legacySyncArea.get(KEY))[KEY];
      if (synced === undefined) return;
      await area.set({ [KEY]: synced });
      await legacySyncArea.remove?.(KEY);
    } catch {
      // migration is best-effort; a failure must never break settings reads
    }
  }

  async function get(): Promise<LassoSettings> {
    await migrateOnce();
    const raw = (await area.get(KEY))[KEY] as Partial<LassoSettings> | undefined;
    return { ...DEFAULT_SETTINGS, ...raw };
  }
```

3. Update `set` to also run `await migrateOnce();` before its read-modify-write (so a first-`set` doesn't clobber a not-yet-migrated synced value).

Note: `migrated` is per-store-instance; each entry point (content/options/popup) creates its own store, so each migrates independently — idempotent by construction (local write wins, sync removal repeats harmlessly).

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Update the storage-keys documentation

In `src/core/storage-keys.ts`, change the settings comment (:12) to `/** chrome.storage.local — user settings (migrated off sync; see settings.ts) */`. Leave `clearLassoData` untouched.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Update and add tests

In `tests/core/settings.test.ts`:

1. Existing tests call `createSettings()` — they will now ride the mocked `local` area (the global mock in `tests/setup.ts` provides both areas and resets them per test). They should pass unchanged; the test title "returns defaults when nothing is stored (DOM backend)" has a stale parenthetical — you may fix the title to drop "(DOM backend)" since the default is REST; do not change assertions.
2. Add migration tests:

```ts
it("migrates a synced settings blob to local on first read, then removes it from sync", async () => {
  await chrome.storage.sync.set({ "lasso:settings": { backend: "graphql", defaultListId: "L1" } });
  const s = createSettings();
  expect((await s.get()).backend).toBe("graphql");
  expect((await chrome.storage.local.get("lasso:settings"))["lasso:settings"]).toMatchObject({
    backend: "graphql",
    defaultListId: "L1",
  });
  expect((await chrome.storage.sync.get("lasso:settings"))["lasso:settings"]).toBeUndefined();
});

it("prefers an existing local value over a stale synced one", async () => {
  await chrome.storage.local.set({ "lasso:settings": { backend: "dom" } });
  await chrome.storage.sync.set({ "lasso:settings": { backend: "graphql" } });
  const s = createSettings();
  expect((await s.get()).backend).toBe("dom");
});

it("a first set() does not lose a not-yet-migrated synced value", async () => {
  await chrome.storage.sync.set({ "lasso:settings": { defaultListId: "L9" } });
  const s = createSettings();
  await s.set({ backend: "graphql" });
  expect((await s.get()).defaultListId).toBe("L9");
});
```

(If the mocked `chrome` global isn't directly addressable in this test file, use the areas via two explicit `StorageLike` fakes passed as `createSettings(localFake, syncFake)` — check what the file and `tests/setup.ts` expose and pick the cleaner path; assertions stay the same.)

**Verify**: `bunx vitest run tests/core/settings.test.ts` → all pass, including 3 new tests.

### Step 4: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0.

## Test plan

- New tests: migration moves the blob and deletes the synced copy; local wins over sync; first `set()` preserves a pending migration (Step 3).
- Existing tests must pass unchanged — they ride the same mock, just the other area.
- Model structure after the existing `createSettings` tests in the same file.
- Verification: `bunx vitest run tests/core/settings.test.ts` → all pass, including 3 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; the three migration tests exist and pass
- [ ] `grep -n "chrome.storage.sync" src/core/settings.ts` returns matches ONLY in the `legacySyncArea` default and doc comment (no primary-area usage)
- [ ] `grep -rn "chrome.storage.sync" src/content src/options src/popup` returns no NEW call sites (existing count: 0 outside `settings.ts`)
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `createSettings` excerpt no longer matches (drift), or production callers pass an explicit area (grep says none do at planning time).
- The global chrome mock in `tests/setup.ts` has changed shape (no `sync` area) — the migration tests depend on it.
- Any existing test asserts that settings land in `sync` (would mean the old behavior was deliberately pinned — report before re-pinning).
- You find other modules reading `chrome.storage.sync` directly, bypassing `createSettings` — report them; do not expand scope.

## Maintenance notes

- One release after this ships, the migration path is dead weight for new installs but must stay for upgraders; remove only when the support window says every install has run the new version once.
- In PR review, scrutinize: migration is idempotent and best-effort (never throws into `get`); `set` migrates first; no code path writes to sync anymore except deletion.
- The privacy copy now tells the truth for settings; the remaining sync-adjacent surface is Chrome's own extension-state bookkeeping, which no code controls.
- If multi-device settings sync is ever wanted as a FEATURE, it must come with copy that names Chrome Sync explicitly — do not silently reintroduce the sync area.
