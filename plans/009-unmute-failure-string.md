# Plan 009: Report unmute failures with the right verb

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/core/strings.ts src/content/controller.ts tests/core/strings.test.ts tests/content/controller.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/005-token-scoped-toast-undo.md (same file `controller.ts`; land first to avoid a merge collision)
- **Category**: bug (misleading copy on a mutation path)
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

When undoing a mute fails, the danger toast says "Couldn't mute @jane" — the opposite of what was attempted. The user just clicked Undo on "Muted @jane"; the unmute request failed, so the true state is *still muted*, but the copy tells them a mute failed — implying they're unmuted. Failure copy in this codebase is deliberately literal ("failure copy is always literal — no charm at the moment of loss", `src/core/toast-store.ts:5`), and this is the one place it lies. After this plan, a failed unmute says so.

## Current state

- `src/content/controller.ts` — `unmuteAuthor`'s catch reuses the mute failure string.
- `src/core/strings.ts` — canonical strings; has `muteFailedLine` but no unmute-failure counterpart.
- `tests/core/strings.test.ts` — pins every canonical string verbatim.
- `tests/content/controller.test.ts` — controller tests; may assert the current toast title.

The wrong string, `src/content/controller.ts:235-242`:

```ts
  async function unmuteAuthor(author: TweetAuthor): Promise<void> {
    try {
      await quick.unmute(author.screenName);
      toasts.show({ kind: "info", title: unmutedLine(author.screenName) });
    } catch {
      toasts.show({
        kind: "danger",
        title: muteFailedLine(author.screenName),
      });
    }
  }
```

The neighbors it should mirror, `src/core/strings.ts:63-65` and :118-120:

```ts
// 11 — mute
export const mutedLine = (screenName: string): string => `Muted @${screenName}`;
export const muteFailedLine = (screenName: string): string => `Couldn't mute @${screenName}`;
```

```ts
export const unmutedLine = (screenName: string): string => `Unmuted @${screenName}`;
```

Convention (from `src/core/strings.ts:1-6`): every user-facing string lives in `core/strings.ts`, is pinned verbatim by `tests/core/strings.test.ts`, and no component invents its own wording. New strings follow the numbered-section comment style.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/core/strings.test.ts tests/content/controller.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/core/strings.ts`
- `src/content/controller.ts`
- `tests/core/strings.test.ts`
- `tests/content/controller.test.ts` (only if an existing test pins the wrong string on the unmute path — see Step 3)

**Out of scope** (do NOT touch, even though they look related):
- Any other toast copy — the audit found this to be the only wrong-verb failure line.
- `src/core/x-client/rest-api.ts` (`unmuteUser`) — the network call is correct; only the failure label is wrong.

## Git workflow

- Branch: `advisor/009-unmute-failure-string`
- One commit; message style e.g. `fix: say "Couldn't unmute" when the unmute undo fails`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Add the canonical string

In `src/core/strings.ts`, next to `unmutedLine` (:118), add:

```ts
export const unmuteFailedLine = (screenName: string): string => `Couldn't unmute @${screenName}`;
```

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Use it in the controller

In `src/content/controller.ts`, update the `unmuteAuthor` catch to use `unmuteFailedLine(author.screenName)`, and update the import block at the top of the file (it already imports `unmutedLine` and `muteFailedLine` from `@/core/strings` — add `unmuteFailedLine`, keeping the import list sorted the way the formatter leaves it).

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Pin the string and fix any stale assertion

1. In `tests/core/strings.test.ts`, add a pin next to the existing mute-string pins (model after them exactly):

```ts
expect(unmuteFailedLine("jane")).toBe("Couldn't unmute @jane");
```

2. Search `tests/content/controller.test.ts` for any assertion on the unmute failure path (`muteFailedLine`, "Couldn't mute", or an unmute-failure test). If a test pins the old (wrong) behavior on the unmute path, update that assertion to `unmuteFailedLine` and rename the test if its title says "mute failed" for the unmute case. Do not weaken or delete the test — re-pin it.

**Verify**: `bunx vitest run tests/core/strings.test.ts tests/content/controller.test.ts` → all pass.

### Step 4: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0.

## Test plan

- New pin in `tests/core/strings.test.ts` (Step 3).
- If the controller suite has no unmute-failure test, add one (model after the existing mute-failure test in `tests/content/controller.test.ts`): make `quick.unmute` reject, trigger the mute undo path, assert a danger toast titled "Couldn't unmute @jane".
- Verification: `bunx vitest run tests/core/strings.test.ts tests/content/controller.test.ts` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; the string pin exists and passes
- [ ] `grep -n "muteFailedLine" src/content/controller.ts` returns matches only on the *mute* failure path (inside `muteAuthor`'s catch)
- [ ] `grep -n "unmuteFailedLine" src/content/controller.ts src/core/strings.ts` returns at least 2 matches (definition + use)
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `unmuteAuthor` excerpt no longer matches (drift) — especially if plan 005 changed its shape; adapt only the string swap, not the undo wiring.
- The strings test file uses a different pinning convention than described (read it first; match the local pattern).
- You find a second place where failure copy names the wrong verb — report it; do not expand scope.

## Maintenance notes

- In PR review, verify the *pairing* discipline: every success line (`mutedLine`, `unmutedLine`, `blockedLine`, `removedLine`, `HIDDEN_LINE`) should have a literal failure counterpart naming the same verb; this plan closes the one gap found.
- If a future "unblock" flow lands, give it `unblockFailedLine` from day one.
