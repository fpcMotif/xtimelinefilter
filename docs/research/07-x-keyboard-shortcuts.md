# 07 — X / Twitter native keyboard shortcuts + the focused-post DOM model

Research date: 2026-06-08
Scope: (A) the **complete** set of X (Twitter) web keyboard shortcuts shown in the `?` "Keyboard
shortcuts" dialog — every key, what X does with it, so we can **avoid conflicts** in this extension;
(B) the **focused / highlighted post model** — when you press `j`/`k`, *which* DOM element receives
focus, *what attribute marks it*, and *how to read "the currently focused tweet article" from the DOM*.

Companion notes:
- `08-vim-twitter-extensions.md` — prior-art study of Vim-nav extensions; documents the *focus-reading
  algorithm* (`aria-activedescendant` → `getElementById` → `closest(article)` → `:focus-within`) in code.
  **This note (07) is the authoritative key-by-key shortcut inventory + the static DOM anatomy.** Read 08
  for the runtime cursor-tracking code; read 07 for "what does each key do" and "what does a focused
  article look like in the DOM".
- `09-caret-menu-dom.md` — the "..." caret dropdown DOM (Mute / Block / Lists / Follow / Report etc.).
- `10-content-keyboard.md` — content-script keyboard handling in this extension.

### Sourcing caveat (read this before trusting the table)

X **removed** the keyboard-shortcuts article from its public help center: `help.x.com/.../keyboard-shortcuts`
and the legacy `help.twitter.com/en/using-twitter/keyboard-shortcuts` both now **404** (the only Wayback
capture of the help URL is a `301`→`404`, and the legacy `support.twitter.com/articles/20171141` article ID
has been *reused* for an unrelated ad-policy page). So there is currently **no live official help URL** to cite
for the key list. The key list below is therefore reconstructed and corroborated from (a) the **live X web
client's own behavior and DOM** (the `?` dialog renders into `div[data-at-shortcutkeys]`), (b) multiple
independent open-source tools that track X's live DOM, and (c) X-behavior manifests. Items marked **HIGH** are
confirmed by ≥2 independent sources and/or the live DOM; items marked **MEDIUM** are single-source/community;
items marked **LOW** are inferred. **For an authoritative live re-confirmation, open x.com and press `?`** —
the dialog is the ground truth and these tables should be re-validated against it.

---

## TL;DR — what the extension must NOT clobber

X listens for these **single-key** shortcuts at the document level whenever focus is **not** in a text input
(`input` / `textarea` / `[role="textbox"]` / `contenteditable`). If our content script binds any of the
following as a bare key on the timeline, it will collide with X:

```
j  k  .  Enter  Space          ← navigation / open
l  r  t  n  b  m  u  /         ← actions  (n & / open compose/search)
f  s  ?                         ← (f = like alias on some builds; s = focus search alias; ? = help)
g …                            ← the "go to" prefix (g h, g e, g n, g m, g p, g l, g b, g u, g i, g s, g t)
```

Safe-ish keys X does **not** bind (good candidates for our own bindings): most letters outside the set above
(`a c d e h i o p q v w x y z`), digits, and **any modifier combo** (`Ctrl`/`⌘`/`Alt`/`Shift+`*) — X's
shortcuts are *bare* keys, so a chord like `Alt+J` won't collide. The single safest pattern is to require a
modifier, or to scope our key handling to our own UI surface and call `stopPropagation()` only there.

**Critical guard:** X only fires these when not typing. Our handler must apply the same guard (see
`08-vim-twitter-extensions.md` §"editable target" — check `isContentEditable`, `role="textbox"`, and IME
`compositionstart/end`, not just `tagName === 'INPUT'`).

---

## A. The complete shortcut set (the `?` dialog)

The dialog groups shortcuts into **Navigation**, **Actions**, and **Direct Messages**. Below, every key with
**exactly what X does**.

### A.1 Navigation

| Key | What X does | Confidence | Source |
|---|---|---|---|
| `?` | Open/close the **Keyboard shortcuts** help dialog itself. | HIGH | live client; bram.us/community mirrors |
| `j` | **Next post** — move the focus cursor down to the next post in the timeline; scrolls it into view. | HIGH | maia `x.yml`; multiple userscripts; note 08 |
| `k` | **Previous post** — move the focus cursor up to the previous post. | HIGH | maia `x.yml`; note 08 |
| `Space` (Spacebar) | **Page down** — scroll the timeline down one viewport. `Shift+Space` scrolls **up** (standard browser behavior X does not override). | HIGH | community mirrors; browser default |
| `.` (period) | **Load new posts** and **scroll to top** — equivalent to clicking the "Show N posts" / "X new posts" pill at the top of the timeline. | MEDIUM | community mirrors (widely documented); not re-confirmable via official help |
| `Enter` | **Open post details** — open the currently focused post's permalink/detail view. | HIGH | maia `x.yml` (`open_post: Enter`) |
| `o` | **Expand photo / open details** on the focused post (open the first photo, or open details if no photo). | MEDIUM | legacy Twitter dialog; community mirrors |
| `/` | **Focus the search box** (puts cursor in the search input; does *not* navigate). | HIGH | maia `x.yml`; openclawbook FEATURES.md |
| `s` | **Focus the search box** (alias of `/` on legacy/some builds). | LOW | legacy dialog; may be removed on current X |
| `?` | (listed again — opens this dialog) | HIGH | live client |

### A.2 Actions (operate on the **focused** post)

| Key | What X does | Confidence | Source |
|---|---|---|---|
| `n` | **New post** — open the compose dialog (NOT scoped to the focused post; global). | HIGH | maia `x.yml`; openclawbook |
| `l` | **Like** the focused post (toggles the heart). | HIGH | maia `x.yml`; openclawbook |
| `f` | **Like** (alias of `l` on some builds / legacy "favorite"). | LOW | legacy dialog ("f = Fav"); treat as possibly-bound |
| `r` | **Reply** to the focused post — opens the inline reply composer. | HIGH | maia `x.yml`; openclawbook |
| `t` | **Repost** the focused post — opens the Repost/Quote menu. | HIGH | maia `x.yml` (`repost: T`) |
| `b` | **Bookmark** the focused post (toggle). | HIGH | maia `x.yml` (`bookmark: B`); cpft bookmark selectors |
| `m` | **Direct Message** — opens the new-message / DM composer. **Confirmed: `m` = Direct Message (compose a new DM), NOT "mute".** Mute is *not* a top-level single key on X; muting is done via the post's "..." caret menu ("Mute") — see `09-caret-menu-dom.md`. | MEDIUM | legacy dialog ("m = New Direct Message"); cross-checked against the caret-menu note which shows Mute lives in the `...` dropdown, so `m` is *not* mute |
| `u` | **Mute / unmute the author** of the focused post. **Confirmed intent: `u` = mute account (legacy "u = mute User").** ⚠️ On the *current* X build this single-key mute may be **deprecated** — mute reliably exists only in the `...` caret menu. Do not assume `u` mutes on current X without live re-check. | LOW | legacy dialog ("u = Mute user"); NOT re-confirmable on current X; caret-menu note shows Mute in dropdown |
| `Backspace` | **Delete** (only on your own focused post, where applicable). | LOW | legacy dialog |

> Disambiguation requested by the task:
> - **`m` = Direct Message** (new DM compose). Not mute. (MEDIUM — legacy dialog wording; consistent with the
>   fact that Mute is a caret-menu item in `09-caret-menu-dom.md`.)
> - **`u` = Mute (user/author)** by original design (LOW — legacy; likely removed on current X). The
>   reliable mute path today is the **"..." → "Mute"** menu item documented in `09-caret-menu-dom.md`.

### A.3 The `g` "go to" prefix (two-key chords: press `g`, then the second key)

`g` arms a "go to" mode; the next key navigates. These are global (don't depend on a focused post).

| Chord | Destination | Confidence | Source |
|---|---|---|---|
| `g` then `h` | **Home** timeline | HIGH | maia `x.yml`; openclawbook (`G H`) |
| `g` then `e` | **Explore** | HIGH | maia `x.yml`; openclawbook (`G E`) |
| `g` then `n` | **Notifications** | HIGH | maia `x.yml`; openclawbook (`G N`) |
| `g` then `m` | **Messages** (DM inbox) | HIGH | maia `x.yml`; openclawbook (`G M`) |
| `g` then `p` | **Profile** (your own) | HIGH | maia `x.yml` (`go_profile: G then P`) |
| `g` then `l` | **Lists** | MEDIUM | legacy dialog; community mirrors |
| `g` then `b` | **Bookmarks** | MEDIUM | legacy/community mirrors |
| `g` then `i` | **Lists** (legacy alias) / sometimes used; verify live | LOW | legacy mirrors |
| `g` then `u` | **Go to a user** (focus the "go to user" jump) | LOW | legacy dialog |
| `g` then `f` | **Following** feed (where present) | LOW | community |
| `g` then `t` | **(legacy) go to a user** | LOW | legacy |
| `g` then `s` | **Settings** | LOW | legacy/community |
| `g` then `d` | **Display** settings | LOW | legacy/community |

> Implementation note for conflict-avoidance: because `g` is a **prefix**, X enters a short-lived "waiting for
> second key" state after `g`. If our extension binds a bare `g`, we will break every `g …` chord. Avoid bare
> `g`.

### A.4 Direct Messages (only active inside the Messages view)

| Key | What X does | Confidence | Source |
|---|---|---|---|
| `n` | New message (within DMs) | MEDIUM | legacy dialog |
| `Enter` | Send / open conversation (context dependent) | LOW | inferred |

---

## B. The focused / highlighted-post DOM model

This is the load-bearing part for the extension. Two **distinct** notions of "focused" exist on X — do not
conflate them:

### B.1 The two `tabindex` states on a tweet article (STATIC page anatomy) — HIGH

Each rendered post is a single element that is **simultaneously**:

```
article[data-testid="tweet"][role="article"]
```

i.e. `[data-testid="tweet"]` **and** `article[role="article"]` are the **same node**. Its `tabindex`
encodes its role on the page:

| `tabindex` | Meaning | Where seen |
|---|---|---|
| `tabindex="0"` | A **timeline post** — keyboard-navigable, part of the `j`/`k` cursor sequence. | Home / lists / search / profile timelines |
| `tabindex="-1"` | The **page-level focused post** (the main subject post on a `/{user}/status/{id}` permalink page). Programmatically focusable but **not** in the Tab order. | Status / thread pages |

Confirmed independently by multiple live-DOM tools:
- **Control Panel for Twitter** (`insin/control-panel-for-twitter`, `script.js`): treats
  `$tweet.tabIndex == -1` as the **FOCUSED_TWEET** (the permalink main tweet), and uses
  `[data-testid="tweet"][tabindex="0"]` vs `[tabindex="-1"]` to target timeline vs focused tweets in its CSS.
- **kpbb** (`carcinocron/kpbb`, screenshot tool): the canonical tweet selector is
  `main section article[tabindex="0"][role="article"]`.
- **Twitter-AI-Illust-Scanner** (`yakisova41/...`): timeline tweets =
  `article[tabindex="0"]`, the status-page main tweet = `article[tabindex="-1"]`.
- Multiple Greasy Fork userscripts iterate `document.querySelectorAll('article[tabindex="0"]')` to get the
  visible timeline posts.

So: **"all the navigable timeline posts" = `article[data-testid="tweet"][tabindex="0"]`.**

### B.2 The DOM cell wrapper — HIGH

Each timeline post is wrapped in a virtualized **cell**:

```
div[data-testid="cellInnerDiv"]
  > div
    > div > div > article[data-testid="tweet"][role="article"][tabindex="0"]
```

(CPFT iterates `$timeline.children` and finds the article via `:scope > div > div > div > article`; it also
anchors "Show N posts" via `$el.closest('[data-testid="cellInnerDiv"]')`.) The `cellInnerDiv` is the
**virtual-list row**; it is *recycled* as you scroll (React virtualization), so node identity is **not**
stable — never cache a node reference across scroll; re-query each time. The timeline container itself is
roughly `div[data-testid="primaryColumn"] section > h1 + div[aria-label] > div` (CPFT `Selectors.TIMELINE`).

### B.3 What `j`/`k` actually moves (the keyboard cursor) — HIGH (mechanism) / see note 08 for code

When you press `j`/`k`, X does **not** add a special "is-current" class or a custom `data-*` flag to the post.
Instead it uses **native focus + ARIA active-descendant**:

1. X moves **DOM focus** onto the navigated `article[tabindex="0"]` (it is focusable precisely because of
   `tabindex="0"`), and/or sets `aria-activedescendant` on the timeline's focus container to that article's
   `id`.
2. The visible **highlight is the browser's `:focus-visible` outline** (the blue/accent focus ring), not a
   bespoke class. There is **no** `.is-focused`, no `data-focused`, no blue-ring class to match on — the ring
   is a `:focus-visible` style. (This is why custom Vim extensions like `twittervim` draw their **own**
   outline via inline `el.style.outline = '4px solid #1d9bf0'` — they cannot rely on a class.)
3. The cursor wraps the **same `article[tabindex="0"]` nodes** enumerated in B.1; `j` advances to the next in
   document order that is on-screen/loadable, `k` the previous.

**Reading "the currently focused tweet article" from the DOM** (canonical algorithm, fully fleshed out in
`08-vim-twitter-extensions.md` §reading-the-cursor):

```js
const TWEET = 'article[data-testid="tweet"]'; // === article[role="article"]

function getFocusedTweet() {
  // 1) ARIA active-descendant: the timeline focus owner points at an element id
  const owner = document.querySelector('[aria-activedescendant]');
  const adId = owner?.getAttribute('aria-activedescendant');
  if (adId) {
    const el = document.getElementById(adId);
    const art = el?.closest(TWEET);
    if (art) return art;
  }
  // 2) document.activeElement — j/k focus lands on (or inside) the article
  const active = document.activeElement;
  if (active instanceof Element) {
    const art = active.closest(TWEET);
    if (art) return art;
  }
  // 3) CSS :focus-within on a tweet article
  const fw = document.querySelector(`${TWEET}:focus-within`);
  if (fw) return fw;
  // 4) fallback: the timeline post whose box has the largest visible area
  return largestVisibleTweet(); // see note 08
}
```

Notes on robustness:
- Prefer the `tabindex="0"` form for **timeline** focus; on a status page the focused main tweet is
  `tabindex="-1"` and `document.activeElement` is the more reliable signal there.
- Because cells are virtualized, after scroll the previously-focused node may be **detached**; always re-query.
- The article `id` (referenced by `aria-activedescendant`) is an opaque React id like `id__<random>` — do not
  parse meaning from it; only use it to `getElementById` then `closest(article)`.

### B.4 Identifying the post under the cursor (which tweet is it?) — HIGH

Once you have the focused `article`, extract identity the same way as elsewhere in this codebase (see
`03-tweet-extraction.md`):
- Permalink/id: `article a[href*="/status/"]` → parse `/{screen_name}/status/{tweetId}`.
- Author handle: the status link's path segment, or the user link `a[role="link"][href^="/"]`.
- Action buttons live in `article ... div[role="group"]` (reply/repost/like/bookmark/share), which is how
  the single-key actions (`l`, `r`, `t`, `b`) resolve their target — they act on the **focused** article's
  `role="group"`.

---

## C. Conflict-avoidance recommendations for this extension

1. **Never bind bare `g`** — it is X's "go to" prefix; binding it breaks all `g h / g e / g n / g m / g p …`
   chords. (HIGH)
2. **Avoid bare** `j k . o / s n l f r t b m u ? Space Enter Backspace` on the timeline — all are (or have
   been) X document-level shortcuts. (HIGH for the core set; LOW-confidence ones like `f`/`u`/`s` are *legacy*
   but cheap to keep clear.)
3. **Prefer modifier chords** (e.g. `Alt+…`, `⌘/Ctrl+…`) or **scope key handling to our own UI** and only
   `stopPropagation()` within it — X's shortcuts are bare keys, so a modifier guarantees no collision. (HIGH)
4. **Reuse X's native `j`/`k` cursor** rather than implementing our own where possible: let X move focus, then
   *read* the focused article via the §B.3 algorithm. This avoids fighting X's virtualization and keeps one
   cursor on screen. (See note 08 for the full trade-off discussion — "reuse native cursor" vs "own cursor".)
5. **Match the typing-guard X uses**: ignore our shortcuts when
   `document.activeElement` is an `input`/`textarea`/`[contenteditable]`/`[role="textbox"]`, and guard IME via
   `compositionstart`/`compositionend`. (HIGH)
6. **Do not depend on a "focused" class / blue-ring class** — there isn't one; the ring is `:focus-visible`.
   Read focus state, don't match a class. (HIGH)
7. For **mute**, do not rely on a top-level `u` key on current X — drive the **"..." → "Mute"** caret menu
   item instead (`09-caret-menu-dom.md`). (HIGH)

---

## D. Sources

Primary / live-DOM (HIGH):
- `insin/control-panel-for-twitter` — `script.js`: `Selectors.TWEET = '[data-testid="tweet"]'`,
  `Selectors.TIMELINE`, `isFocusedTweet = $tweet.tabIndex == -1`, `cellInnerDiv` anchoring,
  `[data-testid="tweet"][tabindex="0"]` vs `[tabindex="-1"]` CSS, `div[data-at-shortcutkeys]`
  (the container the `?` dialog/app renders into). Cloned `--depth 1` 2026-06-08.
- `carcinocron/kpbb` — `functions/twitter_ss/index.js`: tweet selector
  `main section article[tabindex="0"][role="article"]`.
- `yakisova41/Twitter-AI-Illust-Scanner` — `src/contentScripts/main_world/handleStatusPage.ts`:
  timeline `article[tabindex="0"]`, status-page main `article[tabindex="-1"]`.
- Greasy Fork userscript archives (`beak2825/greasyfork_archives`): `document.querySelectorAll('article[tabindex="0"]')`.
- The live X web client (x.com) — press `?` to render the dialog (DOM container `div[data-at-shortcutkeys]`).

Behavior manifests / community (MEDIUM):
- `SsebowaDisan/maia-computer` — `packages/os/manifests/x.yml` `keyboard_shortcuts:` block
  (`N`, `/`, `L`, `T`, `R`, `B`, `J/K`, `Enter`, `G then H/E/N/M/P`, `?`) and `data-testid` selectors.
- `edisonmliranzo/openclawbook` — `FEATURES.md` (`N`, `L`, `R`, `C`, `/`, `G H/E/N/M`).
- `nirholas/XActions` — `docs/xactions-reference.md` (action mirror: `home()`, `explore()`,
  `showKeyboardShortcuts()`).

Legacy / unverifiable-on-current-X (LOW):
- Historic Twitter help "Keyboard shortcuts" dialog wording (`f` = favorite, `m` = New Direct Message,
  `u` = Mute user, `s`/`/` = search, `o` = expand, `.` = load new) — preserved only in community mirrors;
  the official help page (`help.x.com` / `help.twitter.com/.../keyboard-shortcuts`, legacy article 20171141)
  now **404s / has been repurposed** (verified via the Wayback CDX index 2026-06-08). **Re-validate against
  the live `?` dialog before shipping anything that depends on the LOW rows.**
