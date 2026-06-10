# Keyboard Layer in an MV3 ISOLATED-world Content Script on x.com — Research Notes

Scope: designing a keyboard shortcut layer (single keys, `g`-style sequences like `gg`, modifier
combos, a user-configurable keymap) that runs in an **ISOLATED-world** MV3 content script on
`x.com`. Must (a) correctly ignore keys while the user is typing (inputs, the compose box, search
box), (b) coexist with X's *native* shortcuts (`j`/`k`, `g h`, `.`, `/`, `n`, `l`, `r`, `t`, `?`,
etc.) without breaking them or fighting them, and (c) not trap focus / break accessibility.

Last researched: 2026-06-08. API facts are from official Chrome / MDN / WHATWG docs unless flagged
"community/observed" (medium/low confidence).

This codebase already ships a settings store (`src/core/settings.ts`) with a `hotkeySelectMode: "s"`
field persisted in `chrome.storage.sync`, and a reference vim extension lives at
`reference/twittervim/` — both are used as concrete anchors below.

---

## 0. The single most important fact (drives the whole design)

**An ISOLATED-world content script and the page share ONE DOM and therefore ONE event-dispatch
tree.** The "isolation" is *JavaScript-context* isolation (variables/functions), **not** event
isolation.

> "An isolated world is a private execution environment that isn't accessible to the page or other
> extensions." … "Not only does each extension run in its own isolated world, but content scripts
> and the web page do too. This means that none of these … can access the context and variables of
> the others."
> — Chrome, Content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

But the *DOM is shared*: "Although the execution environments of content scripts and the pages that
host them are isolated from each other, they share access to the page's DOM." (same page).

The WHATWG DOM spec confirms there is **no per-script/per-world distinction** in event dispatch —
all listeners on a node live in one list and run by phase + registration order:

> stopImmediatePropagation/stopPropagation set the node's stop-propagation flags; on dispatch, the
> implementation takes "a clone of event's currentTarget's event listener list" and invokes them in
> order. Capture-phase listeners run before target/bubble listeners across the tree.
> — WHATWG DOM, dispatch & stopImmediatePropagation:
>   https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation
>   https://dom.spec.whatwg.org/#concept-event-dispatch

Consequence, **confirmed and load-bearing**:

- A content-script `keydown` listener attached to `document` (or `window`) with `{ capture: true }`,
  registered while/just-after the page loads, participates in the **same** propagation as X's own
  React listeners. Trusted user keystrokes (`event.isTrusted === true`) reach it.
- Calling `event.stopImmediatePropagation()` (and optionally `preventDefault()`) from that
  capture-phase listener **can prevent X's own handlers from seeing the key** — *if* our listener
  runs before X's. Ordering is decided by **phase first, then registration order on that node**, not
  by which world registered the listener.

> ⚠️ A common web answer (and one of the search summaries collected for this note) claims an
> isolated content script "cannot intercept the page's own handlers." That is **wrong** for trusted
> DOM events on a shared node — it confuses JS-context isolation with event dispatch. Treat that
> claim as **false**; the WHATWG dispatch algorithm above is authoritative. (The genuinely-isolated
> case is *custom* `dispatchEvent` traffic used for cross-world messaging — see w3c/webextensions
> issue #241: https://github.com/w3c/webextensions/issues/241 — which is a different concern.)

### How to reliably win the ordering race

X is a React SPA; its key handlers are document/`body`-level **bubble-phase** delegated listeners
(community/observed, medium confidence — based on inspecting X and on how React attaches root
listeners). Two robust tactics, in order of preference:

1. **Use the capture phase on `document`/`window`.** Capture-phase listeners on an ancestor run
   *before* any bubble-phase listener anywhere below — guaranteed by the spec regardless of
   registration time. So a capture listener on `document` beats X's bubble listeners on `document`
   /`body` for free. This is the primary mechanism. (MDN: "Event listeners in the *capturing* phase
   are called before event listeners in the target and bubbling phases."
   https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
2. **Register early** (`document_start` / top of content script) so that *even if* both sides use
   the same phase on the same node, ours is first. Combine with (1) for belt-and-suspenders.

---

## 1. Where to attach, which phase, which event

- **Attach to `window` (or `document`) at the capture phase**, once, for `keydown`.
  - `keydown` (not `keypress`, which is deprecated; not `keyup`, which fires too late to suppress
    the page's default action). MDN keypress is deprecated:
    https://developer.mozilla.org/en-US/docs/Web/API/Element/keypress_event
  - Capture phase = `addEventListener('keydown', handler, { capture: true })`. MDN: capture means
    events "will be dispatched to the registered listener *before* being dispatched to any
    EventTarget beneath it in the DOM tree."
    https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- **Use an `AbortController` for teardown** (SPA route changes, HMR, disable toggle). MDN: "The
  listener will be removed when the `abort()` method of the AbortController … is called."
  https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
  This removes *all* listeners registered with that signal in one call — far cleaner than tracking
  `removeEventListener` pairs.
- **Do NOT use `passive: true`** for this listener: passive forbids `preventDefault()`. MDN: with
  `passive`, "If … the listener calls `preventDefault()`, nothing happens and a console warning may
  be generated." We *need* the option to preventDefault.
  https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

---

## 2. Reading the key correctly: `event.key` vs `event.code`, modifiers, IME

- **Use `event.key` for character/semantic shortcuts** (`"j"`, `"k"`, `"g"`, `"/"`, `"?"`,
  `"Escape"`). `key` is the layout- and modifier-aware *printable value*. MDN: with Shift on a US
  layout, `2` → `"@"`; `b` → `"B"`. https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
  - Vim-style nav (`j`/`k`/`gg`) is *character-semantic*, so `key` is right: a Dvorak/AZERTY user
    pressing the physical key that yields "j" gets `key === "j"`.
- **Use `event.code` only when you mean a *physical position*** (rare here; e.g. WASD-style). `code`
  is layout-independent (the physical key). https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
- **`event.keyCode` is deprecated** — do not use. (Listed deprecated on the KeyboardEvent page.)
  https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
- **IME guard — check `event.isComposing`.** While composing CJK/IME text, `keydown` fires with
  `isComposing === true` (between `compositionstart` and `compositionend`). MDN: `isComposing` is
  "true … after `compositionstart` and before `compositionend`."
  https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing
  Also bail on the legacy IME sentinel `event.keyCode === 229`. **Bail early if composing.**
- **Modifiers**: read `event.ctrlKey / metaKey / altKey / shiftKey`, or
  `event.getModifierState('Control')` for portability. Single-letter X shortcuts (`j`,`l`,`r`…)
  fire with **no** modifier; do not fire them when any non-Shift modifier is down (so we never clash
  with OS / browser combos like Cmd-L, Ctrl-T). The reference at
  `reference/twittervim/src/composables/useTwitterKeyboard.ts` gates every single-key action on
  `!hasModifier()` — good practice (but note its bug: it also blocks Shift, which would break a
  future `Shift+`-style binding; prefer gating on Ctrl/Meta/Alt only and treating Shift as part of
  the binding identity).

---

## 3. Correctly IGNORING keys while the user is typing

This is the #1 source of "my shortcut fired while I was typing a tweet" bugs. The compose box and
the inline reply box on x.com are **`contenteditable` rich-text editors** (DraftJS/Lexical-style,
`role="textbox"`), **not** `<textarea>`s; the search box is an `<input>` (community/observed,
medium confidence — verify with the live DOM, but the contenteditable composer has been X's design
for years). A naive `tagName === 'TEXTAREA'` check therefore **misses the compose box entirely.**

### Robust "is the user typing?" predicate

Check the **event target** (and/or `document.activeElement`), and crucially use
`closest('[contenteditable]')` / `isContentEditable` — because focus often lands on a *child* node
inside the editable region, and `getAttribute('contenteditable') === 'true'` on that child returns
nothing.

MDN: `HTMLElement.isContentEditable` "returns … `true` if the contents of the element are editable"
and **accounts for inheritance** — a focused node inside a `contenteditable="true"` region reports
`true`, whereas `getAttribute` on that child would miss it.
https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/isContentEditable

```ts
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = (e.composedPath?.()[0] as Element) ?? (e.target as Element) ?? document.activeElement;
  if (!el || !(el instanceof Element)) return false;

  // Native form fields.
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  // Rich-text editors: the compose box & inline reply (contenteditable, role=textbox).
  // closest() handles focus landing on a descendant text node/span.
  if (el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;

  // ARIA textbox / searchbox / combobox (X's search uses these).
  const role = el.closest('[role]')?.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;

  return false;
}
```

Notes:
- Use `e.composedPath()[0]` so it still resolves the real target if X ever puts the editor in a
  shadow root. MDN composedPath: https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath
- **Always allow `Escape`** through this guard if your layer wants to react to Escape, but in
  general: if `isEditableTarget()` is true, **return immediately and do not preventDefault** — let
  the keystroke reach the editor untouched.
- The reference's `isTyping()` (`useTwitterKeyboard.ts:31`) checks
  `activeElement?.getAttribute('contenteditable') === 'true'` — this is the brittle form; it
  misses descendant focus and `role="textbox"`. Our predicate above is the corrected version.

---

## 4. Coexisting with X's native shortcuts — when to preventDefault / stopPropagation, when NOT

### X's documented native shortcuts (so we know what we can collide with)

X officially supports a keyboard map; press **`?`** to open X's "Keyboard shortcuts" dialog. The
broadly-cited set (reputable third-party references, since the official help page is behind a
Cloudflare challenge — medium confidence on completeness, high confidence these exist):

Navigation / movement:
- `j` next post · `k` previous post · `Space` page down · `.` load new posts · `/` focus search ·
  `Enter` open post details · `?` show shortcuts dialog
- `g h` Home · `g e` Explore · `g n` Notifications · `g r` Mentions · `g p` Profile · `g l` Likes ·
  `g i` Lists · `g m` Messages · `g b` Bookmarks · `g s` Settings · `g u` go to user · `g d` display
  settings · `g k` Grok

Actions on the focused post:
- `n` new post · `l` like · `r` reply · `t` repost · `m` new DM · `b` bookmark · `u` mute · `x`
  block · `o` expand photo · `s` share · `Ctrl/Cmd+Enter` send post

Sources (third-party, reputable):
- WebNots: https://www.webnots.com/twitter-keyboard-shortcuts/
- ComputerHope: https://www.computerhope.com/shortcut/twitter.htm
- X's own 2013 announcement of keyboard nav (historical, the `g`-prefix model):
  https://blog.x.com/en_us/a/2013/action-and-navigation-all-from-the-keyboard
- Official help page (Cloudflare-gated, not fetchable here): https://help.x.com/en/using-x/keyboard-shortcuts

### Decision matrix

| Situation | preventDefault? | stopImmediatePropagation? | Rationale |
|---|---|---|---|
| Key is in **our** keymap and we handled it (e.g. our `gg`, our select-mode `s`) | **Yes** | **Yes** | Stop X from also acting on the same key (e.g. X's `s` = share). |
| Key is **not** ours (any key we don't bind) | No | No | Never touch keys we don't own — X's `j/k/g h/./?` must keep working. |
| User **is typing** (`isEditableTarget`) | No | No | Bail before any handling; let the editor have the key. |
| Key is a browser/OS combo (Ctrl/Meta/Alt + key) | No | No (unless it's *explicitly* one of our combos) | Never shadow Cmd-T, Cmd-L, Ctrl-W, etc. |
| `?` opens X's shortcut dialog | No | No | Don't shadow discoverability; if anything, *augment* it. |

Guidance:
- **`stopImmediatePropagation()` over `stopPropagation()`** when suppressing: `stopPropagation` only
  stops the *next node*; X may also have a listener on the **same** node (document/body). Only
  `stopImmediatePropagation` stops *remaining listeners on the current node too*. WHATWG DOM:
  stopImmediatePropagation sets both the stop-propagation and stop-immediate flags.
  https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation
- **`preventDefault()` suppresses the browser default** (typing the char, scrolling on Space), but
  **does NOT stop other JS listeners.** They are orthogonal. MDN preventDefault:
  https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault — so to truly own a key you
  often need *both*.
- **Default stance = least-surprise**: only `preventDefault`/`stop*` for keys you *actually
  consumed*. If a sequence is *pending* (you pressed `g`, waiting for the second key), see §5 for
  how to handle the partial-match suppress decision.
- **Avoid rebinding X's existing single keys unless intentional.** If your extension *wants* `l` to
  mean "add to List" instead of X's "like", that's a deliberate override — make it opt-in/config,
  and when active you must `stopImmediatePropagation` so X's like doesn't also fire.

### `isTrusted` filter (anti-spoof, optional)
If you only ever want to react to genuine user keystrokes (not page-synthesized events), gate on
`event.isTrusted`. MDN: `isTrusted` is "true when the event was generated by the user agent …
and false when the event was dispatched via `EventTarget.dispatchEvent()`."
https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted

---

## 5. Key SEQUENCES (`gg`, `g` then `h`) and the partial-match problem

X's own model is "`g` then a letter." A robust sequence engine needs:

- A **buffer** of recent keys + a **timeout** (X-like feel: ~700–1000 ms) after which the buffer
  resets. (Timeout window is a UX choice — community convention, e.g. vim's `timeoutlen` default
  1000 ms; medium confidence on the exact value, pick what feels right.)
- **Three-way classification of the buffer on each keydown**:
  1. *Exact match* → run action, `preventDefault` + `stopImmediatePropagation`, clear buffer.
  2. *Prefix of some binding* (e.g. just `g`, and `gg`/`gh` exist) → **buffer the key, start/refresh
     timer, and suppress** (so X doesn't act on the lone `g`). This is important: if `g` is also a
     prefix of *X's* shortcuts, you must decide whether to let X handle it. Safer approach:
     **only suppress `g` if your keymap actually has a `g…` binding**, otherwise let it pass to X.
  3. *No match and not a prefix* → clear buffer, do nothing (don't suppress).
- **Reset triggers**: timeout, blur, focus entering an editable, any modifier key, Escape, route
  change.

> Reference-repo caveat: `reference/twittervim/` uses `@vueuse/core`'s `useMagicKeys` and computes
> `g && h` (both keys *currently down*). That detects **chords** (held simultaneously), not vim
> *sequences* (pressed then released in order). It cannot distinguish `gg` (two sequential `g`s)
> from a single held `g`. For true `gg`/`g`-then-letter semantics, implement the explicit
> buffer+timeout machine below instead of `useMagicKeys`.

---

## 6. User-configurable keymap

- **Storage**: persist in `chrome.storage.sync` (already the pattern in `src/core/settings.ts`,
  which stores `hotkeySelectMode`). Extend `LassoSettings` with a `keymap: Record<string, string>`
  (binding-string → command-id) rather than scattering individual hotkey fields.
- **Canonical binding string**: normalize to a stable form, e.g. `"g g"`, `"shift+l"`, `"/"`. Build
  it from `event.key` lowercased + sorted modifier prefixes (`ctrl+`, `meta+`, `alt+`, `shift+`).
  Match against this — never against `keyCode`.
- **Two layers of dispatch**: (a) sequences/prefix-matcher, (b) single-key/chord table. Look up the
  normalized string in the user's keymap; if found and not typing, run + suppress.
- **Conflict policy**: ship a default keymap that *avoids* X's native single keys unless overriding
  is the point. Detect collisions at config time and warn (e.g. binding `l` shadows X's "like").
- **Live reload**: subscribe to settings changes (the store's `subscribe()` already exists) and
  rebuild the matcher in place — no need to re-add the DOM listener (it reads the current keymap).

---

## 7. Accessibility — don't trap focus, don't break AT

- **Never `preventDefault` Tab / Shift+Tab / arrow keys / Enter / Space inside controls.** Trapping
  Tab breaks keyboard navigation and screen-reader operation. Only intercept keys you own, only when
  not in an editable/interactive context.
- **Respect focus**: moving "focus" between tweets should use real DOM focus or `aria-activedescendant`
  semantics where possible, and the focused tweet should be scrolled into view but **focus must stay
  escapable** (Escape returns to normal). The reference uses an outline + `scrollIntoView` and an
  Escape-to-unfocus, which is reasonable, but it sets focus via inline `outline` styling only — for
  real a11y also call `element.focus()` on a focusable container or manage `tabindex="-1"` +
  `aria-selected`. (WAI-ARIA Authoring Practices, keyboard interaction / roving tabindex:
  https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- **Don't swallow `?`/`Escape`** that AT or X rely on. Leave X's shortcut help (`?`) working.
- **Honor "is the user typing"** (covered) — this is also an accessibility property: AT users type
  into the composer too.
- **Provide a visible, discoverable list** of your bindings (the reference's command palette is a
  good model) and make the layer **toggleable/disable-able** so it never permanently changes how the
  keyboard behaves.

---

## 8. Concrete keydown-dispatcher design (example)

A self-contained, capture-phase, ISOLATED-world dispatcher with sequence support, typing-guard,
modifier handling, configurable keymap, and AbortController teardown.

```ts
// content/keyboard.ts  — runs in the ISOLATED world content script.

type CommandId = string;
type Binding = string; // canonical: "g g", "shift+l", "/", "j"

interface KeyboardLayer {
  destroy(): void;
  setKeymap(map: Record<Binding, CommandId>): void;
}

const SEQUENCE_TIMEOUT_MS = 800;

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = (e.composedPath?.()[0] as Element) ?? (e.target as Element) ?? document.activeElement;
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const role = el.closest("[role]")?.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  return false;
}

/** Modifier prefix in a stable order; Shift is part of the binding identity, others gate it. */
function modPrefix(e: KeyboardEvent): string {
  let p = "";
  if (e.ctrlKey) p += "ctrl+";
  if (e.metaKey) p += "meta+";
  if (e.altKey) p += "alt+";
  if (e.shiftKey) p += "shift+";
  return p;
}

function canonicalKey(e: KeyboardEvent): string {
  // Use event.key (layout/modifier aware). Normalize single letters to lowercase.
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; // "Escape","Enter" stay as-is
  return modPrefix(e) + k;
}

export function installKeyboardLayer(
  runCommand: (id: CommandId) => void,
  initialKeymap: Record<Binding, CommandId>,
): KeyboardLayer {
  const controller = new AbortController();
  let keymap = initialKeymap;

  // Sequence state.
  let buffer: string[] = [];
  let timer: number | undefined;
  const resetBuffer = () => { buffer = []; if (timer) { clearTimeout(timer); timer = undefined; } };

  // Precompute the set of binding token-arrays for prefix tests.
  let bindings: string[][] = [];
  const rebuild = () => { bindings = Object.keys(keymap).map((b) => b.split(" ")); };
  rebuild();

  const isPrefix = (buf: string[]) =>
    bindings.some(
      (b) => b.length > buf.length && buf.every((t, i) => t === b[i]),
    );

  function onKeyDown(e: KeyboardEvent) {
    // 0. Ignore synthetic events / IME composition / typing contexts.
    if (!e.isTrusted) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (isEditableTarget(e)) return;

    // 1. Never shadow real browser/OS combos (Ctrl/Meta/Alt). Shift-only is allowed (it's a binding).
    const hardModifier = e.ctrlKey || e.metaKey || e.altKey;

    const token = canonicalKey(e);

    // 2. Build the candidate sequence: existing buffer + this token.
    const candidate = [...buffer, token];
    const candidateStr = candidate.join(" ");

    // 3a. Exact match -> run + fully suppress.
    if (Object.prototype.hasOwnProperty.call(keymap, candidateStr) && !hardModifier) {
      e.preventDefault();
      e.stopImmediatePropagation();
      resetBuffer();
      runCommand(keymap[candidateStr]);
      return;
    }

    // 3b. Partial prefix of one of OUR bindings -> buffer it and suppress (so X ignores the lone key).
    if (!hardModifier && isPrefix(candidate)) {
      buffer = candidate;
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(resetBuffer, SEQUENCE_TIMEOUT_MS);
      e.preventDefault();
      e.stopImmediatePropagation(); // we own this prefix; don't let X act on the lone 'g'
      return;
    }

    // 3c. Single binding hit with the buffer reset path (handles direct single-key like "j" if bound).
    if (!hardModifier && Object.prototype.hasOwnProperty.call(keymap, token)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      resetBuffer();
      runCommand(keymap[token]);
      return;
    }

    // 4. Not ours: clear any pending sequence and DO NOT suppress — let X handle j/k/./?/g h etc.
    resetBuffer();
  }

  // Reset sequence state on context changes (don't leave a dangling 'g').
  const onBlurOrRoute = () => resetBuffer();

  window.addEventListener("keydown", onKeyDown, { capture: true, signal: controller.signal });
  window.addEventListener("blur", onBlurOrRoute, { signal: controller.signal });
  // SPA route change: X uses history API; listen to popstate + a patched pushState event if needed.
  window.addEventListener("popstate", onBlurOrRoute, { signal: controller.signal });

  return {
    destroy: () => { resetBuffer(); controller.abort(); },
    setKeymap: (m) => { keymap = m; rebuild(); resetBuffer(); },
  };
}
```

Wiring (content entry), using the existing settings store:

```ts
import { createSettings } from "../core/settings";
import { installKeyboardLayer } from "./keyboard";

const settings = createSettings(); // chrome.storage.sync wrapper (src/core/settings.ts)

const COMMANDS = {
  "lasso:toggle-select": () => { /* ... */ },
  "lasso:add-to-list":   () => { /* ... */ },
} as const;

(async () => {
  const s = await settings.get();
  // Build keymap from settings (e.g. s.hotkeySelectMode -> "lasso:toggle-select"), plus a 'g g' demo.
  const layer = installKeyboardLayer(
    (id) => COMMANDS[id as keyof typeof COMMANDS]?.(),
    { [s.hotkeySelectMode]: "lasso:toggle-select", "g g": "lasso:scroll-top" },
  );
  // Live-reload keymap when settings change.
  settings.subscribe((next) =>
    layer.setKeymap({ [next.hotkeySelectMode]: "lasso:toggle-select", "g g": "lasso:scroll-top" }),
  );
})();
```

Design properties of the above:
- **Capture phase + `window`** → runs before X's bubble-phase delegated handlers (§0/§1).
- **`stopImmediatePropagation` only on keys we own** → coexistence: X's `j/k/g h/./?` untouched (§4).
- **Prefix buffering** gives real `gg`/`g`-then-letter sequences, not chords (§5).
- **`isEditableTarget` + `isComposing` + `isTrusted`** guards (§3, §2).
- **Hard-modifier guard** never shadows Cmd-T/Ctrl-W etc. (§2/§4).
- **AbortController** one-shot teardown for disable/HMR/route (§1).
- **No Tab/arrow trapping** — we only suppress keys present in the keymap (§7).

---

## 9. Pitfalls & gotchas checklist

- ❌ `tagName === 'TEXTAREA'` alone — **misses X's contenteditable compose box.** Use §3 predicate.
- ❌ `useMagicKeys`-style `g && h` chord detection — **cannot express `gg` sequences.** Use a buffer.
- ❌ `passive: true` on the listener — **breaks `preventDefault()`.**
- ❌ `stopPropagation()` (not immediate) when X has a same-node listener — **X still fires.**
- ❌ Suppressing keys you don't own — **breaks X's native shortcuts and a11y.**
- ❌ `event.keyCode` for matching — **deprecated, layout-fragile.** Use `event.key`.
- ❌ Forgetting IME guard — **shortcuts misfire mid-CJK composition.**
- ❌ Leaving a dangling sequence prefix on blur/route change — **stale `g` swallows the next key.**
- ⚠️ X is an SPA: re-attaching per route is unnecessary (window-level listener survives), but **reset
  the sequence buffer** on `popstate`/route change.
- ⚠️ The official X help page is Cloudflare-gated; the native shortcut list here is corroborated from
  multiple third-party references (medium confidence on exhaustiveness).

---

## 10. Confirmed context — the post "…" (caret) menu

From a live screenshot of a tweet's "…" caret menu, the dropdown contains these menu items, in this
exact visible order:

1. Not interested in this post
2. Follow @user
3. Add/remove from Lists
4. Mute
5. Block @user
6. Embed post
7. Report post
8. Request Community Note

Relevance to the keyboard layer: a shortcut such as "add focused post to a List" can be implemented
by programmatically opening this caret menu (`[data-testid="caret"]`) and clicking the **"Add/remove
from Lists"** item — i.e. the keyboard command maps to a DOM-driven menu action on the *focused*
tweet (mirroring how `reference/twittervim/` clicks `[data-testid="like"]` etc. on the focused
tweet). Match the item by its exact visible label text above.

---

## Sources

Official (high confidence):
- Chrome — Content scripts (isolated world, shared DOM, `world: MAIN|ISOLATED`): https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- WHATWG DOM — dispatch / stopImmediatePropagation / stopPropagation: https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation , https://dom.spec.whatwg.org/#concept-event-dispatch
- MDN — EventTarget.addEventListener (capture, signal, passive, once): https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- MDN — KeyboardEvent.key: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
- MDN — KeyboardEvent.code: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
- MDN — KeyboardEvent.isComposing: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing
- MDN — HTMLElement.isContentEditable: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/isContentEditable
- MDN — Event.isTrusted: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- MDN — Event.preventDefault: https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault
- MDN — Event.composedPath: https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath
- MDN — Element keypress event (deprecated): https://developer.mozilla.org/en-US/docs/Web/API/Element/keypress_event
- W3C WAI-ARIA APG — Keyboard interface practices (roving tabindex / no focus trap): https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- w3c/webextensions issue #241 (cross-world *custom* event messaging — not trusted DOM events): https://github.com/w3c/webextensions/issues/241

X shortcut references (official + third-party):
- X help (Cloudflare-gated, not fetchable here): https://help.x.com/en/using-x/keyboard-shortcuts
- X blog (2013) — Action and navigation from the keyboard: https://blog.x.com/en_us/a/2013/action-and-navigation-all-from-the-keyboard
- WebNots — Twitter keyboard shortcuts (medium confidence): https://www.webnots.com/twitter-keyboard-shortcuts/
- ComputerHope — Twitter shortcut keys (medium confidence): https://www.computerhope.com/shortcut/twitter.htm

In-repo precedent:
- `reference/twittervim/src/composables/useTwitterKeyboard.ts` (vim-style keyboard composable; chord-based, brittle typing check — see §3/§5 caveats)
- `reference/twittervim/USAGE.md` (its shortcut map + command palette model)
- `src/core/settings.ts` (existing `chrome.storage.sync` settings store with `hotkeySelectMode`)
