# Plan 005: Bind each toast's Undo button to its own armed action

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/core/undo.ts src/content/controller.ts tests/core/undo.test.ts tests/content/controller.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes arm/trigger semantics that the `Z` key also uses; needs careful tests)
- **Depends on**: plans/003-single-flight-assign-runs.md (same file `controller.ts`; land first)
- **Category**: bug
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

The undo registry is a single global slot: arming a new undo silently replaces the previous one. But the Undo *buttons* on toasts all call the same bare `undo.trigger()` — so a toast's button executes whichever action was armed LAST, not the action the toast describes. Concrete harm: the user mutes @jane (toast A: "Muted @jane · Undo", visible 10 s), then completes an assign (toast B: "Added 3 to Design Folks · Undo"), then clicks Undo **on toast A** — the registry runs the assign-undo: three people are removed from the list while the user reads the outcome as an unmute. A wrong-account-state mutation under a false label. After this plan, each toast's Undo fires only the action its label describes; a superseded toast's button no-ops, and the `Z` key keeps targeting the latest armed action.

## Current state

- `src/core/undo.ts` — single-slot armed-undo registry.
- `src/content/controller.ts` — arms undo after assign runs and mutes; wires toast buttons to bare `trigger()`.
- `src/core/toast-store.ts` — `act(id, i)` dismisses the toast, then runs the action (no change needed).
- `tests/core/undo.test.ts` — registry tests with manual timers; pattern anchor.

The single slot, `src/core/undo.ts:20-41`:

```ts
export function createUndoRegistry(timers: ToastTimers = realTimers): UndoRegistry {
  let active: { run: () => void; timer: number } | null = null;

  function disarm(): void {
    if (active) timers.clearTimer(active.timer);
    active = null;
  }

  return {
    arm(run, windowMs) {
      disarm();
      active = { run, timer: timers.setTimer(disarm, windowMs) };
    },
    trigger() {
      if (!active) return false;
      const { run } = active;
      disarm();
      run();
      return true;
    },
    disarm,
  };
}
```

Both toast buttons call it untargeted — `src/content/controller.ts:165-172` (assign):

```ts
      if (kind === "undo") {
        return {
          label: UNDO,
          kbd: "Z",
          run: () => {
            undo.trigger();
          },
        };
      }
```

and `src/content/controller.ts:216-224` (mute), same shape. The current interface (`src/core/undo.ts:8-13`):

```ts
export interface UndoRegistry {
  arm(run: () => void, windowMs: number): void;
  /** Run + disarm the active undo; false if none is armed. */
  trigger(): boolean;
  disarm(): void;
}
```

Pinned behavior to preserve: "re-arming replaces the previous undo" (`tests/core/undo.test.ts:51-60`) — `Z` (bare `trigger()`) always hits the latest. The registry's `arm` sites are `controller.ts:159` (`undo.arm(() => void undoAdds(fb.undoable, list), UNDO_WINDOW_MS)`) and `controller.ts:211` (`undo.arm(() => void unmuteAuthor(author), UNDO_WINDOW_MS)`).

Conventions: timer injection via `ToastTimers` for deterministic tests (see `manualTimers()` in `tests/core/undo.test.ts:5-24`); controller tests use the `harness()` helper with no-op timers (`tests/content/controller.test.ts:51-80`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/core/undo.test.ts tests/content/controller.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/core/undo.ts`
- `src/content/controller.ts`
- `tests/core/undo.test.ts`
- `tests/content/controller.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/core/toast-store.ts` / `src/ui/Toast.tsx` — dismiss-then-run (`act`) already handles toast lifetime; the fix is entirely in registry targeting. A superseded toast's Undo no-opping *while the toast stays visible until its own dismiss* is acceptable and intended for this plan.
- Multiple concurrent armed undos (a true undo stack) — a product decision, not a bug fix. Do not implement.
- `src/core/actions/assign-to-list.ts`, quick-action backends — unchanged.

## Git workflow

- Branch: `advisor/005-token-scoped-undo`
- One commit; message style e.g. `fix: bind toast Undo buttons to their own armed action`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Extend the registry with tokens

Rewrite `src/core/undo.ts`'s interface and implementation:

```ts
export interface UndoRegistry {
  /** Arm an undo; returns a token identifying THIS armed action. */
  arm(run: () => void, windowMs: number): number;
  /**
   * Run + disarm the active undo; false if none is armed. With a token, runs
   * only if that exact action is still the armed one (a superseded toast's
   * button no-ops); without a token (the Z key), runs the latest.
   */
  trigger(token?: number): boolean;
  disarm(): void;
}
```

Implementation notes: keep the single-slot model; store `active: { run, timer, token }`; tokens are a monotonically increasing `let nextToken = 1`. `arm` still disarms the previous and returns the new token. `trigger()` with `token !== undefined && token !== active.token` returns `false` WITHOUT disarming or running. All other semantics (expiry disarms silently, trigger-once) unchanged.

**Verify**: `bun run typecheck` → exit 0 (expect the controller call sites to still compile — `arm`'s return value may simply be ignored by existing code until Step 3).

### Step 2: Update registry tests

In `tests/core/undo.test.ts`:
- Keep all four existing tests passing (bare `trigger()` semantics unchanged).
- Add:
  - `it("runs only the token-matching action when a token is given")` — arm first (token t1), arm second (token t2); `expect(reg.trigger(t1)).toBe(false)`; first not called; then `expect(reg.trigger(t2)).toBe(true)`; second called once.
  - `it("a stale token no-ops after the armed action already fired")` — arm, capture token, `trigger()` bare, then `trigger(token)` → `false`, run called exactly once in total.

**Verify**: `bunx vitest run tests/core/undo.test.ts` → all pass, including 2 new tests.

### Step 3: Capture tokens at the controller's toast buttons

In `src/content/controller.ts`:

- Assign flow (currently :158-176): capture the token where undo is armed and close over it in the toast action:

```ts
    let undoToken: number | undefined;
    if (fb.actions.includes("undo") && fb.undoable.length > 0) {
      undoToken = undo.arm(() => void undoAdds(fb.undoable, list), UNDO_WINDOW_MS);
    }
    const actions: ToastAction[] = fb.actions.map((kind) => {
      // ...
      if (kind === "undo") {
        return {
          label: UNDO,
          kbd: "Z",
          run: () => {
            undo.trigger(undoToken);
          },
        };
      }
```

- Mute flow (currently :208-225): same pattern — `const undoToken = undo.arm(() => void unmuteAuthor(author), UNDO_WINDOW_MS);` then `run: () => { undo.trigger(undoToken); }` in the toast action.

The `Z` key path (`command("undo")` → `undo.trigger()`, currently :288) stays tokenless — latest action, unchanged.

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Add the controller regression test

In `tests/content/controller.test.ts`, using the existing `harness()` and `FakeApi` (model after the mute/assign tests already there):

```ts
it("a superseded toast's Undo no-ops instead of firing the latest armed undo", async () => {
  const { controller, selection, backend, quick, toasts } = harness();
  await controller.muteAuthor({ screenName: "jane" }); // toast A: unmute armed
  const toastA = toasts.toasts.value.at(-1)!;

  selection.add({ screenName: "kay" });
  await controller.assignSelectedTo(LISTS[0]!); // toast B: assign-undo armed (supersedes)

  // Click Undo on toast A (the mute toast): must NOT remove kay from the list.
  const undoIndex = toastA.actions?.findIndex((a) => a.label === "Undo") ?? -1;
  expect(undoIndex).toBeGreaterThanOrEqual(0);
  toasts.act(toastA.id, undoIndex);

  expect(backend.removed).toEqual([]); // assign-undo did NOT fire
  expect(quick.unmute).not.toHaveBeenCalled(); // mute-undo no longer armed
});
```

Note: the harness toasts store uses no-op timers, so toasts never auto-dismiss — good. Adjust destructuring to the harness's actual return shape, and use the `UNDO` string import if the test file already imports from `@/core/strings` (match its existing imports; the literal `"Undo"` is the pinned string in `src/core/strings.ts:25`).

**Verify**: `bunx vitest run tests/content/controller.test.ts` → all pass, including the new test.

### Step 5: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0.

## Test plan

- Registry: token-match runs, stale-token no-op (Step 2), plus all four existing tests unchanged.
- Controller: the mislabel scenario end-to-end (Step 4) — mute toast's Undo after an assign must not un-assign.
- Model structure after `tests/core/undo.test.ts` (`manualTimers`) and the existing controller mute/assign tests.
- Verification: `bunx vitest run tests/core/undo.test.ts tests/content/controller.test.ts` → all pass, including 3 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; new token tests and the controller regression test exist and pass
- [ ] `grep -n "undo.trigger()" src/content/controller.ts` returns exactly 1 match (the tokenless `Z`-key path in `command("undo")`)
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts of `undo.ts` or the controller arm/trigger sites no longer match (drift) — especially if plan 003 changed surrounding lines; rebase understanding onto the merged file first.
- Any existing test in `tests/content/controller.test.ts` relies on a toast button firing a superseded undo (would mean the buggy behavior was pinned — report before changing the pin).
- The `UNDO` label string differs from `src/core/strings.ts:25` (the test locates the button by label).

## Maintenance notes

- The `Z` key intentionally keeps latest-action semantics; if the product later wants `Z` to show *what* it will undo, that UI change is separate.
- In PR review, scrutinize that `trigger(token)` on a stale token neither disarms the current action nor runs anything, and that token capture happens exactly where `arm` is called (no path where the toast button closes over `undefined` while an undo is armed — `trigger(undefined)` is the tokenless latest path by design; assert in review that `undoToken` is always set when the "undo" action kind is present).
- Deliberately deferred: an undo stack (multiple armed undos). The single-slot model remains; tokens only make toasts honest about it.
