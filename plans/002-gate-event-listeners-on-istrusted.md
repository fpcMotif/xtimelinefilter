# Plan 002: Gate Lasso's input listeners on `Event.isTrusted`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/content/keyboard.ts src/content/main.tsx tests/content/keyboard.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (many existing tests dispatch untrusted events and must be repaired — mechanical, but numerous)
- **Depends on**: plans/001-flag-driver-synthetic-escape.md (land that first; this plan's test repairs assume the keyboard layer's flag check is unchanged)
- **Category**: security
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

Lasso's three page-facing input listeners — the capture-phase keyboard layer, the select-mode click capturer, and the `mousemove` hover tracker — execute commands on **any** dispatched event, trusted or not. Scripts running in the x.com page context (or another extension's MAIN-world script) can synthesize `keydown`/`mousemove`/`click` events and drive Lasso as a confused deputy: steer the hover target, then fire `Alt+m` (mute the author) or `Alt+Shift+l` (add them to the default List). The same gap means Lasso's *own* synthetic caret clicks (from its MAIN-world bridge) leak into its select-mode click listener and toggle that post's selection. The repo's own verification notes already recommended this gate ("MDN `Event.isTrusted` … is the right gate to ignore page-synthesized events", `verify-keyboard-layer-notes.md:148`). The exposure ceiling is bounded (account actions ride the user's own X session, which x.com's code already controls; Block is deliberately not key-bound), but the fix is one line per listener and closes both the spoofing vector and the self-interaction bug.

## Current state

- `src/content/keyboard.ts` — capture-phase keydown layer; no trust check.
- `src/content/main.tsx` — wires the DOM: mousemove tracker, select-mode click capturer, keyboard layer install.
- `tests/content/keyboard.test.ts` — dispatches synthetic (untrusted) `KeyboardEvent`s throughout; these tests will need a trust shim.

The ungated keyboard handler, `src/content/keyboard.ts:101-116`:

```ts
  const handler = (e: KeyboardEvent): void => {
    // Lasso's own driver synthesizes Escape to dismiss stuck X menus — that is
    // cleanup aimed at X, not user input for this layer.
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) return;
    // composedPath()[0] sees inside open shadow roots ...
    const target = e.composedPath?.()[0] ?? e.target;
    if (isTypingTarget(target)) return;
    const command = table.get(eventToCombo(e));
    if (!command) return;
    if (opts.run(command) === false) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
```

The ungated select-mode click capturer, `src/content/main.tsx:207-223`:

```ts
  document.addEventListener(
    "click",
    (e) => {
      if (!selection.selectMode.value) return;
      const origin = (e.composedPath?.()[0] ?? e.target) as Element | null;
      if (origin?.closest?.(`[${OVERLAY_FLAG}]`)) return; // the check handles itself
      if (origin?.closest?.("#lasso-root")) return; // clicks on Lasso UI pass through
      const article = origin?.closest?.(Selectors.TWEET);
      if (!article) return;
      const author = extractAuthor(article);
      if (!author) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      controller.toggleSelect(author);
    },
    { capture: true },
  );
```

The ungated mousemove tracker, `src/content/main.tsx:129-143`:

```ts
  document.addEventListener(
    "mousemove",
    (e) => {
      let t = (e.target as Element | null)?.closest?.(Selectors.TWEET) ?? null;
      while (t) {
        const outer = t.parentElement?.closest(Selectors.TWEET);
        if (!outer) break;
        t = outer;
      }
      visualHover.value = t;
      if (t) hoveredSticky = t;
    },
    { capture: true, passive: true },
  );
```

Why this is safe for real users: `isTrusted` is `[LegacyUnforgeable] readonly` and only `true` for UA-dispatched events. Real user input and Playwright's CDP-driven input are trusted; anything created with `new Event()`/`dispatchEvent()` from page JavaScript is not. The driver-internal synthetic Escape stays handled by the existing `SYNTHETIC_EVENT_FLAG` check (plan 001) — keep it; the two mechanisms are complementary (flag = intent marker, `isTrusted` = origin gate).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/content/keyboard.test.ts` | all pass |
| E2E       | `bun run build && bun run e2e`   | all pass (Playwright input is trusted — must stay green) |

## Scope

**In scope** (the only files you should modify):
- `src/content/keyboard.ts`
- `src/content/main.tsx`
- `tests/content/keyboard.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/content/main-world.ts` and `src/core/x-client/caret-actions.ts` — Lasso's synthetic-event *producers*; their events are aimed at X, and X's own acceptance of synthetic events is the product mechanism (unchanged).
- `src/core/x-client/dom-page-driver.ts` — covered by plan 001.
- Any change to `SYNTHETIC_EVENT_FLAG` semantics — keep it; it documents intent independent of trust.
- UI components under `src/ui/` — their events come from real user clicks inside the shadow root and are trusted.

## Git workflow

- Branch: `advisor/002-istrusted-gate`
- Commit per logical unit (gate + test repair may be one commit); message style e.g. `feat: ignore untrusted input events in keyboard/click/hover listeners`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Gate the keyboard layer

In `src/content/keyboard.ts`, add the trust check as the first line of `handler`, with a comment:

```ts
  const handler = (e: KeyboardEvent): void => {
    // Only UA-dispatched input is user intent — page scripts (and Lasso's own
    // synthetic drivers) must not steer selection, mute, or assign.
    if (!e.isTrusted) return;
    // Lasso's own driver synthesizes Escape to dismiss stuck X menus — that is
    // cleanup aimed at X, not user input for this layer.
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) return;
    // ... rest unchanged
```

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Gate the two listeners in `main.tsx`

In `src/content/main.tsx`:
- Add `if (!e.isTrusted) return;` as the first line of the `click` capture listener (currently at :209), with the comment `// Page-spoofed clicks must not toggle the selection.`
- Add `if (!e.isTrusted) return;` as the first line of the `mousemove` listener (currently at :131), with the comment `// Synthetic mousemoves must not steer the quick-action target.`

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Repair the keyboard-layer tests

After Step 1, every test in `tests/content/keyboard.test.ts` that dispatches a constructed `KeyboardEvent` into `document` and expects `run` to fire will fail, because constructed events are untrusted. Repair mechanically:

1. Add a helper at the top of the test file:

```ts
/** happy-dom/real-DOM dispatch makes constructed events untrusted; shadow the getter. */
function trusted<E extends Event>(e: E): E {
  Object.defineProperty(e, "isTrusted", { value: true });
  return e;
}
```

2. Wrap every `document.dispatchEvent(...)` / `input.dispatchEvent(...)` argument that is EXPECTED to trigger `run` in `trusted(...)`. Concretely, in these existing tests: "runs the bound command and prevents default", "uses the default document when none is passed", "fires Alt+n (not-interested) from a macOS dead-key event", "fires even when the dead-key keydown is flagged as composing", "runs bare x for selection", and "a run handler returning false leaves the event for X".
3. Leave the negative tests' events untrusted where the assertion is `run` not being called — but note: "ignores unbound keys" and "ignores keys while typing in an input" / "…inside an open shadow root" must use `trusted(...)` too, because their intent is "ignored *despite being real user input*"; with untrusted events they would pass for the wrong reason (trust gate, not the guard under test). Wrap them and keep the assertions unchanged.
4. The "falls back to event.target when composedPath is unavailable" test invokes the captured handler directly with a stub object — add `isTrusted: true` to that stub's properties.

**Verify**: `bunx vitest run tests/content/keyboard.test.ts` → all pass.

### Step 4: Add the regression tests

In `tests/content/keyboard.test.ts`, add to the `describe("installKeyboardLayer")` block:

```ts
it("ignores untrusted (page-synthesized) keydown events", () => {
  const run = vi.fn();
  dispose = installKeyboardLayer({ keymap, run, doc: document });
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "m", altKey: true, cancelable: true }),
  );
  expect(run).not.toHaveBeenCalled();
});
```

(This is the inverse of the first existing test — same event, no `trusted()` wrapper.)

**Verify**: `bunx vitest run tests/content/keyboard.test.ts` → all pass, including the new one.

### Step 5: Full gate + e2e

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0. Then `bun run build && bun run e2e` → all pass (Playwright's input is trusted; if e2e fails on input not reaching the page, STOP — see conditions).

## Test plan

- New test (Step 4): untrusted keydown is ignored. The trust-repair in Step 3 doubles as coverage that trusted events still flow.
- `src/content/main.tsx` has no unit tests (known gap, separate finding); the click/mousemove gates are covered by e2e (`e2e/content.spec.ts` exercises the built bundle with real CDP input) and by manual smoke.
- Model structure after the existing `installKeyboardLayer` tests in the same file.
- Verification: `bunx vitest run tests/content/keyboard.test.ts` → all pass, including 1 new test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; the new untrusted-event test exists and passes
- [ ] `grep -n "isTrusted" src/content/keyboard.ts src/content/main.tsx` returns exactly 3 listener gates (plus test-helper occurrences in the test file)
- [ ] `bun run build && bun run e2e` passes (real-input path unaffected)
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" no longer match the live files (drift).
- The e2e suite fails after the gates are added — that would mean CDP input is being read as untrusted, contradicting the core assumption; report, do not work around it.
- Tests outside `tests/content/keyboard.test.ts` break (nothing else should dispatch keydown through the keyboard layer; if `tests/content/controller.test.ts` or others do, report the coupling instead of editing them).
- `Object.defineProperty(e, "isTrusted", ...)` throws in the happy-dom environment (would invalidate the test strategy — report; do not switch to module mocking).

## Maintenance notes

- Any future input listener added in `src/content/` must apply the same `isTrusted` gate; consider this a repo convention from now on (worth one line in `docs/CONTEXT.md` invariants later, though doc edits are out of scope here).
- In PR review, scrutinize the negative tests that now use `trusted(...)`: they must still assert the guard under test (typing-target, unbound keys), not the trust gate.
- Deliberately deferred: gating the MAIN-world activate bridge message channel (`window.postMessage` cannot be `isTrusted`-gated; it needs a target allowlist — tracked as a separate hardening finding, not in this plan).
