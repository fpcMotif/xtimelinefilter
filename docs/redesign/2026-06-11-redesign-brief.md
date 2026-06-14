# Lasso Redesign Brief

**Direction:** Native Chameleon — "Shipped by X"
**Tagline:** Indistinguishable from X. Faster than X.

---

## Vision

Lasso stops looking like an extension and starts looking like a feature X quietly shipped last Tuesday. Every surface is rebuilt from X's own measured anatomy — Chirp type at 15/20, the #1d9bf0 blue spent exactly as sparingly as X spends it, 16px dialog radius, 9999px pills, full-bleed square menu rows, the signature `0 0 15px` halo shadow, the `#5b7083/40%` backdrop — and themed against X's three real site themes (Default, Dim, Lights Out) detected from the page itself, never the OS. The centerpiece is anchoring: the ListPicker abandons its bottom-center float and opens exactly where X's own caret menu opens — at the top-right of the target post for Alt+L, above the ActionBar for pointer — so location, shadow, and row anatomy all read as muscle memory. The selection check relocates to the avatar corner (where X puts its own check in DM select mode) and disappears entirely when you're not selecting. Since looks are forbidden as a differentiator, speed and feedback carry the product: the picker opens in 0ms from cache, checks flip optimistically on keypress, the assign run is a live progress surface that never destroys the selection, and every outcome lands as a Sonner-mechanics toast with one follow-up action. Nothing about Lasso should be identifiable in a screenshot — and nothing about Lasso should ever be slower than X.

## Design principles

- **The host page is the design system.** Every color, radius, shadow, and string is the OKLCH twin of a measured x.com value. When in doubt, open X's own caret menu and copy it. The only sanctioned deviations: the surface-colored toast (X's blue toast fails AA for a 13px record of results) and the picker's footer kbd legend (the one quiet discoverability surface).
- **Zero milliseconds is the brand.** Keyboard-opened surfaces appear in 0ms, always (Emil rule). The picker opens instantly from cache and revalidates behind the user's back. Selection is local state — optimistic by construction. Motion exists only for pointer- and system-initiated UI, transform/opacity only, under 250ms, strong ease-out.
- **Feedback is never silent and never lies.** Five picker states (loading/error/empty/no-match/ready), per-author failure reasons, rate-limit countdowns, undo on every destructive quick action, a selector-health notice when X changes. The console is not a UI surface.
- **Failure never costs the user their selection.** Progress clears only the successfully-added subset; rate-limit stops leave the remainder selected with a countdown; Stop aborts mid-run and keeps the un-attempted authors. Retry is always one key away.
- **Teach in-product, then evaporate.** Permanent: picker footer legend, '?' sheet. Decaying (7 days or 5 assigns): ActionBar keycap, post-assign tips, first-hover tooltip, unit tooltip. Reactive: every dead-end becomes a teaching toast. After decay, the UI returns to pure camouflage.

## Design tokens

Replace `src/ui/styles.css` `@theme` wholesale. Light = X Default; dim/lightsout are overridden per detected site theme (ThemeBridge sets `data-x-theme` on every shadow host; mount.tsx's `:root`→`:host` rewrite is untouched — the override selectors below are written literally). **Delete the `prefers-color-scheme` block (styles.css:24–33) entirely** — theme follows X, never the OS. Every color is the OKLCH twin of a measured x.com hex (noted inline).

```css
@theme {
  /* surfaces */
  --color-surface:  oklch(1 0 0);                 /* #ffffff  menus, dialogs, bars */
  --color-elevated: oklch(0.975 0.003 220);       /* #f7f9f9  keycaps, skeletons */
  /* text */
  --color-ink:   oklch(0.21 0.012 240);           /* #0f1419  X primary text */
  --color-muted: oklch(0.52 0.022 242);           /* #536471  X secondary text */
  /* hairlines */
  --color-line:        oklch(0.965 0.003 210);    /* #eff3f4  X EdgeBorder */
  --color-line-strong: oklch(0.88 0.01 220);      /* #cfd9de  input borders, unselected check ring */
  /* accent — X blue, used ONLY on: primary CTA fill, selected check, active-row tint, focus ring */
  --color-accent:       oklch(0.67 0.143 244);    /* #1d9bf0 */
  --color-accent-hover: oklch(0.62 0.135 244);    /* #1a8cd8 */
  --color-accent-soft:  oklch(0.67 0.143 244 / 0.10); /* rgba(29,155,240,.1) active-row tint */
  --color-accent-text:  oklch(0.50 0.13 245);     /* darkened blue, >=4.5:1 on surface — links/toast actions */
  --color-accent-strong: oklch(0.50 0.13 245);    /* AA-safe CTA fill (4.6:1 w/ white) — used only when
                                                     the "Higher-contrast buttons" setting is on */
  --color-accent-ink:   oklch(1 0 0);
  /* status (X system palette) */
  --color-success: oklch(0.70 0.15 162);          /* #00ba7c */
  --color-danger:  oklch(0.59 0.21 25);           /* #f4212e */
  --color-warn:    oklch(0.72 0.13 80);
  /* interaction + chrome */
  --color-hover:    oklch(0.21 0.012 240 / 0.06); /* row hover — ink at 6% */
  --color-backdrop: oklch(0.55 0.03 240 / 0.4);   /* #5b7083 @ 40% — X's modal scrim */

  /* type — X scale; Chirp resolves from X's document-level @font-face inside the shadow root */
  --font-sans: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --text-title: 1.25rem;   --text-title--line-height: 1.5rem;  --text-title--font-weight: 700; /* 20/24 dialog titles */
  --text-body:  0.9375rem; --text-body--line-height: 1.25rem;  /* 15/20 — X body */
  --text-meta:  0.8125rem; --text-meta--line-height: 1rem;     /* 13/16 — X secondary */
  --text-micro: 0.6875rem; --text-micro--line-height: 0.75rem; /* 11/12 — kbd chips, overflow count */

  /* radii — X's full set; menu ROWS are square/full-bleed (no row radius, per X) */
  --radius-pill: 9999px;   /* buttons, ActionBar */
  --radius-dialog: 16px;   /* picker, dialogs */
  --radius-card: 12px;     /* toasts */
  --radius-key: 4px;       /* kbd keycaps, tooltips */

  /* shadow — X's exact dropdown/dialog halo (light) */
  --shadow-menu: 0 0 15px oklch(0.55 0.03 240 / 0.2), 0 0 3px 1px oklch(0.55 0.03 240 / 0.15);

  /* motion — keyboard-opened surfaces get 0ms, always (Emil) */
  --ease-swift: cubic-bezier(0.23, 1, 0.32, 1);
  --duration-press: 120ms;  /* press scale, hover reveals, exits */
  --duration-ui:    150ms;  /* pointer-initiated entrances (ActionBar, welcome) */
  --duration-toast: 220ms;  /* system-initiated toast enter (Sonner exception) */
}

/* X Dim — #15202b family */
:host([data-x-theme="dim"]) {
  --color-surface:  oklch(0.26 0.022 245);        /* #15202b */
  --color-elevated: oklch(0.30 0.022 245);        /* #1e2732 */
  --color-ink:   oklch(0.978 0.002 200);          /* #f7f9f9 */
  --color-muted: oklch(0.67 0.018 240);           /* #8b98a5 */
  --color-line:        oklch(0.39 0.02 235);      /* #38444d */
  --color-line-strong: oklch(0.52 0.022 242);     /* #536471 */
  --color-accent-text: oklch(0.67 0.143 244);     /* #1d9bf0 passes >=4.5:1 on dim */
  --color-hover: oklch(1 0 0 / 0.06);
  --shadow-menu: 0 0 15px oklch(1 0 0 / 0.15), 0 0 3px 1px oklch(1 0 0 / 0.10); /* X dark halo */
}

/* X Lights Out — #000 family */
:host([data-x-theme="lightsout"]) {
  --color-surface:  oklch(0 0 0);                 /* #000000 */
  --color-elevated: oklch(0.22 0.006 260);        /* #16181c */
  --color-ink:   oklch(0.93 0.002 240);           /* #e7e9ea */
  --color-muted: oklch(0.56 0.008 250);           /* #71767b */
  --color-line:        oklch(0.31 0.005 240);     /* #2f3336 */
  --color-line-strong: oklch(0.42 0.006 245);     /* #3e4144 */
  --color-accent-text: oklch(0.67 0.143 244);
  --color-hover: oklch(1 0 0 / 0.06);
  --shadow-menu: 0 0 15px oklch(1 0 0 / 0.15), 0 0 3px 1px oklch(1 0 0 / 0.10);
}

@layer base {
  :host { all: initial; /* host-page custom properties pierce shadow boundaries — hard reset */
          font: 400 var(--text-body)/1.25rem var(--font-sans);
          -webkit-font-smoothing: antialiased; color: var(--color-ink); }
}

@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  /* skeletons: static 0.6 opacity; spinner: 3-dot opacity cycle handled in-component */
}
```

On dim/lightsout, panels additionally carry a 1px `var(--color-line)` border (X adds the hairline on dark surfaces). Budget a one-hour pass comparing rendered Lasso surfaces against live computed styles on all three X themes before calling the camouflage done.

## Component specs

### Foundation 1 — ThemeBridge (`src/ui/theme-bridge.ts`, new)

Replaces the OS-driven `prefers-color-scheme` block. **Detection:** at `start()` read `getComputedStyle(document.body).backgroundColor` and map exactly — `rgb(255,255,255)` → `light`, `rgb(21,32,43)` → `dim`, `rgb(0,0,0)` → `lightsout`; anything else → nearest by relative luminance (≥0.6 light, ≥0.05 dim, else lightsout). **Watch:** `MutationObserver` on `document.body`, `attributeFilter:['style']` (X writes the theme as an inline background-color); re-detect on change. **Apply:** module-level `Set<HTMLElement>` registry of every Lasso shadow host — the main UI root from `createUiRoot` and every per-tweet overlay host (add `registerThemedHost(host)` inside `attachShadowRoot`); on change, set `host.setAttribute('data-x-theme', theme)` on each. Off-x.com (options page), fall back to `prefers-color-scheme`.

### Foundation 2 — AnchoredPopover (`src/ui/AnchoredPopover.tsx`, new)

Replaces the `fixed bottom-24` wrapper in app.tsx:81. **Anatomy** (copies X's dropdown anatomy): (1) transparent click-catcher backdrop `fixed inset-0 z-[2147483645]` — click dismisses, **never blocks wheel scroll** of the feed; (2) the panel: `position:fixed`, `z-[2147483646]`, bg-surface, `radius-dialog` 16px, `shadow-menu`, 1px `--color-line` border on dim/lightsout. **Placement:** props `{ anchorRect: () => DOMRect | null, align: 'caret' | 'above-center' }`. `caret` (Alt+L): panel's top-RIGHT corner at `(anchorRect.right, anchorRect.bottom + 4px)` — where X's native "…" menu opens; anchor = `article.querySelector('[data-testid="caret"]')`, fallback the article's top-right. Flip: if `viewportHeight − anchorRect.bottom < 440px`, place panel's bottom-right at `(right, top − 4px)`. `above-center` (pointer, from ActionBar): bottom-center 8px above the bar. **Clamp:** 16px minimum to every viewport edge. **Tracking:** while open, one `requestAnimationFrame` loop reads `anchorRect()` and writes `transform: translate3d(...)` — one `getBoundingClientRect` per frame, only while open; if the anchor is detached by X's virtualized timeline or scrolled >40px out of viewport, **freeze at last clamped position — do not dismiss** (the user may be mid-typing). *Fallback ratified in advance:* if the freeze case looks detached in practice, fall back to a fixed top-anchored home (`top: 96px`, centered, fixed-height body) — spatial consistency beats proximity if proximity can't be made reliable. **Motion:** none, 0ms, both open paths. **Focus:** on mount, `requestAnimationFrame → input.focus({preventScroll:true})`; on unmount restore focus to the `document.activeElement` captured at open. **Keys:** document-level capture keydown while open — Escape always dismisses regardless of focus; Tab/Shift+Tab `preventDefault` and keep focus on the input (single-focusable trap).

### Foundation 3 — BottomStack + keycap chip

One fixed wrapper in app.tsx: `bottom: 24px; left: 50%; translateX(-50%); z-[2147483646]; flex column-reverse; align-items: center; gap: 8px; pointer-events: none` (children re-enable). Contains ActionBar then ToastStack; the picker is NOT in this stack. Replaces the bottom-6/bottom-20/bottom-24 magic-offset pile. **Keycap chip (`<kbd>`):** 18px tall (20px in the help sheet), padding 1px 5px, `radius-key` 4px, 1px `--color-line` border, bg `--color-elevated`, `text-micro` ink. **Platform-aware at mount:** render `Alt` on Windows/Linux, `⌥` on macOS — never hardcode.

### Escape priority grammar (global, deterministic)

One document-level arbiter. Esc resolves top-down, consuming exactly one layer per press: **open dialog (help sheet / welcome card) → ListPicker → ActionBar review popover → select mode (exit, keep selection) → clear selection.** Nothing else ever binds Esc.

### ListPicker (rewrite of `src/ui/ListPicker.tsx`, inside AnchoredPopover)

**Dimensions:** width 340px fixed. Structure top-to-bottom: Header 44px / Input row 48px / Body / Footer 36px. **Anti-jump rule:** placed below the anchor (top edge pinned), the body shrink-wraps to `min(content, 364px)`; flipped above (bottom edge pinned), the body height is **locked at 280px (5 rows)** for the life of the open so typing never moves the input. (Simpler fallback if the dual rule proves fiddly: fixed-height body in both orientations.)

**Header** (padding 0 16px, flex center): title `text-body` 700 ink — `Add @jane to a List` (1 person) / `Add 3 people to a List` (N). No close button (X menus have none).

**Input row:** leading magnifier SVG 16px `--color-muted` at left 16px; input `text-body` ink, placeholder `Search Lists` in muted, padding 12px 16px 12px 40px; 1px bottom hairline. ARIA: `role=combobox aria-expanded=true aria-controls="lasso-listbox" aria-activedescendant="lasso-opt-{id}"`.

**Body** (`role=listbox`, overflow-y auto, padding 4px 0): rows are **full-bleed, radius 0** (X menu rows are square; hover runs edge to edge), height 56px, padding 8px 16px, two lines. Line 1: List name `text-body` 400 ink, fuzzy-matched characters wrapped in `<b>` (700) — emphasis via weight only, exactly how X bolds typeahead matches — plus a 14px lock SVG in muted after the name when private. Line 2: `1,204 members` `text-meta` muted tabular-nums. Right slot 24px: 18px check SVG in `--color-accent` when the (single) selected author's membership is known true; on the keyboard-active row, a return-arrow glyph in muted `text-micro`. **States:** hover = `--color-hover`; keyboard-active = `--color-accent-soft` (clearly visible, replaces the 3%-lightness bug); `scrollIntoView({block:'nearest'})` in an effect on activeIndex change. **Groups:** with empty query + listUsage data: header `Recent` (top 3 by usage), then `All Lists`; headers `text-meta` 700 muted, padding 12px 16px 4px.

**Loading:** `openPicker()` opens the shell **instantly** with `listCache.lists()` (drop `force:true`, app.tsx:54), revalidates in background, reconciles in place. Cold cache: 3 skeleton rows (line-1 bar 45%×12px, line-2 bar 28%×8px, `--color-elevated`, opacity pulse 0.5↔1 at 1.2s; static 0.6 under reduced-motion).

**Error** (state modeled as `idle/loading/error/empty/ready` in app.tsx): 16px padding, icon-less — `Couldn't load your Lists` `text-body` ink + reason `text-meta` muted (`You may be logged out of X` / `X rate limited Lasso — try again in a few minutes`) + secondary pill `Retry` (32px, radius-pill, 1px `--color-line-strong` border, `text-meta` 700 ink, padding 0 16px). **Pressing `r` while the error state is shown retries** — keyboard-reachable recovery.

**True-empty:** `You don't have any Lists yet` `text-body` + `Lists let you group people on X` `text-meta` muted + primary pill `Create a List on X` (32px, bg-accent, white, `text-body` 700) → `x.com/i/lists/create`, same tab.

**No-match:** `No Lists match "des"` `text-meta` muted, 16px padding, + text button `Clear search` in `--color-accent-text` + secondary text button `Create "des" on X` (→ list creation with name prefilled where possible) — a failed search becomes a creation path, not a dead end.

**Footer** (36px, 1px top hairline, padding 0 16px, space-between): left — kbd legend in `text-micro` muted: three keycap chips `↑↓` `Enter` `Esc` followed by plain words `Navigate`, `Add`, `Dismiss`. Right — `3 selected` `text-micro` muted tabular-nums. The footer is the permanent discoverability surface and the one place Lasso quietly deviates from pure X anatomy.

### ActionBar (rewrite of `src/ui/ActionBar.tsx`)

**Bar:** lives in BottomStack. Height 52px, radius-pill, bg-surface, shadow-menu, 1px `--color-line` border on dark themes, padding 6px 8px 6px 12px, flex center gap 12px.

**Anatomy left→right:** (1) **Facepile** — up to 3 author avatars (`TweetAuthor.avatarUrl`, finally used) 26px circles overlapping −8px with 2px `--color-surface` ring, then a `+4` overflow circle 26px bg-elevated `text-micro` 700 muted. Clicking toggles a **review popover** (AnchoredPopover above-center, 280px): one 44px row per author — avatar 32px, `@handle` `text-body`, display name `text-meta` muted, trailing 24px ✕ icon-button to remove from selection. (2) **Count:** `3 people selected` — number `text-body` 700 ink tabular-nums, rest `text-body` muted. Decaying tooltip on the count (max 3 impressions, X tooltip anatomy): `Lasso adds people to Lists, not posts.` (3) 20×1px vertical hairline. (4) **Primary:** `Add to List` — X small-button anatomy: 32px, radius-pill, bg-accent hover bg-accent-hover (bg-accent-strong when the high-contrast setting is on), white `text-body` 700, padding 0 16px, `active:scale-[.96]` 120ms ease-swift. During the onboarding window only, a keycap chip `Alt+L` sits 8px right of it. (5) **Clear:** 32px circle icon-button, 18px ✕ SVG muted, hover `--color-hover`, `aria-label="Clear selection"`.

**Select-mode state** (makes `s` real — main.tsx:101 currently toggles a signal nothing reads): when `selection.selectMode` is true the bar renders even at count 0, leading with a 16px crosshair-circle SVG in accent and the line `Select mode · click posts or press x · s when done` (`text-meta` muted), plus a `Done` secondary pill (exits mode, keeps selection). App mirrors the mode as `data-mode="select"` on every overlay host. **While in select mode, a capture-phase click anywhere on a tweet article toggles its selection** (preventDefault on the article click) — sweeping a thread is one click per tweet.

**Progress state** (fixes fire-and-forget assign, app.tsx:67–75): `pick()` must NOT clear the selection. The bar swaps to: 16px X-style spinner (2px accent arc, 750ms linear; reduced-motion: 3-dot opacity cycle) + `Adding 2 of 5 to Design Folks…` `text-body` ink, per-author increments, plus a **`Stop` secondary pill** that aborts remaining sequential calls and keeps un-attempted authors selected (`2 added · 3 still selected`). `selection.clear()` runs only for the successfully-added subset after results return. On partial failure the bar persists: `2 couldn't be added` `text-meta` danger + pill `Retry failed`.

**Motion:** enter translateY(8px)+opacity → 0 over 150ms ease-swift, exit 120ms reverse (the bar is passive status, not keyboard-awaited UI). Transform/opacity only. `role=region` kept; count changes announced through the persistent live region, not by remounting.

### ToastStack (rewrite of `src/ui/Toast.tsx` — success / partial / rate-limit / undo / nudge)

**Card** (the one deliberate deviation — X's blue toast can't carry a 13px record of results at AA): min-height 48px, max-width 420px, radius-card 12px, bg-surface, shadow-menu, 1px `--color-line` border on dark themes, padding 12px 16px, flex gap 12px align-start. **Leading icon 20px:** success = circle-check `--color-success`; partial = alert-triangle `--color-warn`; failure/rate-limit = alert-circle `--color-danger`; info/nudge = ⓘ muted. **Text:** line 1 `text-body` ink; optional line 2 `text-meta` muted. **Trailing:** text buttons `text-meta` 700 `--color-accent-text`, 8px gap; 16px ✕ dismiss, visible on hover/focus-within.

**Variants (exact strings):**
- **Success:** `Added 3 to Design Folks` / line 2 when relevant `1 was already in the List` / actions `View List` (navigates to the List URL — the single promote action) and `Undo` with keycap `Z`. Auto-dismiss 4s. **Undo applies ONLY to `outcome === 'added'` results — never pre-existing memberships** (data-loss guard). `Z` works for 10s post-toast, then unbinds — the key never squats on the page's keyspace.
- **Partial:** `Added 2 to Design Folks · 1 failed` / line 2 `@handle is protected and can't be added` / action `Retry` (failed authors are still selected). Auto-dismiss 8s.
- **Rate limit (danger):** `X rate limit reached` / line 2 `Added 4 · 6 still selected — try again in 12 min` (minutes computed from `x-rate-limit-reset`). NO auto-dismiss; the 6 stay selected and the ActionBar stays up.
- **Undo/quick-action:** `Muted @jane` / action `Undo` (keycap `Z`), 10s — every Alt+M / Alt+N / block reports here instead of console (main.tsx:124–133). Failure: `Couldn't mute @jane` / `Retry`.
- **Nudge** (replaces console.warn, main.tsx:109): `Hover a post first — or press j to focus one`, info icon, 3s.
- **Select-mode tip** (moment-of-relevance, once per install): after 3 individual selections in one session — `Tip: press s to select by clicking posts`, info icon, 4s.

**Mechanics (Sonner — which X itself ships):** enter translateY(16px)→0 + opacity over 220ms ease-swift via CSS transition; exit 150ms reverse before unmount; stack max 3, item i>0 gets `scale(1 − 0.05i) translateY(−8i px)`, hover expands to 8px gaps; timers stored per-toast and cleared on replace (fixes the stale `window.setTimeout` at app.tsx:74), paused on hover and on `document.hidden`. **A11y:** ONE persistent visually-hidden `<output aria-live="polite" role="status">` mounted at app start whose `textContent` is swapped per event; reduced-motion: opacity-only 100ms.

### TweetOverlay (rewrite of `src/ui/TweetOverlay.tsx` + injection change in main.tsx:31–40)

**Placement (kills the layout shift):** stop prepending into `[data-testid="User-Name"]`; append the shadow host into the avatar container (`[data-testid="Tweet-User-Avatar"]`, position:relative anchor), absolutely positioned `right:-2px bottom:-2px`, z-index 2 — the exact spot X puts its blue check in DM select mode. Zero displacement of X's layout. Fallback if the container isn't relatively positioned: current User-Name placement, gated to select mode only.

**Visual:** 22px circle. *Unselected:* bg-surface, 1.5px border `--color-line-strong`, check hidden. *Hover:* border `--color-accent`, check rendered in accent at 40% opacity as a preview. *Selected:* bg `--color-accent`, 2px `--color-surface` outer ring (carries the 3:1 graphical-contrast load), white inline SVG check 12px (path `M20 6L9 17l-5-5`, stroke-width 2.5, round caps — replaces the font-dependent `✓`). *Press:* scale .92 for 120ms ease-swift, transform-only.

**Visibility:** host carries `data-mode` + `data-hovered`. Default `opacity 0; pointer-events none`; `[data-hovered]`, `[data-mode="select"]`, or `.selected` → `opacity 1; pointer-events auto`; transition opacity 120ms ease-swift. The existing document-level mousemove tracker (main.tsx:80–93) sets `data-hovered` on the hovered tweet's overlay host and clears the previous — no new listeners. Selected overlays remain visible while scrolled (the persistent record of the lasso). Keyboard `x` and Alt+L flip the check **instantly** — 0ms.

**Hit area:** 40px via `before:-inset-2`. `aria-pressed` kept; labels `Select @jane` / `Remove @jane from selection`.

**Selector health:** if the tweet scanner observes >200 mutations with 0 tweet matches in a session, fire a one-time info toast: `Lasso can't read the timeline — X may have changed. Check for an update.` Breakage reads as a known state, not a vanished product.

### Select-mode indicator

Folded into the ActionBar (see Select-mode state above) — no separate chip; in select mode the bar IS the mode indicator, rendering at count 0 with the crosshair glyph and the legend line. Appears/disappears in 0ms when toggled by keyboard (`s` is keyboard-triggered). Exiting (via `s`, `Done`, or Esc per the grammar) keeps the selection.

### FirstRun (welcome card + decaying coachmarks)

**Install beat:** `src/background/index.ts` `onInstalled` (reason `install`) → `chrome.tabs.create({url:'https://x.com/home#lasso-welcome'})` (replaces console.debug). Content script sees the hash (or `lasso:onboarded` absent) and renders the WelcomeCard once the timeline mounts.

**WelcomeCard** (X dialog anatomy): backdrop `--color-backdrop`, centered 380px card, radius-dialog, bg-surface, shadow-menu, padding 24px. Title `Lasso is ready` `text-title`. Three 48px rows (20px accent icon + `text-body` ink): `Hover any post and press Alt+L to file its author into a List` · `Press s to select many people, then add them all at once` · `Press ? anytime to see every shortcut`. Primary pill `Try select mode` (32px, bg-accent, white `text-body` 700 — enters select mode and dismisses) + text button `Skip` muted. Footer `text-meta` muted: `Lasso runs entirely in your browser. Nothing leaves x.com.` Dismiss writes `lasso:onboarded=true` to storage.sync. Entrance 150ms opacity (system-initiated).

**Decaying coachmarks** (Superhuman 7-day pattern; counters in `chrome.storage.local` `lasso:coach = {installedAt, assigns}`; active while `now − installedAt < 7d AND assigns < 5`): (a) ActionBar shows the `Alt+L` keycap next to `Add to List`; (b) first successful pointer-driven assign fires `Tip: Alt+L on a hovered post does this without the mouse`; (c) first time an overlay becomes hovered each session, an X-anatomy tooltip (bg ink, text surface, `text-micro`, radius 4px, padding 2px 8px, 300ms delay): `Select — then add everyone to a List at once`; (d) the count tooltip `Lasso adds people to Lists, not posts.` (max 3 impressions). Every assign increments `assigns`. After decay all hints vanish; **Settings offers `Replay intro`** to restore them.

### ShortcutHelp ('?' overlay, `src/ui/ShortcutHelp.tsx`, new)

Bound to `?` in `DEFAULT_KEYMAP` (new command `help`) — X itself opens a shortcuts modal on `?`, so the chameleon move is to look exactly like it. Full-screen backdrop `--color-backdrop`, centered dialog max-width 600px, max-height 80vh, radius-dialog, bg-surface, shadow-menu. **Header 53px:** 36px circular close icon-button at left 8px (hover `--color-hover`), title `Keyboard shortcuts` `text-title` ink; right: `Lasso` `text-meta` muted — the one visible wordmark in the product. **Body:** 16px padding, CSS grid `repeat(auto-fit, minmax(260px, 1fr))` gap 0 24px. Sections (headers `text-meta` 700 muted, padding 12px 0 4px): *Selection* — `x` Select author under cursor · `s` Select mode · `Alt+L` Add to a List · `Alt+Shift+L` Add straight to your default List; *Quick actions* — `Alt+M` Mute author · `Alt+N` Not interested; *In the List picker* — `↑ ↓` Navigate · `Enter` Add · `Esc` Dismiss; *After a toast* — `Z` Undo; *Help* — `?` This sheet. Rows 40px: action label `text-body` ink left; right-aligned keycap chips (20px tall, padding 1px 6px, radius-key, 1px `--color-line` border, bg elevated, `text-micro` ink, 2px gaps) **rendered from the LIVE keymap via `canonicalCombo`** so rebinds self-document. Footer row `text-meta` muted: `j and k move between posts — those are X's own shortcuts. Lasso never overrides them.` + `Lasso settings` link in accent-text. **Behavior:** 0ms entrance (keyboard-triggered); Esc / backdrop / close dismiss; real focus trap (close button + link are the tab stops, wrap); `role=dialog aria-modal=true aria-label="Keyboard shortcuts"`; focus restored on close.

### Settings surface (options page + toolbar)

**Manifest (`src/manifest.config.ts`):** add `options_ui {page:'src/options/index.html', open_in_tab:true}`; add `icons` {16,32,48,128} + `action.default_icon`. **Icon:** one SVG path — a lasso rope whose open loop closes into a check — drawn at 1.5px stroke on a 20px grid, single-color glyph (#0f1419 on transparent, auto dark variant). No cowboy hats, cacti, or horseshoes, ever. At 16px drop the tail; plain broken circle.

**Options page** (Preact, same token sheet; ThemeBridge falls back to `prefers-color-scheme` off-x.com): max-width 600px centered, X settings anatomy — section headers `text-title`, rows 56–72px with title `text-body` ink + description `text-meta` muted, control at right, 1px `--color-line` hairlines. **Sections:** (1) *Activation* radios: `On every visit (default)` / `Only when I click the toolbar icon` (ADR-0006 finally has a surface). (2) *How Lasso talks to X* radio cards (writes `settings.backend`): `Drive X's own menus — slow, but uses only what you could click yourself` (dom) / `X's public REST endpoints — fast, same calls X's site makes` (rest) / `GraphQL — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately.` (graphql). **Blocker:** code default is `rest` (src/core/settings.ts:23) while PRD/CONTEXT/blueprint say DOM-default — resolve and realign docs before this copy ships. (3) *Default List* — select fed from listCache, `None — always ask` default; when set, **`Alt+Shift+L` adds the target straight to it, skipping the picker** (description: `Alt+Shift+L adds straight to this List`). (4) *Keyboard shortcuts* — read-only live keymap table reusing ShortcutHelp rows + hint `Press ? on x.com anytime`. (5) *Accessibility* — toggle `Higher-contrast buttons` (swaps CTA fills to `--color-accent-strong`; the honest escape hatch for the one knowing AA deviation). (6) *Privacy & data* card: `Lasso has no servers. Your X session, your Lists, and your usage stats never leave this browser.` + secondary pill `Clear Lasso data` (wipes `lasso:lists`, `lasso:list-usage`, `lasso:settings`, `lasso:coach`; inline confirm `Cleared`) + text button `Replay intro`. Footer: version + `Report an issue` link; background sets `chrome.runtime.setUninstallURL` to a one-question form.

**Toolbar:** dormant on-demand tabs get `chrome.action.setBadgeText('zz')`, badge color #536471; clicking to wake fires `Lasso is awake on this tab` and clears the badge. While a selection is active, the badge shows the live count (accent background) — ambient state at zero in-feed pixels. **Action popup** (280px mini): state line (`Active on x.com` / `Asleep — click to wake`), top-3 shortcuts as kbd rows, `All settings →`.

## Motion spec

| Surface | Trigger | Enter | Exit | Notes |
|---|---|---|---|---|
| ListPicker | Alt+L or pointer | **0ms** | **0ms** | X menus appear instantly; Emil rule for keyboard; chameleon parity for pointer |
| ShortcutHelp | `?` | **0ms** | **0ms** | keyboard-triggered |
| Select-mode bar state | `s` | **0ms** | **0ms** | keyboard-triggered |
| Overlay check flip | `x` / Alt+L / click | **0ms** state change | — | selection is local; press scale .92 @ 120ms is the only motion |
| Overlay reveal | pointer hover | opacity 120ms ease-swift | 120ms | pointer-initiated |
| ActionBar | selection appears | translateY(8px)+opacity, 150ms ease-swift | 120ms reverse | passive status, not keyboard-awaited |
| Toast | system | translateY(16px)+opacity, 220ms ease-swift | 150ms reverse | Sonner exception; CSS transitions (interruptible) |
| WelcomeCard | system | opacity 150ms | 120ms | |
| Button press | pointer | scale .96 @ 120ms | — | transform only |
| Spinner | progress | 2px accent arc, 750ms linear | — | reduced-motion: 3-dot opacity cycle |

**Hard rules:** keyboard-opened surfaces never animate, ever. Transform/opacity only — no layout properties, no blur, no box-shadow transitions. Everything under 250ms, `--ease-swift` ease-out. All transitions interruptible (CSS transitions, not keyframes). `prefers-reduced-motion`: global 0.01ms clamp; skeletons static at 0.6 opacity; spinner becomes a 3-dot opacity cycle; toasts opacity-only 100ms.

## Accessibility checklist

- [ ] **Combobox pattern complete:** input `role=combobox aria-expanded aria-controls aria-activedescendant`; options carry `id="lasso-opt-{id}"`, `role=option`, `aria-selected`; listbox `id=lasso-listbox`.
- [ ] **Escape works everywhere:** document-level capture handler per the Esc grammar — never input-only (fixes ListPicker.tsx:35).
- [ ] **Focus management:** explicit `input.focus({preventScroll:true})` in rAF on mount (no `autofocus`); focus restored to the element captured at open on every dismiss; single-focusable trap in the picker; full trap with wrap in ShortcutHelp and WelcomeCard.
- [ ] **Active option visible:** `scrollIntoView({block:'nearest'})` on every activeIndex change; active row uses `--color-accent-soft`, never a 3% lightness shift.
- [ ] **One persistent live region:** visually-hidden `<output aria-live="polite" role="status">` mounted at app start; `textContent` swapped per event (toasts, count changes, progress) — never mounted-with-text.
- [ ] **Contrast:** all informational text ink-on-surface ≥ 7:1; toast moved off blue entirely; `--color-accent-text` (≥4.5:1) for every blue string on surface. One knowing deviation: white-on-#1d9bf0 CTA at 15px/700 (~2.9:1) for camouflage — mitigated by the `Higher-contrast buttons` setting swapping fills to `--color-accent-strong` (4.6:1).
- [ ] **Graphical contrast:** selected check carries a 2px surface ring for ≥3:1 against any media; unselected ring uses `--color-line-strong`.
- [ ] **Hit areas:** overlay ≥40px via inset pseudo-element; all icon buttons ≥32px.
- [ ] **State semantics:** overlay `aria-pressed` with `Select @jane` / `Remove @jane from selection`; ActionBar `role=region aria-label`; dialogs `role=dialog aria-modal=true` with labels; keycap chips `aria-hidden` with the action named in plain text alongside.
- [ ] **Reduced motion honored** per the motion spec; no information conveyed by motion alone.
- [ ] **Keyboard-reachable recovery:** `r` retries the picker error state; `Z` undoes within the 10s toast window; `Retry`/`Stop` reachable via the bar.
- [ ] **Numbers tabular** (`tabular-nums`) wherever counts update live (count, progress, member counts).