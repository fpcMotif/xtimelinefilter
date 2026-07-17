# Plan 010: Make the selection-store merge keep newly-resolved fields

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/core/selection-store.ts tests/core/selection-store.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (latent — tested contract is false for the production data shape)
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

The selection store's merge is documented to "fill in fields we didn't know yet (e.g. a freshly resolved userId)" — but the implementation spreads the first-seen record over the new one wholesale, so an *explicitly-present* `undefined` in the first-seen record clobbers a newly-known value. This isn't theoretical: the tweet extractor always emits `userId: undefined` as an own property, so every production author carries the clobbering key. Today the bug is latent (REST assigns by `screen_name`; GraphQL resolves ids internally without re-adding to the store), but the moment any path re-adds an author with a resolved `userId` — the exact scenario the comment names — the merge silently discards it. The existing test passes only because its fixture omits the `userId` key entirely, a shape production never produces. After this plan, the merge does what the comment says, and the test exercises the real extractor shape.

## Current state

- `src/core/selection-store.ts` — the reactive selection store; contains the merge.
- `src/core/tweet-extractor.ts` — proof of the production shape (do not change).
- `tests/core/selection-store.test.ts` — the merge test with the non-production fixture.

The merge, `src/core/selection-store.ts:49-56`:

```ts
    add: (author) =>
      mutate((next) => {
        const key = keyOf(author.screenName);
        const prev = next.get(key);
        // Keep the first-seen identity (e.g. screenName casing); fill in fields
        // we didn't know yet (e.g. a freshly resolved userId).
        next.set(key, prev ? { ...author, ...prev } : author);
      }),
```

The production shape that defeats it, `src/core/tweet-extractor.ts:25-31`:

```ts
  return {
    screenName,
    tweetId: pl?.tweetId,
    displayName: readDisplayName(article, screenName),
    avatarUrl: readAvatar(article),
    userId: undefined,
  };
```

Note `userId: undefined` is an own property of every extracted author (and `tweetId` is often `undefined` too), so `{ ...author, ...prev }` copies `undefined` over a defined incoming value.

The test that never exercises it, `tests/core/selection-store.test.ts:25-31`:

```ts
  it("dedupes by screenName case-insensitively and merges newly-known userId", () => {
    const s = createSelectionStore();
    s.add({ screenName: "Alice" });
    s.add({ screenName: "alice", userId: "7", displayName: "Alice" });
    expect(s.count.value).toBe(1);
    expect(s.list()[0]).toMatchObject({ screenName: "Alice", userId: "7" });
  });
```

The first `add` carries no `userId` key at all — so nothing clobbers. Intended semantics to implement: first-seen *defined* values win (identity, casing); `undefined` entries in the first-seen record must not overwrite defined incoming values.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/core/selection-store.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/core/selection-store.ts`
- `tests/core/selection-store.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/core/tweet-extractor.ts` — emitting `userId: undefined` explicitly is a deliberate, documented shape ("Leaves userId undefined", extractor comment); the store must tolerate it, not the other way around.
- `toggle()` in the same file — it replaces rather than merges; correct as-is.
- Callers of `add()` (`src/content/controller.ts`, `src/content/app.tsx`) — semantics they rely on (first-seen identity wins) are preserved.

## Git workflow

- Branch: `advisor/010-selection-store-defined-merge`
- One commit; message style e.g. `fix: keep newly-resolved author fields when merging selections`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Add the failing regression test first

In `tests/core/selection-store.test.ts`, add a test using the extractor's real shape (explicit `undefined` own properties):

```ts
it("merges newly-known fields even when the first-seen record carries explicit undefineds (extractor shape)", () => {
  const s = createSelectionStore();
  // extractAuthor() always emits userId: undefined as an OWN property.
  s.add({ screenName: "Alice", tweetId: "123", userId: undefined });
  s.add({ screenName: "alice", userId: "7" });
  expect(s.count.value).toBe(1);
  expect(s.list()[0]).toMatchObject({ screenName: "Alice", tweetId: "123", userId: "7" });
});
```

**Verify**: `bunx vitest run tests/core/selection-store.test.ts` → the new test FAILS (incoming `userId: "7"` is clobbered today); existing tests pass.

### Step 2: Fix the merge to spread only defined first-seen entries

In `src/core/selection-store.ts`, replace the `add` implementation:

```ts
    add: (author) =>
      mutate((next) => {
        const key = keyOf(author.screenName);
        const prev = next.get(key);
        // Keep the first-seen DEFINED identity fields (e.g. screenName casing);
        // fill in fields we didn't know yet (e.g. a freshly resolved userId).
        // prev may carry explicit undefineds (the extractor always emits
        // userId: undefined) — those must not clobber newly-known values.
        if (!prev) {
          next.set(key, author);
          return;
        }
        const definedPrev = Object.fromEntries(
          Object.entries(prev).filter(([, v]) => v !== undefined),
        );
        next.set(key, { ...author, ...definedPrev });
      }),
```

**Verify**: `bunx vitest run tests/core/selection-store.test.ts` → all tests pass, including the new one. `bun run typecheck` → exit 0 (note: `Object.fromEntries` widens the type; if the compiler objects to assigning it back to `TweetAuthor`, spread it as shown — `{ ...author, ...definedPrev }` is still `TweetAuthor`-compatible because `author` provides the required `screenName`. If TS still complains, use `as TweetAuthor` — one pragmatic cast, matching the repo's existing DOM-narrowing cast style, is acceptable here.)

### Step 3: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0.

## Test plan

- New test (Step 1): extractor-shaped merge with explicit undefineds. Keep the existing merge test (:25-31) — it covers the no-own-key shape; together they pin both.
- Existing suite must pass unchanged — first-seen-wins semantics for defined values are preserved (`screenName` casing, `displayName`).
- Verification: `bunx vitest run tests/core/selection-store.test.ts` → all pass, including 1 new test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; the extractor-shape merge test exists and passes
- [ ] `grep -n "{ ...author, ...prev }" src/core/selection-store.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The merge excerpt no longer matches (drift).
- The extractor no longer emits explicit `undefined` fields (then the premise changed — the fix is still correct but the test's comment must be updated; report the drift).
- TypeScript rejects the merge in a way that seems to require changing the `TweetAuthor` interface — report instead of weakening the public type.

## Maintenance notes

- In PR review, confirm both merge tests survive: the no-own-key shape AND the explicit-undefined shape — they pin different failure modes.
- If `TweetAuthor` gains new optional fields, this merge handles them correctly by construction (defined-first-seen-wins); no further changes needed.
- Related latent gap (not in scope): the GraphQL backend resolves `userId` internally and never writes it back to the selection; if a future feature wants resolved ids cached on selected authors, this merge is now safe to receive them.
