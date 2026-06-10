# 09 — Caret ("...") menu DOM: programmatically driving per-tweet actions

Research date: 2026-06-08
Scope: the DOM for driving the tweet **"..." (caret) dropdown** on x.com to perform per-tweet/per-author
actions — **Mute**, **Not interested in this post**, **Add/remove from Lists**, **Block @user**, **Follow @user** —
from a content script. Covers: caret button selector, opened dropdown container, how each menu item is
represented, the click sequence per action, whether each shows a **confirmation** dialog/sheet, the confirm
selector, the **i18n risk** (labels are localized), and the recommended matching strategy.

Project note: Lasso's own backend only needs **Add/remove from Lists** (see `04-x-lists-backends.md` §B and
`src/content/selectors.ts` `DriverSelectors`). This note documents the *full* caret menu so the same
`PageDriver` seam can drive mute / not-interested / block / follow if those features are added. Everything
here is the **DOM-automation** approach (sanctioned UI affordances), consistent with ADR/CONTEXT invariants
("one explicit user gesture → one action, human-paced, no queues").

---

## TL;DR — the stable anchors

| Thing | Selector | Confidence | Source |
|---|---|---|---|
| Caret ("...") button on a tweet | `article[data-testid="tweet"] [data-testid="caret"]` (a.k.a. `[aria-label="More"][data-testid="caret"]`, `aria-haspopup="menu"`) | **HIGH** | lucahammer gist; cpft `addCaretMenuListenerForQuoteTweet` |
| Opened dropdown container (desktop) | `[data-testid="Dropdown"]` (mounted in the `#layers` portal, also matchable as `[role="menu"] [data-testid="Dropdown"]`) | **HIGH** | cpft (`#layers div[data-testid="Dropdown"]`, multiple sites) |
| Opened menu container (mobile/bottom-sheet) | `[data-testid="sheetDialog"]` | **HIGH** | cpft (`desktop ? 'Dropdown' : 'sheetDialog'`) |
| A menu row | `[role="menuitem"]` (a `<div role="menuitem">` inside the Dropdown) | **HIGH** | lucahammer; cpft |
| **Block** menu item | `[data-testid="block"]` | **HIGH** | cpft `Selectors.BLOCK_MENU_ITEM` |
| Confirmation sheet button | `[data-testid="confirmationSheetConfirm"]` | **HIGH** | lucahammer; cpft `fastBlock` |
| Confirmation sheet cancel | `[data-testid="confirmationSheetCancel"]` | MEDIUM | inferred from X's `confirmationSheet*` convention |
| Lists-membership modal | `[role="dialog"]` (titled "Pick a List" / "Lists"); some builds `[data-testid="sheetDialog"]` | MEDIUM | `04-x-lists-backends.md` §B.3 |
| Success toast | `[data-testid="toast"]` | MEDIUM | `04-x-lists-backends.md` §B.4 |

The portal detail matters: the dropdown is **not** a child of the tweet `article`. After clicking the caret, X
renders the menu in the body-level `#layers` element, so you must query the **document** (or `#layers`) for
the menu, not the tweet element. (cpft: `getElement('#layers div[data-testid="Dropdown"] ...')`.)

---

## 1. The caret button

Each timeline tweet is `article[data-testid="tweet"]`. Its overflow button:

```css
article[data-testid="tweet"] [data-testid="caret"]
/* equivalently, more specific: */
article[data-testid="tweet"] [aria-label="More"][data-testid="caret"]
```

- It is a `<button>`/`<div role="button">` with `data-testid="caret"`, `aria-label="More"` (localized), and
  `aria-haspopup="menu"`.
- **Always scope to the specific tweet** (`tweetEl.querySelector('[data-testid="caret"]')`) — a timeline has
  one caret per tweet, plus carets inside quoted tweets.
- Action: `caret.click()`.

Source: lucahammer "delete-tweets" gist uses literally
`'[data-testid="tweet"] [aria-label="More"][data-testid="caret"]'`; cpft attaches a listener via
`$tweet.querySelector('[data-testid="caret"]')`.

---

## 2. The opened dropdown

After `caret.click()`, X mounts the menu **asynchronously** in the `#layers` portal at body level:

```css
/* Desktop */
#layers [data-testid="Dropdown"]          /* the menu container */
[role="menu"] [data-testid="Dropdown"]    /* same thing, role-anchored */

/* Mobile / bottom-sheet build */
[data-testid="sheetDialog"]
```

Because it renders after the click, you **must wait** for it (MutationObserver / `getElement`-style helper),
not read it synchronously. Menu rows inside it:

```css
[data-testid="Dropdown"] [role="menuitem"]    /* desktop */
[data-testid="sheetDialog"] [role="menuitem"] /* mobile */
```

Each `[role="menuitem"]` contains an SVG icon + a localized text label (`[dir]` span). cpft styles them with
`[data-testid="${desktop ? 'Dropdown' : 'sheetDialog'}"] [role="menuitem"] [dir]`.

---

## 3. Menu items — testid vs. text vs. icon

X gives **only some** menu items a stable `data-testid`. Others must be matched by **icon SVG path** or by
**localized visible text**. CONFIRMED order from the live screenshot (non-follower, your own follow state may
reorder Follow/Mute):

| # | Visible label (en) | Stable `data-testid`? | Icon SVG path available? | How to match (best → fallback) |
|---|---|---|---|---|
| 1 | **Not interested in this post** | ❌ none observed | (feedback icon) | text `/not interested/i` → `aria-label` |
| 2 | **Follow @user** / **Unfollow @user** | ❌ on the menu item itself | (person-plus icon) | text `/^follow @/i` → icon. (The profile/hover *button* has `data-testid$="-follow"` / `-unfollow`, but the **menu item** generally does not.) |
| 3 | **Add/remove from Lists** | ❌ none | (list icon) | text `/add\s*\/\s*remove.*lists|add to list/i` (label key `AddRemoveFromLists`) |
| 4 | **Mute** / **Unmute @user** | ❌ on the menu item | ✅ `Svgs.MUTE` path (see below) | icon path → text `/^mute|^unmute/i` |
| 5 | **Block @user** / **Unblock @user** | ✅ **`data-testid="block"`** | ✅ | `[data-testid="block"]` (most stable) |
| 6 | **Embed post** | ❌ | — | text |
| 7 | **Report post** | ❌ | — | text `/report/i` |
| 8 | **Request Community Note** | ❌ | — | text |

**Confirmed stable testid: `block`.** cpft hard-codes `BLOCK_MENU_ITEM: '[data-testid="block"]'` and relies on
it for its "fast block" feature. No equivalent stable testid was found in the references for *Mute*,
*Not interested*, *Add/remove from Lists*, or the menu-item *Follow* (these are matched structurally).

**Mute icon path** (use as a locale-independent anchor for the Mute row) — from cpft `Svgs.MUTE`:
```
M18 6.59V1.2L8.71 7H5.5C4.12 7 3 8.12 3 9.5v5C3 15.88 4.12 17 5.5 17h2.09l-2.3 2.29 1.42 1.42 15.5-15.5-1.42-1.42L18 6.59zm-8 8V8.55l6-3.75v3.79l-6 6zM5 9.5c0-.28.22-.5.5-.5H8v6H5.5c-.28 0-.5-.22-.5-.5v-5zm6.5 9.24l1.45-1.45L16 19.2V14l2 .02v8.78l-6.5-4.06z
```
Match it via `menuItem.querySelector('svg path[d^="M18 6.59V1.2"]')` (prefix match is safest; X has occasionally
tweaked trailing path data). cpft itself uses this exact technique for many controls (`Svgs.RETWEET`,
`Svgs.MUTE`, `Selectors.SORT_REPLIES_PATH`, etc.).

---

## 4. Per-action click sequence + confirmation

All flows start the same way:
```
tweetEl.querySelector('[data-testid="caret"]').click()
→ waitForElem('#layers [data-testid="Dropdown"]')   // or [data-testid="sheetDialog"] on mobile
```
Then pick the row and click it. Whether a **confirmation** follows differs per action:

| Action | Menu-item selector (best) | Confirmation? | Confirm selector |
|---|---|---|---|
| **Not interested in this post** | text `/not interested/i` | **No** dialog. Applies immediately; tweet collapses to an undo card ("Thanks. You'll see fewer posts like this." with **Undo**). | (none) — optional Undo is a `[role="button"]` in the replaced cell |
| **Follow @user** | text `/^follow @/i` (or icon) | **No** confirmation. Follows immediately; menu item flips to "Following/Unfollow". | (none) |
| **Add/remove from Lists** | text `/add\s*\/\s*remove.*lists|add to list/i` | **Opens a modal** `[role="dialog"]` (list picker), not a yes/no confirm. Toggling a row is often immediate; some builds have a Done/Save and/or a `confirmationSheetConfirm`. See `04-x-lists-backends.md` §B.3–B.5. | toggle row → optional `[data-testid="confirmationSheetConfirm"]` / Done button |
| **Mute** | icon `Svgs.MUTE` → text `/^mute/i` | **Usually No** confirmation (mutes immediately, shows toast). Behavior has historically varied; *some* builds show a confirm sheet. **Treat as "confirm if present"**: after clicking, check for `[data-testid="confirmationSheetConfirm"]` within a short timeout and click it only if it appears. | `[data-testid="confirmationSheetConfirm"]` *(only if present)* |
| **Block @user** | `[data-testid="block"]` | **YES — confirmation sheet.** A `[role="dialog"]` / confirmation sheet ("Block @user?") appears. | **`[data-testid="confirmationSheetConfirm"]`** (required) |

The **block** confirm flow is the canonical, code-confirmed one. cpft's `fastBlock`:
1. sees `[data-testid="block"]` in the dropdown (`blockMenuItemSeen = true`);
2. user clicks it (`e.target.closest('[data-testid="block"]')` → `blockMenuItemClicked = true`);
3. when `[data-testid="confirmationSheetConfirm"]` appears, clicks it to commit
   (`$popup.querySelector('[data-testid="confirmationSheetConfirm"]').click()`).

lucahammer's delete flow confirms the same generic pattern: click the menuitem, then
`document.querySelector('[data-testid="confirmationSheetConfirm"]')?.click()`.

> Rule of thumb for resilience: after clicking *any* destructive-ish item, **probe** for
> `[data-testid="confirmationSheetConfirm"]` with a short MutationObserver timeout and click it if present.
> This makes the driver correct for Block (always confirms), tolerant for Mute (sometimes confirms), and a
> no-op for Follow / Not-interested (never confirm).

---

## 5. Reference driver (content-script, human-paced)

Mirrors `04-x-lists-backends.md` §B.3. **Must be called from a single user gesture** — never in a loop.

```js
// resolve when selector appears (MutationObserver) with timeout; null on miss for the "confirm if present" probe
function waitForElem(selector, { root = document, timeout = 4000 } = {}) {
  const hit = root.querySelector(selector);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const t = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    const obs = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { clearTimeout(t); obs.disconnect(); resolve(el); }
    });
    obs.observe(root.documentElement || root, { childList: true, subtree: true });
  });
}
const items = (menu) => [...menu.querySelectorAll('[role="menuitem"]')];
const byText = (menu, re) => items(menu).find(el =>
  re.test(el.textContent || el.getAttribute('aria-label') || ''));
const byIconPrefix = (menu, dPrefix) => items(menu).find(el =>
  el.querySelector(`svg path[d^="${dPrefix}"]`));

async function openTweetMenu(tweetEl) {
  tweetEl.querySelector('[data-testid="caret"]').click();
  // desktop Dropdown OR mobile sheetDialog
  const menu = await waitForElem('#layers [data-testid="Dropdown"]')
            || await waitForElem('[data-testid="sheetDialog"]');
  if (!menu) throw new Error('caret menu did not open');
  return menu;
}

// click the confirmation sheet IF X shows one (Block always; Mute sometimes; others never)
async function confirmIfPresent({ timeout = 1500 } = {}) {
  const btn = await waitForElem('[data-testid="confirmationSheetConfirm"]', { timeout });
  if (btn) { btn.click(); return true; }
  return false;
}

async function blockAuthor(tweetEl) {
  const menu = await openTweetMenu(tweetEl);
  const block = menu.querySelector('[data-testid="block"]');  // stable testid
  if (!block) throw new Error('block item not found');
  block.click();
  const confirmed = await confirmIfPresent({ timeout: 3000 }); // Block ALWAYS confirms
  if (!confirmed) throw new Error('block confirmation sheet did not appear');
}

async function muteAuthor(tweetEl) {
  const menu = await openTweetMenu(tweetEl);
  const MUTE_ICON = 'M18 6.59V1.2V'.slice(0, 12); // 'M18 6.59V1.2' prefix
  const mute = byIconPrefix(menu, 'M18 6.59V1.2') || byText(menu, /^mute|^unmute/i);
  if (!mute) throw new Error('mute item not found');
  mute.click();
  await confirmIfPresent();          // confirm only if a sheet shows up
}

async function notInterested(tweetEl) {
  const menu = await openTweetMenu(tweetEl);
  const item = byText(menu, /not interested/i);
  if (!item) throw new Error('not-interested item not found');
  item.click();                      // no confirmation — applies immediately
}

async function followAuthor(tweetEl) {
  const menu = await openTweetMenu(tweetEl);
  const item = byText(menu, /^follow @/i);
  if (!item) throw new Error('follow item not found');
  item.click();                      // no confirmation
}

// Add/remove from Lists — opens a list-picker MODAL, not a yes/no confirm. See 04-x-lists-backends.md §B.3.
async function addRemoveFromLists(tweetEl, targetListName) {
  const menu = await openTweetMenu(tweetEl);
  const item = byText(menu, /add\s*\/\s*remove.*lists|add to list/i);
  if (!item) throw new Error('lists item not found');
  item.click();
  const dialog = await waitForElem('[role="dialog"]');
  // ... toggle the row whose text === targetListName (idempotent via aria-checked), then commit
  // (Done/Save button or [data-testid="confirmationSheetConfirm"] if the build has one)
}
```

Pacing invariants (CONTEXT.md): one gesture → one action; no `for`/`while`/`setInterval`; small `sleep`s are
DOM-settle only; on timeout, abort and surface an error (don't retry-spam).

---

## 6. i18n risk — labels are localized; do NOT match raw English

The menu labels in the CONFIRMED list ("Not interested in this post", "Mute", "Block @user", "Add/remove from
Lists", …) are **UI strings translated per the user's X language setting**, independent of OS/browser locale.
Hard evidence: `insin/control-panel-for-twitter` ships **~43 locale tables** (`ar`, `bg`, `bn`, `ca`, `cs`,
`da`, `de`, …) precisely because it must recognize these strings across languages — e.g. `REPOST` is
`إعادة النشر` (ar) / `Препубликуване` (bg) / `Republicació` (ca). A regex like `/^block$/i` will silently
fail for any non-English user.

Mitigation, in priority order:
1. **`data-testid`** where it exists — only **Block (`data-testid="block"`)** among our five. Locale-proof.
2. **Icon SVG `path[d]` prefix** — locale-proof and what cpft uses for Mute/Retweet/etc. Use `^=` (prefix)
   matching since X occasionally edits trailing path coordinates.
3. **Structural position** within the menu — fragile (order changes with follow/mute/block state), use only
   as a last resort.
4. **Localized text / `aria-label`** — the *fallback*, and only viable if you either (a) read the user's X
   language and keep a per-locale string table (cpft's approach), or (b) accept English-only.

Recommendation for Lasso: keep all caret-menu hooks in the **single `DriverSelectors` table**
(`src/content/selectors.ts`) so a redesign is a one-file fix. Anchor by `data-testid`/icon-path first; keep a
small localized-text fallback (the project already has `ADD_TO_LISTS_TEXT` as a regex). Detect breakage at
runtime (element not found within timeout) and **fail loudly**.

---

## 7. How this maps onto the existing code

`src/content/selectors.ts` already defines:
```ts
export const DriverSelectors = {
  CARET: '[data-testid="caret"]',
  MENU: '[role="menu"]',
  MENUITEM: '[role="menuitem"]',
  DIALOG: '[role="dialog"]',
  CHECKBOX: '[role="checkbox"], input[type="checkbox"]',
  SAVE: '[data-testid="confirmationSheetConfirm"]',
} as const;
export const ADD_TO_LISTS_TEXT = /add\s*\/\s*remove.*lists|add to list/i;
```
Gaps to add if mute/block/not-interested/follow get implemented:
- `DROPDOWN: '[data-testid="Dropdown"]'` and `SHEET: '[data-testid="sheetDialog"]'` (the menu *container*; the
  current `MENU: '[role="menu"]'` is fine but `[data-testid="Dropdown"]` is the more specific portal anchor).
- `BLOCK: '[data-testid="block"]'` (stable).
- `MUTE_ICON_PATH_PREFIX = 'M18 6.59V1.2'` for icon matching.
- localized-text regexes for Mute / Not-interested / Follow (fallback tier).
- Note that the menu lives in `#layers` (query the document, not the tweet element).

---

## 8. Open questions / to verify live (DevTools, logged-in session)

- Confirm in a current build whether **Mute** shows a `confirmationSheetConfirm` sheet or applies silently
  (the "confirm if present" probe handles both, but worth knowing).
- Whether **Follow/Unfollow** *menu items* ever carry a `data-testid` in the dropdown (the profile/hover
  follow **buttons** use `data-testid$="-follow"`/`-unfollow`, but those are not the caret-menu rows).
- Whether **Not interested** ever surfaces a confirm/undo *sheet* vs. the inline collapse-and-Undo card.
- The exact list-picker modal internals (`[role="dialog"]` row testids, Done/Save vs. immediate toggle) — the
  least stable area; tracked in `04-x-lists-backends.md` §B.3–B.5.

---

## Sources

Community / reverse-engineering reference code (medium–high confidence; time-sensitive — verify live):
- **`insin/control-panel-for-twitter`** (`script.js`, 8322 lines; cloned to `/tmp/cpft`) — the authoritative
  real-world X DOM reference. Confirms: `Selectors.BLOCK_MENU_ITEM = '[data-testid="block"]'` (line ~2295);
  desktop dropdown `#layers div[data-testid="Dropdown"]` and mobile `[data-testid="sheetDialog"]` (lines
  ~3975, ~4450, ~5823); menu rows `[role="menuitem"]`; caret `$tweet.querySelector('[data-testid="caret"]')`
  in `addCaretMenuListenerForQuoteTweet` (~4007); **block confirmation** via
  `[data-testid="confirmationSheetConfirm"]` in `fastBlock` (~5951–5968); icon-path matching for actions
  (`Svgs.MUTE`, `Svgs.RETWEET`, `Selectors.SORT_REPLIES_PATH`); **~43 per-locale string tables** (lines ~245+)
  demonstrating the i18n risk. Repo: https://github.com/insin/control-panel-for-twitter
- **lucahammer "delete-tweets" gist** — confirms caret selector
  `'[data-testid="tweet"] [aria-label="More"][data-testid="caret"]'`, the `waitForElemToExist`
  MutationObserver pattern, `[role="menuitem"]` rows, action testids `[data-testid="unretweet"]` /
  `[data-testid="unretweetConfirm"]`, and the generic confirm
  `document.querySelector('[data-testid="confirmationSheetConfirm"]')?.click()`:
  https://gist.github.com/lucahammer/1aa16b4d3c1fb04035839da5ef699d65

Project-internal corroboration:
- `docs/research/04-x-lists-backends.md` §B (caret → Dropdown → menuitem "Add/remove from Lists" → `[role="dialog"]`
  list picker → toggle → `confirmationSheetConfirm` / Done; selector-resilience guidance §B.4).
- `docs/research/03-tweet-extraction.md` (tweet/article structure, `User-Name`, quoted-tweet handling).
- `src/content/selectors.ts` (`DriverSelectors`, `ADD_TO_LISTS_TEXT`).
- `docs/CONTEXT.md` (PageDriver seam; human-paced invariants).

Label-localization corroboration (from `04-x-lists-backends.md`): "Add/remove from Lists" label key
`AddRemoveFromLists`, confirmed across X clients (TwidereProject/TwidereX-iOS
`Common.Controls.User.Actions.AddRemoveFromLists`; official Android `com.x.navigation.AddRemoveFromListsArgs`).

Not usable for DOM (GraphQL-only dumps, cloned to `/tmp`): `fa0311/TwitterInternalAPIDocument`,
`trevorhobenshield/twitter-api-client` — contain no caret-menu `data-testid`s.

Caveat: every `data-testid`, `role`, label, and icon path above is extracted from X's React client and **can
change without notice**. Anchor by `data-testid`/icon-path first, keep localized-text fallbacks, centralize in
one selector table, and fail loudly on miss.
