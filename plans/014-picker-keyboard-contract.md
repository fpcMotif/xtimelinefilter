# 014 — Make the ListPicker's keyboard contract real: imperative focus + combobox ARIA

- **Status**: TODO
- **Commit**: 7ce587e
- **Severity**: HIGH
- **Category**: Accessibility (also Bugs & correctness — the current keyboard path is actively destructive)
- **Rule**: Beyond the scan (manual; WCAG 2.1.1, 2.4.3, 4.1.2). The scanner's `prefer-html-dialog` fired on this component but its canonical fix (swap to `<dialog>`) is deliberately NOT taken — see Boundaries.
- **Estimated scope**: 1 source file (`src/ui/ListPicker.tsx`) + tests

## Problem

**1. Focus never arrives.** The picker's entire keyboard model assumes the search input has focus, but focus is requested only via the `autofocus` attribute:

```tsx
// src/ui/ListPicker.tsx:88-97 — current
          <input
            type="text"
            aria-label={SEARCH_PLACEHOLDER}
            autofocus
            placeholder={SEARCH_PLACEHOLDER}
```

There is zero imperative `.focus()` anywhere in `src/` (grep-verified; the only other `autofocus` is the Retry button, ListPicker.tsx:221). Browsers only process the `autofocus` attribute during document load or for `<dialog>`/popover insertion — not for elements mounted later into a shadow root on a long-loaded page like x.com. So the picker paints, focus stays wherever it was on the page, and: ↑/↓ scroll the timeline, typed letters fall through to X's single-key shortcuts (**"l" likes the focused post**), Enter never commits, and the error state's advertised "R" retry key (whose handler is the button's own `onKeyDown`, ListPicker.tsx:223-232) is unreachable. For a keyboard-first product this is the primary control surface failing closed — and destructively.

**2. No AT contract.** The input has no `role="combobox"`, `aria-expanded`, `aria-controls`, or `aria-activedescendant`; `role="option"` rows (ListPicker.tsx:161-172) have no `id`. Arrowing changes only a visual highlight plus `aria-selected` on an unfocused node — a screen-reader user hears nothing change and Enter commits an invisible choice.

**3. Highlight can disagree with Enter.** The rendered highlight is positional and unclamped (`flatIndex === activeIndex`, ListPicker.tsx:138) while Enter uses the clamped `picker.active` computed (src/core/picker-controller.ts:86-88). After the silent background refresh swaps/shrinks the list (src/core/picker-controller.ts:112-120), no row may render highlighted while Enter still commits the clamped last row. Keying the highlight to `picker.active`'s list id makes what you see and what Enter does the same thing by construction.

## Target

```tsx
// src/ui/ListPicker.tsx — imports
import { useEffect, useRef } from "preact/hooks";
```

```tsx
// src/ui/ListPicker.tsx — inside ListPicker(), after the useSignalValue block (line 53)
  const active = useSignalValue(picker.active);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  // autofocus doesn't fire for late-mounted shadow-DOM nodes; focus imperatively.
  useEffect(() => {
    if (status === "ready") inputRef.current?.focus();
  }, [status]);

  // Keep the active option visible while arrowing.
  useEffect(() => {
    if (!active) return;
    listboxRef.current
      ?.querySelector(`[id="opt-${CSS.escape(active.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
```

```tsx
// src/ui/ListPicker.tsx — the input (replacing lines 88-97; class attribute unchanged)
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls="lasso-lists"
            aria-activedescendant={!noMatch && active ? `opt-${active.id}` : undefined}
            aria-label={SEARCH_PLACEHOLDER}
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onInput={(e) => picker.setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
```

(`autofocus` removed — focus is now single-sourced. ARIA ID references are legal here because input and options live in the SAME shadow root; IDs are scoped per shadow root, so the static `opt-`/`lasso-lists` ids cannot collide with x.com.)

```tsx
// src/ui/ListPicker.tsx — the listbox container (line 98)
          <div ref={listboxRef} id="lasso-lists" role="listbox" aria-label="Your Lists" class="min-h-0 flex-1 overflow-y-auto p-1">
```

```tsx
// src/ui/ListPicker.tsx — GroupedRows keyed by id, not position (replacing lines 113-148)
function GroupedRows({
  groups,
  activeId,
  alreadyIn,
  onPick,
}: {
  groups: ReturnType<PickerController["groups"]["peek"]>;
  activeId: string | null;
  alreadyIn: ReadonlySet<string>;
  onPick(list: XList): void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label ?? "all"}>
          {group.label && (
            <div class="text-muted px-3 pt-2 pb-1 text-[13px] font-semibold">{group.label}</div>
          )}
          {group.rows.map((list) => (
            <Row
              key={list.id}
              list={list}
              active={list.id === activeId}
              alreadyIn={alreadyIn.has(list.id)}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </>
  );
}
```

Call site (line 99): `<GroupedRows {...{ groups, alreadyIn, onPick }} activeId={active?.id ?? null} />`. The `flatIndex` counter is deleted.

```tsx
// src/ui/ListPicker.tsx — Row gains the id (line 162-165)
    <div
      id={`opt-${list.id}`}
      role="option"
      tabindex={-1}
      aria-selected={active}
```

```tsx
// src/ui/ListPicker.tsx — ErrorState focuses Retry (component starts line 200)
function ErrorState({ kind, onRetry, onCancel }: { … }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    retryRef.current?.focus();
  }, []);
  …
      <button
        ref={retryRef}
        type="button"
        onClick={onRetry}
```

(`autofocus` removed from the Retry button too. Its existing `onKeyDown` "r"/Escape handler, lines 223-232, is now actually reachable — keep it unchanged.)

## Repo conventions to follow

- Presentational subcomponents in the same file with typed inline prop objects — imitate `Row`/`ErrorState` as they are.
- Strings via `@/core/strings` constants — no new user-facing strings are needed here.
- Tests: testing-library/preact + vitest; imitate the existing picker tests (`tests/` — find the file exercising ListPicker or picker-controller and match its setup).

## Steps

1. Apply the exact edits above to `src/ui/ListPicker.tsx` (imports, refs + two effects, input attributes, listbox id/ref, GroupedRows `activeId` rewrite, Row `id`, ErrorState focus).
2. Tests (testing-library/preact, happy-dom):
   - render the ready state: the search input has focus (`document.activeElement` piercing the shadow root, or `toHaveFocus` on the rendered input) — this is the regression test for the dead `autofocus`;
   - `aria-activedescendant` matches the active row's `id` and updates after `picker.moveDown()`;
   - the highlighted row (`aria-selected="true"`) is the row whose id equals `picker.active.value.id` even when `activeIndex` exceeds the row count (simulate the background-refresh shrink by calling the controller's apply path or setting signals directly);
   - error state: Retry has focus on mount and pressing `r` calls `onRetry`.
3. Re-read the diff and remove unrelated churn.

## Boundaries

- Do NOT convert the picker to `<dialog>` despite the scanner's `prefer-html-dialog` suggestion: this is a non-modal, anchored, keyboard-driven palette; `showModal()` would trap focus and fight the fixed-position anchoring (src/content/app.tsx:137-156). Record the deviation in the PR description.
- Do NOT change `picker-controller.ts` — the silent-refresh race itself (generation-guarded list swap mid-navigation) is a separate deferred finding; this plan only makes the UI consistent with the clamped `active`.
- Do NOT change key bindings, strings, or the five designed states.
- Do NOT add dependencies.
- STOP if `src/ui/ListPicker.tsx` has drifted from commit 7ce587e; report the drift.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run format:check && bun run test` all exit 0. `npx react-doctor@latest --scope changed`: the `prefer-html-dialog` diagnostic on ListPicker.tsx:74 may legitimately remain (documented deviation); no NEW diagnostics; score not lower than baseline 62.
- **Behavior check** (the destructive-fallthrough scenario): on a long-loaded x.com page, select a post and open the picker with the keyboard (Alt+L). Without touching the mouse: type a letter — it must filter the list and MUST NOT trigger X's "like" shortcut; ↑/↓ must move the highlight, not scroll the timeline; Enter must add to the highlighted List. Kill the network, reopen the picker, press `r` — Retry must fire. With a screen reader (NVDA/VoiceOver), arrow through options and confirm each option is announced.
- **Done when**: all four tests pass, the live keyboard walk-through shows no fallthrough to x.com shortcuts, and required checks pass.
