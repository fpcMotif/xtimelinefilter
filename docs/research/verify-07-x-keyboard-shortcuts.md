# Adversarial verification — "X native keyboard shortcuts + focused-post model" (note 07)

Method: independent re-check of each claim against primary sources. Tried to REFUTE; defaulted to "uncertain" where uncorroborated. Tooling: `curl` (official X help, Wayback CDX/snapshots), `gh search code` / `git clone --depth 1` (shipped extension & manifest code), local notes 07/08/09. `mgrep --web` quota was exhausted (HTTP 429), so web discovery fell back to `gh search code` over real DOM captures — which turned out to be a stronger primary source than a blog mirror.

Date of verification: 2026-06-08.

---

## Headline new evidence (changes several verdicts)

`gh search code 'data-at-shortcutkeys'` surfaced **a captured snapshot of Twitter's own HTML** in `wilsonzlin/minify-html` (`bench/inputs/Twitter`). It contains X's live shortcut map serialized into the attribute itself:

```
<div id="doc" data-at-shortcutkeys="{
  "Enter":"Open Tweet details",
  "o":"Expand photo",
  "/":"Search",
  "?":"This menu",
  "j":"Next Tweet",
  "k":"Previous Tweet",
  "Space":"Page down",
  ".":"Load new Tweets",
  "gu":"Go to user…"
}" class="">
```

Source: https://github.com/wilsonzlin/minify-html/blob/master/bench/inputs/Twitter

This is a **primary-source DOM artifact from X itself** (not a community mirror). It independently confirms `j/k/Enter///?/Space/./o` and the `g`-prefix (`gu`=Go to user). It is the closest thing to the now-dead official help page that I could cite from a fixed URL. Caveats: it is an older capture (uses "Tweet" wording, pre-rename), and it only enumerates the subset X chose to expose in that attribute (not the full `?` dialog).

`data-at-shortcutkeys` itself is **not X-specific** — it is a generic a11y attribute also emitted by reveal.js / JAWS-aware slide decks (`d.body.setAttribute('data-at-shortcutkeys', …)` appears in dozens of R/Shiny slide repos) and is interned as an atom in Firefox/Waterfox `StaticAtoms.py`. So the attribute proves "X uses a standard shortcut-keys layer," not "this attribute is X's namespace." Also note the captured attribute is on `div#doc` (and the a11y convention puts it on `<body>`), **not** on a dedicated "app container div" — minor correction to claim 8's phrasing.

---

## Per-claim verdicts

### Claim 1 — Official help page is gone; `?` dialog is the only authoritative live source — CONFIRMED (with one source correction)
- `https://help.x.com/en/using-x/keyboard-shortcuts` → HTTP **403** Cloudflare interstitial (`<title>Just a moment...</title>`), with both default and realistic browser UA. Not a clean 404, but unfetchable via curl as claimed.
- `https://help.twitter.com/en/using-twitter/keyboard-shortcuts` → 403 (same Cloudflare).
- Wayback CDX for `help.twitter.com/en/using-twitter/keyboard-shortcuts`: **exactly one** capture (`20250824094510`), statuscode **301**. Following it lands on `help.x.com/en/using-twitter/keyboard-shortcuts` → **404**. CDX for `help.x.com/en/using-x/keyboard-shortcuts`: **empty `[]`** (zero captures). Both match the claim.
- Legacy ID `support.twitter.com/articles/20171141`: live 301 → `https://help.x.com/articles/20171141` → 403. CDX shows the ID was already a 302 redirect as far back as 2015 (`20150908005004` 302 → article `20170425`). The current/archived rendering of `20171141` is **"Ad Policy: Hate content, sensitive topics, and violence"** — confirming ID reuse / no longer a shortcuts page.
- CORRECTION to the cited evidence: the claim cites the 2016 snapshot as if it documents shortcuts, but the 2016 `id_` snapshot of `20171141` already renders as the Ad-Policy page (52 KB, `<h1>Ad Policy…</h1>`, zero shortcut-key strings). So that URL **supports the ID-reuse point** but does **not** itself contain the legacy key list. The legacy shortcut documentation is effectively unrecoverable from that ID.
- Net: verdict CONFIRMED. Practical consequence (re-validate in the live `?` dialog) stands.

### Claim 2 — Core single-key shortcuts j/k/Enter/n/l/r/t/b///? — CONFIRMED (two corrections)
- maia `x.yml` `keyboard_shortcuts` block fetched verbatim: `new_post: N`, `search: /`, `like: L`, `repost: T`, `reply: R`, `bookmark: B`, `navigate: J/K`, `open_post: Enter`, `show_shortcuts: ?`. Exact match. Source: https://github.com/SsebowaDisan/maia-computer/blob/main/packages/os/manifests/x.yml
- X-DOM capture confirms `j`=Next Tweet, `k`=Previous Tweet, `Enter`=Open Tweet details, `/`=Search, `?`=This menu. (`wilsonzlin/minify-html`.) Strong independent corroboration.
- CORRECTION 1: openclawbook `FEATURES.md` lists `R` = **Repost** and `C` = **Comment** — it does **NOT** map `R` to reply. The research note's gloss "openclawbook: N/L/R/C//" is fine as a key list, but `R`→reply is **only** in maia, not openclawbook. So `r`=reply is single-sourced (maia), `t`=repost is double-sourced (maia=T-repost; openclawbook=R-repost — and the two disagree on which letter reposts).
- CORRECTION 2: openclawbook's block is titled **"Keyboard Shortcuts (Coming Soon)"** — i.e. aspirational/planned for that app, not observed live X behavior. It is weak corroboration of X's real bindings; it reads like the author transcribing X's known shortcuts into a roadmap. Treat openclawbook as LOW-weight.
- Verdict CONFIRMED for the core set; the strongest evidence is maia + the X-DOM capture, not openclawbook.

### Claim 3 — `g` is a "go to" PREFIX (g h/e/n/m/p; g l, g b medium) — CONFIRMED (partial)
- maia `x.yml`: `go_home: "G then H"`, `go_explore: "G then E"`, `go_notifications: "G then N"`, `go_messages: "G then M"`, `go_profile: "G then P"`. Exact match.
- X-DOM capture independently shows `"gu":"Go to user…"` — a real two-key `g`+`u` chord, directly proving `g` is a prefix.
- openclawbook: `G H / G E / G N / G M` (in the "Coming Soon" block).
- CORRECTION: `g l` (Lists) and `g b` (Bookmarks) are **NOT in either cited source** — neither maia nor openclawbook mentions `go_lists`/`go_bookmarks`/`G L`/`G B`. They remain MEDIUM/legacy-only (as the claim already flags) but are uncorroborated by the two URLs cited. Implication "never bind bare `g`" is sound.
- Verdict CONFIRMED for the prefix and h/e/n/m/p; UNCERTAIN for g l / g b specifically.

### Claim 4 — m = compose DM (not mute); u = mute (legacy, likely removed) — UNCERTAIN (intent corroborated, key bindings not independently re-confirmable)
- The "Mute is a caret-menu item, not a top-level key" half is well-supported: local note 09 lists **Mute** as a `[role="menuitem"]` row in the `...` Dropdown, and the confirmed live caret-menu screenshot (in the task context) shows "Mute" as a dropdown item. So "m is NOT mute" is consistent.
- BUT the positive bindings `m`=compose-DM and `u`=mute-user are **traceable only to legacy dialog wording** (note 07 cites "legacy dialog"). The X-DOM capture I found does **not** include `m` or `u` (it only enumerates 9 keys). The official page is dead. CPFT `script.js` has **no** single-key `m`/`u` handler (it references muted-keyword settings, not a `u` mute hotkey). insin/control-panel-for-twitter `script.js` was cited but does not contain a DM/mute keybinding to confirm `m`/`u`.
- Could not refute, could not independently confirm. Verdict UNCERTAIN. The claim's own MEDIUM(`m`)/LOW(`u`) confidence is appropriate; the reliable mute path is the caret menu.

### Claim 5 — timeline post = `article[data-testid="tweet"][role="article"][tabindex="0"]` (same node); permalink main = `tabindex="-1"` — CONFIRMED
- CPFT `script.js`: `TWEET: '[data-testid="tweet"]'` (line 2312); uses `[data-testid="tweet"][tabindex="0"]` vs `[data-testid="tweet"][tabindex="-1"]` throughout CSS (lines 4458/4463, 4523/4525, 5144, 5250). It treats `$tweet.tabIndex == -1` as the page-level FOCUSED_TWEET (line 6463: `isFocusedTweet = $tweet.tabIndex == -1` → `itemType = 'FOCUSED_TWEET'`). And line 7682: `document.querySelector('article[data-testid="tweet"]')` — combined selector proves `data-testid="tweet"` sits on an `<article>` (same node). Source: https://github.com/insin/control-panel-for-twitter/blob/main/script.js
- kpbb selector confirmed **verbatim**: `const tweetSelector = 'main section article[tabindex="0"][role="article"]';` Source: https://github.com/carcinocron/kpbb/blob/main/functions/twitter_ss/index.js
- CORRECTION: the cited `Twitter-AI-Illust-Scanner` path `src/contentScripts/main_world/handleStatusPage.ts` now **404s** (file moved/renamed/removed); that specific source URL is dead. The claim's substance is still double-sourced (CPFT + kpbb), so verdict CONFIRMED, but drop/repair the Illust-Scanner citation.

### Claim 6 — j/k highlight uses NATIVE focus + aria-activedescendant + :focus-visible (no bespoke is-focused class) — CONFIRMED (within the cited sources)
- Local note 08 documents the exact read order: `aria-activedescendant` → `getElementById` → `closest('article[data-testid="tweet"]')`; fallback `activeElement.closest(TWEET_SELECTOR)`; fallback `…:focus-within`; fallback largest-visible-area tweet (note 08 lines 80–92, 288–289). It explicitly states X "sets `aria-activedescendant` / `:focus-within` on the selected `article`" and that Vim extensions draw their own outline because there's no class to match (note 08).
- CPFT corroborates the focus model indirectly: FOCUSED_TWEET is detected via `tabIndex == -1`, not a class/attribute (line 6463); CPFT never queries an "is-focused" class.
- Note: I could not independently observe `aria-activedescendant` on the live DOM (no live X session in this environment), so "X sets aria-activedescendant" rests on note 08 + the general roving-tabindex pattern, not a fresh live capture. Within the cited sources the claim holds. Verdict CONFIRMED (cite note 08 + CPFT; flag that live re-verification of the activedescendant id is still advisable).

### Claim 7 — posts wrapped in `div[data-testid="cellInnerDiv"]`, recycled virtual row; don't cache node refs — CONFIRMED
- CPFT line 7497: `$showMoreLink.closest('[data-testid="cellInnerDiv"]')` then iterates `$timelineItem.parentElement.children` — exactly the "anchor Show N posts via closest(cellInnerDiv)" claim.
- CPFT line 6325: `$item.querySelector(':scope > div > div > div > article')` — the `cellInnerDiv > div > div > div > article` traversal claim, verbatim.
- React virtualization / `id__<random>` opaque ids: consistent with CPFT selectors like `[role="group"][id^="id__"]` (line 4463) and `div[id^="id__"]` (lines 5742, 5747). "Use only for getElementById then closest(article)" is sound guidance; the id format `id__…` is corroborated. Verdict CONFIRMED.

### Claim 8 — `?` dialog renders inside `div[data-at-shortcutkeys]` — CONFIRMED (with a precision correction)
- CPFT `script.js` line 4885: `div[data-at-shortcutkeys] { justify-content: center; }` — confirms CPFT targets this attribute as the live centering anchor. Source: https://github.com/insin/control-panel-for-twitter/blob/main/script.js
- Independent corroboration: the X-DOM capture shows `data-at-shortcutkeys` is present and carries the shortcut JSON (`wilsonzlin/minify-html`). So the attribute is real and X-emitted.
- CORRECTION: it is **not** a unique "X namespace." It's a generic a11y attribute (reveal.js/JAWS slide decks emit it on `<body>`; Firefox interns it as an atom). And in the X capture it sits on `div#doc`/the document root, not specifically the `?`-dialog node. So it is a fine **live anchor for the app/shortcut layer**, but the wording "the dialog renders inside div[data-at-shortcutkeys]" overstates it — the attribute marks the top-level shortcut-aware container, not the dialog itself. Verdict CONFIRMED that the attribute exists and is usable as an anchor; refine the description.

### Claim 9 — Space=page down / Shift+Space=up; `.`=load new+scroll; `o`=expand/open; `s`=search alias; `f`=like alias — MIXED (Space/./o now CONFIRMED via DOM capture; s/f UNCERTAIN; cited 2016 URL is wrong)
- **UPGRADE:** The X-DOM capture (`wilsonzlin/minify-html`) explicitly lists `"Space":"Page down"`, `".":"Load new Tweets"`, and `"o":"Expand photo"` — straight from X's own attribute. This **promotes** `Space`, `.`, and `o` from MEDIUM/legacy to CONFIRMED-by-primary-DOM. Shift+Space=up is standard browser behavior (not in the attribute, but uncontested).
- `s` (focus search alias) and `f` (like alias) are **NOT** in the DOM capture, **NOT** in maia, **NOT** independently confirmable. They remain LOW/legacy as the claim states → UNCERTAIN.
- CORRECTION to evidence: the cited `web/20160617144611/.../articles/20171141` does **not** show shortcuts — it renders as the Ad-Policy page (verified by fetching the snapshot: `<h1 class="page-title h2">Ad Policy: Hate content, sensitive topics, and violence`, zero shortcut strings). That citation should be replaced with the `wilsonzlin/minify-html` DOM capture, which actually contains the keys.
- Verdict: CONFIRMED for Space/`.`/`o` (now via primary DOM); UNCERTAIN for `s`/`f`; the 2016 URL citation is refuted as a shortcuts source.

---

## Corrections summary (actionable)

1. Claim 1/9: the `support.twitter.com/articles/20171141` 2016 snapshot is an **Ad-Policy page**, not a shortcuts page. It supports ID-reuse but must NOT be cited as the legacy key list. Replace with the `wilsonzlin/minify-html` DOM capture.
2. Claim 2: openclawbook maps `R`=Repost and `C`=Comment (not `R`=reply), and its list is labeled **"Coming Soon"** (aspirational). `r`=reply is single-sourced (maia only). Downgrade openclawbook to LOW-weight corroboration.
3. Claim 3: `g l` (Lists) and `g b` (Bookmarks) are absent from both cited sources → keep MEDIUM but mark uncorroborated. The `g`-prefix and h/e/n/m/p are solid (maia + DOM `gu`).
4. Claim 5: the `Twitter-AI-Illust-Scanner` URL `handleStatusPage.ts` now **404s** — repair or drop that citation. Substance still holds via CPFT + kpbb.
5. Claim 8: `data-at-shortcutkeys` is a **generic a11y attribute** on the top-level container (`div#doc`/`<body>`), not an X-specific namespace and not the dialog node itself. Good anchor, but tighten the wording.
6. Strong NEW primary source for the whole note: `wilsonzlin/minify-html` `bench/inputs/Twitter` — X's own DOM with `data-at-shortcutkeys` = `{Enter, o, /, ?, j, k, Space, ., gu}`.

## Sources cited (exact)
- https://help.x.com/en/using-x/keyboard-shortcuts (403 Cloudflare)
- https://help.twitter.com/en/using-twitter/keyboard-shortcuts (403 Cloudflare)
- http://web.archive.org/cdx/search/cdx?url=help.twitter.com/en/using-twitter/keyboard-shortcuts&output=json (single 301)
- http://web.archive.org/cdx/search/cdx?url=help.x.com/en/using-x/keyboard-shortcuts&output=json (empty)
- http://web.archive.org/cdx/search/cdx?url=support.twitter.com/articles/20171141&output=json (302s since 2015)
- http://web.archive.org/web/20160617144611/https://support.twitter.com/articles/20171141 (renders as Ad-Policy page)
- https://github.com/SsebowaDisan/maia-computer/blob/main/packages/os/manifests/x.yml (keyboard_shortcuts block)
- https://github.com/edisonmliranzo/openclawbook/blob/main/FEATURES.md ("Coming Soon" block; R=Repost, C=Comment)
- https://github.com/insin/control-panel-for-twitter/blob/main/script.js (tweet/tabindex/FOCUSED_TWEET/cellInnerDiv/data-at-shortcutkeys)
- https://github.com/carcinocron/kpbb/blob/main/functions/twitter_ss/index.js (main section article[tabindex="0"][role="article"])
- https://github.com/wilsonzlin/minify-html/blob/master/bench/inputs/Twitter (X DOM capture with literal data-at-shortcutkeys map) — PRIMARY
- docs/research/08-vim-twitter-extensions.md (focus read-order)
- docs/research/09-caret-menu-dom.md (Mute is a [role="menuitem"] dropdown row)
- docs/research/07-x-keyboard-shortcuts.md (the note under verification)
