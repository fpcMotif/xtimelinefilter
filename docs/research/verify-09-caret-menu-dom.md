# Adversarial verification — 09 "Tweet caret (...) menu DOM for driving actions"

Verification date: 2026-06-08
Method: independently re-cloned/fetched every cited primary source, grepped exact line numbers,
and cross-checked behavioral claims (what X natively binds each action to) against *additional*
independent sources (a third userscript, GitHub code search, web search of X help + secondary
reporting). Goal was to REFUTE; defaulting to "uncertain" where not corroborated.

Sources re-examined first-hand:
- `insin/control-panel-for-twitter` `script.js` — re-cloned `--depth 1` to `/tmp/cpft-verify`
  (8322 lines, 300.9K). All cited line numbers re-grepped.
- lucahammer "delete-tweets" gist — re-fetched raw to `/tmp/lucahammer-gist.js`.
- **NEW independent source**: `EXXC3PT10N/twitter-helper` `content.js` (one-click block userscript) —
  fetched raw. Provides a *third* independent witness to the caret→block→confirm DOM chain.
- **NEW**: GitHub code search (`gh search code`) for `AddRemoveFromLists` across X clients.
- **NEW**: `becketto.com/unfollow-script` (auto-confirm-unfollow userscript).
- X help (`help.x.com/.../blocking-and-unblocking-accounts`) — **Cloudflare-gated to curl** (the
  source doc already flagged this); behavior corroborated via web search summary + secondary press.
- mgrep `--web` was unavailable (monthly quota 429); substituted the WebSearch/WebFetch fallback.

---

## CLAIM 1 — caret button selector. VERDICT: CONFIRMED

`article[data-testid="tweet"] [data-testid="caret"]` (also `[aria-label="More"]`,
`aria-haspopup="menu"`); scope to the tweet element and `.click()`.

- lucahammer gist line 38, **verbatim**:
  `const more = '[data-testid="tweet"] [aria-label="More"][data-testid="caret"]'` — then
  `caret.click()` (line 68). Exactly as claimed.
- cpft `script.js:4007-4008`, **verbatim**:
  ```js
  function addCaretMenuListenerForQuoteTweet($tweet) {
    let $caret = ($tweet.querySelector('[data-testid="caret"]'))
  ```
  The cited line range (~4007-4009) is exact.
  - Nuance: this specific function is for **quote tweets**; cpft scopes the caret to `$tweet`
    exactly as the claim's "scope to the tweet element" prescribes — so the cite is fair, but a
    reader should know 4007 is the quote-tweet path (cpft has many caret sites, all scoped).
- **Third independent witness** (`twitter-helper/content.js:27,33`):
  `event.currentTarget.closest('article[data-testid="tweet"]')` then
  `tweetElement.querySelector('button[data-testid="caret"]')` → `simulateClick(moreButton)`.
  Note it observes the caret is a `<button>` (claim says `<button>`/`<div role="button">` — fine).

Triangulated across three independent codebases. No refutation found.

---

## CLAIM 2 — menu renders async in body-level `#layers` portal as `[data-testid="Dropdown"]`
(desktop) / `[data-testid="sheetDialog"]` (mobile), rows `[role="menuitem"]`; NOT a child of the
article; query the document and wait. VERDICT: CONFIRMED

- cpft `script.js:3975`, verbatim: `getElement(`#layers div[data-testid="Dropdown"] ${linkSelector}`…`.
- cpft `script.js:8014`, verbatim: `#layers div[data-testid="Dropdown"] ${dropdownItemSelector}`.
- cpft `script.js:4450`, verbatim:
  `[data-testid="${desktop ? 'Dropdown' : 'sheetDialog'}"] [role="menuitem"] [dir]`.
- cpft `script.js:5823`, verbatim:
  `getElement(mobile ? '[data-testid="sheetDialog"]' : '[role="menu"] [data-testid="Dropdown"]'…`.
  (Note: the cited "~5823 switches container via desktop?…" is right; the variable here is
  `mobile`, with the same desktop/mobile semantics.)
- cpft `script.js:3392-3406`: explicit comment "Twitter displays popups in the **#layers**
  element" + `getElement('#layers'…)`. Direct evidence the menu is a body-level portal, **not** a
  child of the article.
- Rows: cpft uses `div[role="menuitem"]` repeatedly (5827, 5855); lucahammer waits on
  `'[role="menuitem"]'` (gist line 69). Async wait confirmed: lucahammer `waitForElemToExist`
  (MutationObserver, gist 17-35) and cpft `getElement` both wait. The claim's "must wait" and
  "query the document, not the article" are both directly supported.

No refutation found. The only correction is cosmetic: the variable at 5823 is `mobile`, the value
is `[role="menu"] [data-testid="Dropdown"]` (role-anchored), but that *is* the Dropdown.

---

## CLAIM 3 — only Block has a stable testid (`[data-testid="block"]`); Mute / Not-interested /
Lists / Follow have none and must be matched by icon-path or localized text. VERDICT: CONFIRMED

- cpft `script.js:2295`, verbatim: `BLOCK_MENU_ITEM: '[data-testid="block"]',` — exact line.
  Used by fastBlock (5937, 5959, 5964) and `:scope > div > div > div > ${BLOCK_MENU_ITEM}` (4025).
- **Independent confirmation** (`twitter-helper/content.js:41`):
  `document.querySelector('div[data-testid="block"]')` — same testid, different author. Strong.
- Absence of stable testids for the other four: I grepped cpft for any
  `data-testid="mute"`/`"follow"`/`"notInterested"`/`"unfollow"` *menu-item* testids and found
  none used for the dropdown rows; cpft matches those via localized `getString(...)` text and/or
  SVG-paths instead (see Claim 6). The GraphQL dumps (`fa0311`, `twitter-api-client`) carry **no
  DOM testids** at all (confirmed: they are GraphQL/HTTP clients) — so the claim's statement that
  no stable testid was found there is true *because those repos have no DOM layer*, which is the
  right reason but worth stating plainly.

No refutation. (Minor: "follow buttons" elsewhere in X DO carry `data-testid$="-follow"` /
`-unfollow`, but those are profile/hover buttons, NOT the caret-menu row — the claim is about the
menu item and is correct.)

---

## CLAIM 4 — Block ALWAYS shows a confirmation sheet, committed via
`[data-testid="confirmationSheetConfirm"]`. VERDICT: CONFIRMED (selector: high; "ALWAYS": high-ish)

- cpft fastBlock `script.js:5952,5954`, verbatim:
  ```js
  if (blockMenuItemSeen && blockMenuItemClicked && $popup.querySelector('[data-testid="confirmationSheetConfirm"]')) {
    ($popup.querySelector('[data-testid="confirmationSheetConfirm"]')).click()
  ```
  (cited ~5951-5968; the confirm logic is at 5952-5957, within range.)
- lucahammer gist line 77: `confirmation = document.querySelector('[data-testid="confirmationSheetConfirm"]')`
  then `.click()` — the same generic confirm convention. Confirmed.
- **Independent confirmation** (`twitter-helper/content.js:50`): block flow is unconditionally
  `caret → div[data-testid="block"] → button[data-testid="confirmationSheetConfirm"]` → click.
  This author wrote the flow assuming the confirm **always** appears (no "if present" branch for
  block — it `console.error`s if the confirm button is missing). Three independent code witnesses.
- Behavioral "ALWAYS": X's own help ("Blocking on X") and secondary reporting (tweetdelete.net,
  kgw.com block-feature coverage) describe a confirmation pop-up requiring a second "Block"
  click. The `*Confirm`/`confirmationSheet*` convention is X-wide (also used for unfollow,
  unretweet, delete — see becketto unfollow script and lucahammer unretweetConfirm at gist 61).
  - Caveat: cpft's *code* alone only proves "if a confirm appears, click it"; it is the
    twitter-helper unconditional flow + X help wording that elevate "ALWAYS" to high confidence.
    I could not load help.x.com directly (Cloudflare), so the "ALWAYS" rests on one userscript's
    unconditional design + secondary descriptions, not an official screenshot. Rated CONFIRMED but
    note the "ALWAYS" is behavioral-corroborated, not officially-screenshotted.

---

## CLAIM 5 — Not-interested & Follow apply immediately (no confirm); Mute usually immediate but
may confirm on some builds ("confirm-if-present" probe); Add/remove-from-Lists opens a
`[role="dialog"]` list-picker MODAL (not yes/no), toggle a row, optionally commit. VERDICT: UNCERTAIN
(structure CONFIRMED; the precise per-action confirmation behaviors are NOT primary-source-verified)

- Lists = modal `[role="dialog"]` (not a confirm sheet): structurally consistent with the
  whole ecosystem and with `04-x-lists-backends.md` §B.3-B.5, but the dialog's **internal**
  testids/Done-vs-immediate behavior are explicitly flagged medium even in the source doc and I
  found **no independent primary source** pinning them. The toggle-idempotently-via-aria-checked
  pattern is sound design, not externally confirmed for X's current list dialog.
- "Not-interested collapses to an inline Undo card, no sheet": plausible and widely-described as a
  feedback signal (X help "About our approach to recommendations"), but I found **no primary
  source** confirming the exact "Undo card, no confirmation sheet" mechanics. Community reports
  even dispute whether the signal persists. → uncertain (matches the claim's own "medium").
- "Follow applies immediately, no confirmation": consistent with X UX, but note the *inverse*
  (Unfollow) DOES confirm via `confirmationSheetConfirm` (becketto unfollow script, confirmed).
  Follow-with-no-confirm is not independently primary-sourced here. → uncertain.
- "Mute may confirm on some builds": this is a hedge; the "confirm-if-present" probe is correct
  *engineering* regardless, but the factual claim "some builds confirm Mute" is not corroborated
  by any source I could reach. → uncertain.
- The overall "confirm-if-present probe is correct for all five" engineering recommendation is
  sound and I do not refute it; but the per-action *facts* it rests on are mostly project-internal.

Net: the **architecture** of claim 5 is fine and the Lists=modal distinction is correct; the
specific confirmation behaviors of Not-interested/Follow/Mute are **uncertain** (only the source
doc asserts them; primary sources neither confirm nor refute). Keep "verify live."

---

## CLAIM 6 — labels are localized; prefer testid > icon SVG-path > structural position >
localized text. VERDICT: CONFIRMED (with one CORRECTION about the Svgs.MUTE example)

- Localization is strongly confirmed:
  - cpft ships **44** per-locale tables (I counted `^  xx: {` = 44; claim said "~43" — close,
    minor undercount). Locales include ar, bg, bn, ca, cs, da, de, el, en, es, … (verified the
    exact alphabetical run the claim lists). `getString(...)` is used 59 times for text matching.
  - REPOST values match the claim verbatim: `ar='إعادة النشر'`, `bg='Препубликуване'`,
    `ca='Republicació'` (cpft 307/352/443). Exact.
  - **GitHub code search confirms `AddRemoveFromLists` across multiple X clients**:
    - TwidereX-iOS: `Common.Controls.User.Actions.AddRemoveFromLists` = "Add/remove from Lists"
      (en), with real localizations: de "Zu Listen hinzufügen/entfernen", ja "リストに追加/削除",
      ar "أضف/أزل من القوائم", es "Agregar/remover de Listas", ca "Afegeix/elimina de les llistes",
      tr "Listelere Ekle/Kaldır", zh-Hans "从列表中添加或删除", pt-BR "Adicionar/remover das Listas",
      gl "Engadir/retirar das Listas". Directly proves "matching raw English text is unsafe."
    - Official Android (decompiled `EduardoC3677/com-twitter-android`):
      `com.x.navigation.AddRemoveFromListsArgs` with `targetUserId` — confirms the label key
      `AddRemoveFromLists` is X's own navigation target. Exactly as claimed.
- The Mute SVG path `M18 6.59V1.2…`: cpft `Svgs.MUTE` (script.js:2323) begins **exactly**
  `M18 6.59V1.2L8.71 7H5.5…` — the prefix in the claim is correct and a valid locale-proof anchor.

CORRECTION (important nuance): the claim says **"cpft matches actions like Mute and Retweet by
SVG path (Svgs.MUTE…)"**. That over-states what cpft does with *Svgs.MUTE specifically*:
  - cpft uses `Svgs.MUTE` to **RENDER** an icon on a menu item it *injects* (`script.js:3986`
    `$addMutedWord.querySelector('svg').innerHTML = Svgs.MUTE`), and `Svgs.RETWEET` likewise to
    render its own toggle (4100). These are **not** used to *match* the native Mute/Retweet rows.
  - cpft DOES use the SVG-path-*matching* **technique** heavily — but on *other* selectors:
    `SORT_REPLIES_PATH` (2309), `X_LOGO_PATH` (2314), tweet-type detection via
    `svgPath.startsWith('M7.471 21H…')`/`startsWith('M13 21l…')` (5723-5725), a retweet-state
    switch icon `path[d="M3 2h18.61l-3.5 7…"]` (5928).
  - So: the *strategy* "match by icon SVG-path prefix" is real and cpft-proven; but the specific
    sentence "cpft matches Mute by Svgs.MUTE path" is **not** literally what the code does (that
    path is for rendering). Use `path[d^="M18 6.59V1.2"]` as YOUR matcher by all means — just
    don't cite cpft as already doing native-Mute-by-path matching.

Verdict CONFIRMED for the localization claim and the priority order; one factual correction on the
Svgs.MUTE-as-matcher example, and a trivial count fix (44 not 43 locale tables).

---

## CLAIM 7 — codebase already has core hooks in `DriverSelectors`; only a few additions needed.
VERDICT: CONFIRMED

Re-read `src/content/selectors.ts` directly. Present and exactly as claimed:
```ts
DriverSelectors = { CARET:'[data-testid="caret"]', MENU:'[role="menu"]',
  MENUITEM:'[role="menuitem"]', DIALOG:'[role="dialog"]',
  CHECKBOX:'[role="checkbox"], input[type="checkbox"]',
  SAVE:'[data-testid="confirmationSheetConfirm"]' }
ADD_TO_LISTS_TEXT = /add\s*\/\s*remove.*lists|add to list/i
```
All five named hooks (CARET, MENU, MENUITEM, DIALOG, SAVE) and ADD_TO_LISTS_TEXT exist verbatim.
The listed gaps (add DROPDOWN `[data-testid="Dropdown"]`, SHEET `[data-testid="sheetDialog"]`,
BLOCK `[data-testid="block"]`, Mute icon prefix `'M18 6.59V1.2'`, localized-text fallbacks) are
accurate — none of those five additions currently exist in the file. No refutation.

---

## Summary table

| # | Claim (gist) | Verdict | Note |
|---|---|---|---|
| 1 | caret = `[data-testid="tweet"] [data-testid="caret"]`, scope+click | CONFIRMED | 3 independent code witnesses |
| 2 | menu = async `#layers` portal `Dropdown`/`sheetDialog`, `menuitem`, wait | CONFIRMED | exact cpft lines verified |
| 3 | only Block has stable testid `[data-testid="block"]` | CONFIRMED | cpft 2295 + twitter-helper 41 |
| 4 | Block ALWAYS confirms via `confirmationSheetConfirm` | CONFIRMED | selector triangulated; "ALWAYS" behaviorally (not officially-screenshot) corroborated |
| 5 | per-action confirm behaviors (NotInt/Follow immediate; Mute maybe; Lists=modal) | UNCERTAIN | Lists=modal structurally OK; the rest only project-internal, no primary source |
| 6 | labels localized; testid>icon>position>text | CONFIRMED | + CORRECTION: Svgs.MUTE is used to *render*, not *match*; 44 (not 43) locale tables |
| 7 | DriverSelectors already has core hooks | CONFIRMED | verified verbatim in selectors.ts |

## Primary sources used (exact)
- cpft: https://github.com/insin/control-panel-for-twitter (script.js lines 2295, 2323, 3392-3406,
  3975, 3986, 4007-4008, 4025, 4100, 4450, 5723-5725, 5823, 5827-5855, 5928, 5952-5957, 8014; 44 locale tables ~285-2205)
- lucahammer gist: https://gist.github.com/lucahammer/1aa16b4d3c1fb04035839da5ef699d65 (lines 17-35, 38, 61, 67-69, 77)
- twitter-helper (independent): https://github.com/EXXC3PT10N/twitter-helper (content.js lines 27,33,41,50)
- becketto unfollow script (confirms unfollow uses confirmationSheetConfirm):
  https://becketto.com/unfollow-script
- AddRemoveFromLists across clients (gh search code): TwidereProject/TwidereX-iOS Localizable.strings;
  EduardoC3677/com-twitter-android com/x/navigation/AddRemoveFromListsArgs.smali
- X help (Cloudflare-gated, summarized via web search): https://help.x.com/en/using-x/blocking-and-unblocking-accounts
- X recommendations help: https://help.x.com/en/rules-and-policies/recommendations
- selectors.ts: /Users/martinfan/devv/xtimelinefilter/src/content/selectors.ts
