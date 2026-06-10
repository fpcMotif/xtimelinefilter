# Vim-style Keyboard Navigation for Twitter/X — Prior Art Study

Research date: 2026-06-08. Goal: study existing Vim-style keyboard navigation tools for
Twitter/X (browser extensions + userscripts) and extract concrete patterns to copy /
avoid for (a) moving a focus cursor, (b) tracking + scrolling the focused tweet into view,
(c) dispatching actions on the focused tweet, and (d) not clobbering X's own shortcuts or
typing in inputs.

## TL;DR — the central design fork

There are two fundamentally different architectures, and the most important decision is
**which one you pick**:

1. **Reuse X's native `j`/`k` cursor** (X already has a focus cursor). Your extension does
   nothing to move focus — it lets X move the highlight, then *reads* which tweet X has
   selected and only adds *new* actions. This is what **`theimpostor/xkey`** does. Tiny,
   robust, never fights X.
2. **Implement your own cursor** — maintain `currentFocusedTweetIndex`, draw your own
   outline, scroll yourself. This is what **`CodyBontecou/twittervim`** does. More control
   (custom highlight, zen mode), but you now own focus-tracking, virtualization breakage,
   and conflicts with X's own `j`/`k`.

General-purpose Vim browser extensions (**Vimium**, **Surfingkeys**) do **neither** a tweet
cursor — they map `j`/`k` to *pixel scrolling* and use `f` link-hints for actions. They are
the wrong model to copy for a *tweet-cursor* tool, but their **input-detection** and
**key-suppression** code is the canonical reference for point (d).

---

## X's native keyboard shortcuts (what you must not clobber)

X ships its own keyboard navigation, discoverable in-app via the `?` shortcut dialog
("Keyboard shortcuts" — confirmed by `xkey`'s README, which says its keys "are also
documented in the built-in `?` keyboard shortcuts menu on x.com", and by the live caret-menu
screenshot context). The established native set (Confidence: high for the existence of a
native `j`/`k` cursor — it is the literal premise of `xkey`; medium on the exact full list
below, which is community-documented and has drifted over X's redesigns):

- Navigation cursor: **`j`** = next post, **`k`** = previous post. X moves a focus ring and
  sets `aria-activedescendant` / `:focus-within` on the selected `article`.
- **`Enter`** / **`.`** = open / refresh; **`l`** = like, **`r`** = reply, **`t`** = repost,
  **`b`** = bookmark, **`u`** = mute, **`m`** = direct message, **`n`** = new post.
- `g` then a letter = "go to" (e.g. `g h` home, `g p` profile, `g n` notifications,
  `g m` messages, `g l` likes, `g u` user, `g i` lists, `g b` bookmarks).
- `/` = search, `?` = this help dialog, `.` = load new posts then scroll to top.

Design consequence: a tweet-cursor extension that binds bare `j k l r t b m` is binding the
**exact same keys X already uses**. If you also implement your own cursor you get
double-movement / double-actions unless you suppress X's handler. `xkey` sidesteps this
entirely by reusing X's cursor and only claiming *unused* keys (`h`, `Shift+G`, `Shift+O`,
`Shift+S`).

The caret ("…") dropdown on a post contains (exact visible labels, in order, from the live
screenshot): **"Not interested in this post", "Follow @user", "Add/remove from Lists",
"Mute", "Block @user", "Embed post", "Report post", "Request Community Note".** A tool that
wants mute/block/"not interested" must open this menu and click the item by its text label
(there are no stable per-action `data-testid`s on these menu rows the way there are on the
like/reply/repost/bookmark action bar) — see "Dispatching menu actions" below.

---

## Tool 1 — `theimpostor/xkey` ("X Keyboard Extras") — REUSES native cursor  ⭐ cloned

- Repo: https://github.com/theimpostor/xkey · MV3, TypeScript, ~1191-line single content
  script (`src/content.ts`). Cloned to `/tmp/xkey` for study (not kept in `./reference/`
  because `twittervim` was the more complete cursor implementation to keep locally; see
  note at end).
- Premise (from README): *"On x.com, use the **built-in `j`/`k` keyboard navigation** to
  select a tweet, then use: `h` expand Show more, `Shift+G` Explain with Grok, `Shift+O`
  open sub-tweet, `Shift+S` screenshot."* It deliberately adds only keys X does not use.

### (a) Cursor — there is none; it reads X's
`xkey` never moves focus. It asks "which tweet has X selected right now?" via a four-stage
fallback (`findKeyboardSelectedTweet`, content.ts:807):

```ts
const TWEET_SELECTOR = 'article[data-testid="tweet"]';

function findKeyboardSelectedTweet(): Element | null {
  const activeElement = document.activeElement;
  if (activeElement instanceof Element) {
    // 1. X's real mechanism: a roving listbox uses aria-activedescendant
    const t = findActiveDescendantTweet(activeElement);          // getAttribute('aria-activedescendant') -> getElementById -> closest(article)
    if (t) return t;
    // 2. the active element is inside a tweet
    const focused = activeElement.closest(TWEET_SELECTOR);
    if (focused && isUsableTweet(focused)) return focused;
    // 3. a focused single-tweet wrapper (detail view)
    ...
  }
  // 4. CSS :focus-within on the article
  const fw = document.querySelector(`${TWEET_SELECTOR}:focus-within`);
  if (fw && isUsableTweet(fw)) return fw;
  // 5. last resort: the tweet occupying the most visible viewport area
  return findPrimaryVisibleTweet();
}
```

`isUsableTweet` = `isConnected && isVisible && isInViewport`. `findPrimaryVisibleTweet` sorts
all `article[data-testid="tweet"]` by **clipped visible area** (`getViewportClippedRect`,
clamp rect to viewport, width*height) and picks the largest — a robust "what's the user
actually looking at" heuristic when nothing is focused.

### (b) Scroll into view — N/A
Because X owns the cursor, X already scrolls. `xkey` only *reads*; it never scrolls. (Its
only geometry use is computing the screenshot crop rect.)

### (c) Dispatch actions — find a control inside the selected tweet, `.click()`
Actions are scoped to the selected `article`, found by visible text / regex over buttons,
then `.click()`:

```ts
function findExplainPostWithGrokControl(tweet) {
  return Array.from(tweet.querySelectorAll('button, [role="button"]'))
    .filter(isVisible).find(isExplainPostWithGrokElement) ?? null;
}
// EXPLAIN_POST_WITH_GROK_RE = /^(explain this post|grok(?: actions)?)$/i
// SHOW_MORE_RE = /^show more$/i
```
"Open referenced/sub-tweet" parses `a[href]` inside the tweet for a `/{user}/status/{id}`
that differs from the tweet's own status id, then `window.location.assign(url)`. Screenshot
uses `chrome.tabs.captureVisibleTab` in the background worker + crop to the tweet's rect.

### (d) Avoid clobbering — capture-phase listener + bail-outs + `stopImmediatePropagation`
```ts
document.addEventListener("keydown", handleKeydown, true);   // CAPTURE phase, document_start

function handleKeydown(event) {
  if (!isSupportedShortcut(event) || isEditableTarget(event.target)) return; // bail
  const tweet = findKeyboardSelectedTweet();
  if (!tweet) return;
  ...
  event.preventDefault();
  event.stopImmediatePropagation();   // <-- only when WE handle it
  control.click();
}

function isSupportedShortcut(e) {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false; // ignore modifiers + key-repeat
  return isShowMoreShortcut(e) || isOpenReferencedTweetShortcut(e) || ...;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'));
}
```
Key points:
- **Capture phase (`true`) + `run_at: document_start`** so its handler runs before X's, but
  it only `preventDefault`/`stopImmediatePropagation` for keys it *owns* — every other key
  falls through to X untouched.
- **`isEditableTarget` uses `target.closest(...)`** (covers nested rich-text editors and
  `role="textbox"`), not just `tagName` on `activeElement`.
- **Ignores `e.repeat`** (held key) and any modifier combo it doesn't claim.
- Manifest: MV3, `matches: ["https://x.com/*","https://twitter.com/*"]`,
  `run_at: document_start`, `permissions: ["clipboardWrite"]`.

---

## Tool 2 — `CodyBontecou/twittervim` — implements its OWN cursor + command palette  ⭐ kept in ./reference

- Repo: https://github.com/CodyBontecou/twittervim · MV3, Vue 3 + Vite + `@vueuse/core`,
  content script mounted into a **closed Shadow DOM**. Cloned to `./reference/twittervim`.
- Core logic: `src/composables/useTwitterKeyboard.ts` (624 lines). Command palette:
  `src/contentScripts/views/CommandPalette.vue` (Cmd/Ctrl+Shift+P, VSCode-style).
- Bindings: `j`/`k` focus next/prev tweet; `r` reply, `t` retweet, `l` like, `b` bookmark,
  `o` open, `z` zen-mode, `Esc` unfocus; `g h/e/n/m/k/p/l/b/c` navigate.

### (a) Cursor — its own integer index + visible-element list
```ts
const currentFocusedTweetIndex = ref(0)

function getNavigableElements(): HTMLElement[] {
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')]
  // also include "Show N posts" buttons inside [data-testid="cellInnerDiv"]
  ...
  allElements.sort((a, b) => {            // sort by DOM order via compareDocumentPosition
    const pos = a.compareDocumentPosition(b)
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
  return allElements
}
function focusNextTweet() {
  const els = getNavigableElements()
  currentFocusedTweetIndex.value = Math.min(currentFocusedTweetIndex.value + 1, els.length - 1)
  focusTweet(els[currentFocusedTweetIndex.value])
}
```

### (b) Track + scroll into view — inline outline + manual centering
`focusTweet` draws the highlight by mutating inline styles (`el.style.outline = '4px solid
#1d9bf0'; outlineOffset = '-4px'; boxShadow = ...`) — it does **not** call native
`.focus()`. Then `centerElementInViewport`:
```ts
function centerElementInViewport(element) {
  requestAnimationFrame(() => {
    const rect = element.getBoundingClientRect()
    const isOffScreen = rect.bottom < 0 || rect.top > innerHeight
    if (isOffScreen) {
      element.scrollIntoView({ behavior: 'instant', block: 'center' }) // jump first
      requestAnimationFrame(() => { /* then smooth-correct the residual offset */ })
    } else {
      const scrollOffset = (rect.top + rect.height/2) - innerHeight/2
      if (Math.abs(scrollOffset) > 10) window.scrollBy({ top: scrollOffset, behavior: 'smooth' })
    }
  })
}
```
Pattern worth copying: **`requestAnimationFrame` before measuring** (DOM/layout settled),
**`block:'center'` to keep the focused tweet mid-screen**, and a **>10px dead zone** so it
doesn't micro-scroll.

### (c) Dispatch actions — `data-testid` selector inside focused element, `.click()`
```ts
function clickOnFocusedTweet(selector) {
  const el = getNavigableElements()[currentFocusedTweetIndex.value]
  if (!el) return
  // skip "Show N posts" rows (no action bar)
  const btn = el.querySelector(selector)   // [data-testid="reply"|"retweet"|"like"|"bookmark"]
  if (btn) btn.click()
}
// like: clickOnFocusedTweet('[data-testid="like"]')   reply: ...="reply"
// retweet: ...="retweet"   bookmark: ...="bookmark"
// open: el.querySelector('a[href*="/status/"]') -> window.location.href
```
The canonical action-bar `data-testid`s are: `reply`, `retweet`, `like`, `bookmark` (these
are stable). Note: there is **no** `data-testid` here for mute/block/"not interested" — those
require opening the caret menu (twittervim does not implement them).

### (d) Avoid clobbering — `@vueuse` MagicKeys + `isTyping()` + `hasModifier()` guards
```ts
const keys = useMagicKeys()
const { r, t, l, b, j, k, o, z, Escape, Meta, Control, Alt, Shift } = keys

function isTyping() {
  if (options.isCommandPaletteOpen?.()) return true
  const a = document.activeElement
  return a?.tagName === 'INPUT' || a?.tagName === 'TEXTAREA'
      || a?.getAttribute('contenteditable') === 'true' || isComposing.value
}
function hasModifier() { return Meta.value || Control.value || Alt.value || Shift.value }

whenever(j, () => { if (!isTyping() && !hasModifier()) focusNextTweet() })
whenever(l, () => { if (!isTyping() && !hasModifier()) clickOnFocusedTweet('[data-testid="like"]') })
```
Plus IME handling: `compositionstart`/`compositionend` set an `isComposing` flag so CJK input
isn't hijacked.

---

## Tool 3 (reference for input/suppression only) — Vimium & Surfingkeys

These are *general-purpose* Vim browsers (not tweet-cursor tools), but their input/suppression
code is the gold standard for point (d).

### Vimium (`philc/vimium`)
- `j`/`k` are **pixel scroll**, not a tweet cursor: in `background_scripts/commands.js`,
  `"j": "scrollDown", "k": "scrollUp", "h": "scrollLeft"`. Tweet actions would be done via
  `f` link hints, not a cursor. (Source: commands.js:411-413.)
- Input detection — `lib/dom_utils.js` `isEditable(el)`:
  ```js
  isSelectable(el) { /* input (except button/checkbox/radio/submit/...) */
    return (el.nodeName.toLowerCase()==='input' && !unselectableTypes.includes(el.type))
        || el.nodeName.toLowerCase()==='textarea' || el.isContentEditable; }
  isEditable(el) { return this.isSelectable(el) || el.nodeName?.toLowerCase()==='select'; }
  ```
- Suppression — `content_scripts/mode_normal.js`: when
  `document.activeElement && DomUtils.isEditable(document.activeElement)` it switches into an
  **InsertMode** (`exitOnFocus: true`, `targetElement: activeElement`) that *passes keys
  through* — i.e. a dedicated mode rather than a per-key `if (isTyping) return`. Copy the
  idea: treat "in a text field" as a mode, exit it on blur.

### Surfingkeys (`brookhong/Surfingkeys`)
- `src/content_scripts/common/default.js` — declarative `mapkey(key, desc, fn)` /
  `imapkey` (insert-mode map) / `vmapkey`. Editable element resolved via `getRealEdit()`.
  Lets users **`unmap`** keys per-site (regex on URL) — the canonical answer to "let the
  user resolve conflicts with X's own keys."

---

## Patterns to COPY

1. **Prefer reusing X's native `j`/`k` cursor** (xkey model) if your feature set is "extra
   actions on the selected tweet." Read selection with the 4-stage fallback:
   `aria-activedescendant` → `activeElement.closest('article[data-testid="tweet"]')` →
   `article[data-testid="tweet"]:focus-within` → largest-visible-area tweet. This is the
   single most robust focus-detection recipe found.
2. **Scope every action to the selected `<article data-testid="tweet">`** and click stable
   children: `[data-testid="reply"|"retweet"|"like"|"bookmark"]`. (xkey + twittervim agree.)
3. **Input guard with `target.closest(...)`** over `input, textarea, select,
   [contenteditable=""], [contenteditable="true"], [role="textbox"]` — not just
   `activeElement.tagName`. Add **IME guard** via `compositionstart/end`. (xkey selector +
   twittervim composition flag = best combined version.)
4. **Capture-phase `keydown` at `document_start`, but only `preventDefault` +
   `stopImmediatePropagation` for keys you actually own.** Everything else falls through to X.
5. **Ignore `e.repeat` and unclaimed modifier combos** (`altKey/ctrlKey/metaKey`).
6. **Scroll-into-view recipe** (if you own the cursor): `requestAnimationFrame` → measure →
   if off-screen `scrollIntoView({block:'center', behavior:'instant'})` then smooth-correct;
   else `window.scrollBy` to center with a >10px dead zone.
7. **Mount overlay UI in a (closed) Shadow DOM** (twittervim) so X's CSS can't leak in and
   your styles can't leak out; use a very high `z-index` (twittervim uses 999999).
8. **Provide a discoverable command palette / `?` augmentation.** xkey injects its keys into
   X's own `?` dialog; twittervim ships a Cmd+Shift+P palette. Either keeps shortcuts
   learnable.
9. **Let users `unmap`/rebind per-site** (Surfingkeys) so they can resolve clashes with X.

## ANTI-PATTERNS to avoid

1. **Binding bare `j k l r t b m` while ALSO implementing your own cursor** (twittervim does
   this). These are X's native keys; without reliably suppressing X's handler you get
   double-movement or double-actions. Either reuse X's cursor (xkey) or fully suppress X on
   the claimed keys.
2. **An integer `currentFocusedTweetIndex` against a virtualized, infinite-scroll list.**
   X mounts/unmounts `article`s as you scroll, so a positional index drifts: the element at
   index N changes identity, and `removeFocusFromTweet` resets to `0` (top) rather than
   tracking the element. Track the **element itself** (or its status id), not an index.
   (Risk inherent in twittervim's design.)
3. **Mutating inline `el.style.outline/transform/opacity` for the highlight** (twittervim's
   zen mode scales/opacity-fades neighbors). It fights X's own re-renders and can be clobbered
   when X re-renders the cell; an overlay element or a CSS class on the article is safer.
4. **Guarding typing with only `activeElement.tagName === 'INPUT'`** — misses `role="textbox"`
   composer, nested contenteditable, and Shadow-DOM-retargeted targets. Use `closest()` on
   `event.target`.
5. **Global `window.location.href` navigation for "go to home/profile"** (twittervim) forces
   a full page reload, defeating X's SPA. Prefer clicking the in-app nav link
   (`[data-testid="AppTabBar_*_Link"]`) so X client-side routes.
6. **Calling `preventDefault` on every keydown** rather than only on owned keys — this is how
   tools silently break X's `/` search, `?` help, and `n`/`.` shortcuts.

## Dispatching caret-menu actions (Mute / Block / Not interested)

None of the studied tools implement mute/block/"not interested," and importantly **those rows
have no stable per-action `data-testid`** (unlike like/reply/repost/bookmark). To do it you
must: (1) click the tweet's caret button `[data-testid="caret"]` inside the selected article;
(2) the menu opens as a `[role="menu"]` (often portalled to `document.body`, not inside the
article); (3) find the `[role="menuitem"]` whose text matches the label and `.click()` it.
Use the **exact visible labels** from the live caret menu, in order: "Not interested in this
post", "Follow @user", "Add/remove from Lists", "Mute", "Block @user", "Embed post", "Report
post", "Request Community Note". Match on trimmed `textContent` (be tolerant of the dynamic
`@user` suffix for Follow/Block). Confidence: medium — labels confirmed from the screenshot;
the menu's DOM structure (`role="menu"`/`role="menuitem"`, body-portalled) is inferred from
X's general radix-style menu pattern, not directly re-verified in this session.

---

## Discovery notes / coverage

- GitHub repo search (unauthenticated API; `gh` CLI and `mgrep --web` were both rate-limited
  this session — 429) surfaced `CodyBontecou/twittervim` and `theimpostor/xkey` as the two
  dedicated, current, open-source X keyboard tools. Greasyfork's `scripts.json?q=` is
  keyword-but-not-relevance ranked and returned only media-downloader noise for
  vim/tweet/shortcut queries — no notable dedicated Vim-for-X *userscript* found (Confidence:
  medium that none popular exists; the search tooling was degraded).
- Cloned `CodyBontecou/twittervim` into `./reference/twittervim` (the richer own-cursor
  implementation — kept locally as the primary study artifact). `theimpostor/xkey` was cloned
  to `/tmp/xkey` for reading; it is the better *native-cursor-reuse* reference but was not
  retained under `./reference/`.

### Native-cursor reuse vs own cursor — verdict
- `xkey` = **reuses X's native `j`/`k` focus** (explicit in README + `findKeyboardSelectedTweet`).
- `twittervim` = **implements its own cursor** (`currentFocusedTweetIndex`, own outline, own
  scroll), and rebinds X's native `j/k/l/r/t/b` — the main source of potential conflict.
- `Vimium`/`Surfingkeys` = neither; `j/k` = scroll, actions via link hints.

## Sources
- xkey repo + code: https://github.com/theimpostor/xkey (README; `src/content.ts`
  `findKeyboardSelectedTweet`/`isEditableTarget`/`handleKeydown`; `src/manifest.json`).
- twittervim repo + code: https://github.com/CodyBontecou/twittervim
  (`src/composables/useTwitterKeyboard.ts`, `src/contentScripts/views/App.vue` &
  `CommandPalette.vue`, `README.md`).
- Vimium: https://github.com/philc/vimium (`background_scripts/commands.js`,
  `lib/dom_utils.js`, `content_scripts/mode_normal.js`).
- Surfingkeys: https://github.com/brookhong/Surfingkeys
  (`src/content_scripts/common/default.js`).
- X native shortcuts: X in-app `?` "Keyboard shortcuts" dialog (referenced by xkey README);
  community documentation. Live caret-menu labels: provided screenshot context.
