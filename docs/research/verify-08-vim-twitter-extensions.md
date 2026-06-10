# Adversarial Verification — Vim-style navigation extensions/userscripts for X

**Date:** 2026-06-08
**Method:** Re-checked every claim against primary sources. Cloned the named repos at HEAD and read the exact files; corroborated X's native shortcut set from independent reference sites (help.x.com itself is behind a Cloudflare JS challenge and could not be fetched). Default verdict = "uncertain" when a sub-claim could not be independently corroborated.

**Repos cloned (depth 1):**
- `theimpostor/xkey` @ `29db8eb` (README), `src/content.ts`, `src/manifest.json`
- `CodyBontecou/twittervim` @ `7b21df2`, `src/composables/useTwitterKeyboard.ts`
- `philc/vimium` (HEAD) — `background_scripts/commands.js`, `lib/dom_utils.js`, `content_scripts/mode_normal.js`
- `brookhong/Surfingkeys` (HEAD) — `src/content_scripts/common/default.js`, `api.js`, `utils.js`

**Source-access note:** `help.x.com/en/using-x/x-keyboard-shortcuts`, `computerhope.com`, `defkey.com`, and `martech.zone` all returned Cloudflare "Just a moment…" / "Attention Required" interstitials. `mgrep --web` was quota-exhausted (HTTP 429). The X native shortcut set was instead corroborated from two independent un-gated mirrors: **quickref.me/twitter.html** and **40x50.com** (the latter surfaced via DuckDuckGo HTML), which agree key-for-key.

---

## Claim A — "xkey reuses X's native j/k cursor and only reads the selection; never moves focus"

**Verdict: CONFIRMED (with one correction to the detail).**

- README (`README.md` lines 7, 14) literally says: *"use the built-in `j`/`k` keyboard navigation to select a tweet, then use: `h` … `Shift+G` … `Shift+O` … `Shift+S`. These shortcuts are also documented in the built-in `?` keyboard shortcuts menu."* — confirms xkey relies on X's own j/k cursor and does NOT bind j/k itself.
- `findKeyboardSelectedTweet()` **is at line 807** (confirmed) and is pure read-only DOM resolution. It never calls `.focus()` to *select* a tweet. (xkey only calls `tweet.focus()` at line 264, inside the unrelated promoted-post "Show/Hide" toggle handler — not selection.)
- **Correction to the "4-stage fallback" description:** it is actually a **5-step** chain, and step 1 is richer than stated:
  1. `findActiveDescendantTweet(activeElement)` (lines 843-861): reads `getAttribute('aria-activedescendant')` → `document.getElementById(id)` → then **`activeDescendant.closest(TWEET_SELECTOR) || activeDescendant.querySelector(TWEET_SELECTOR)`** (the claim omitted the `querySelector` half).
  2. `activeElement.closest(TWEET_SELECTOR)` (line 816).
  3. **`isFocusedSingleTweetWrapper(activeElement)`** (lines 821-826) — an extra stage the claim omitted: if the focused element looks like a container (`[tabindex],[role],[aria-selected]` or has `aria-activedescendant`) and wraps exactly one usable tweet, return that tweet.
  4. `document.querySelector(`${TWEET_SELECTOR}:focus-within`)` (lines 829-831).
  5. `findPrimaryVisibleTweet()` (lines 890-900): sorts usable tweets by viewport-clipped visible area (`getViewportClippedRect` → width×height) descending, picks largest.
- `TWEET_SELECTOR = 'article[data-testid="tweet"]'` (line 34) — confirmed.
- All `isUsableTweet` gates require `isConnected && isVisible && isInViewport` (lines 839-841).

So the substance ("reads the selection, never moves focus, most robust recipe found") holds; the chain is 5 steps not 4, and step 1 also uses `querySelector`.

---

## Claim B — "twittervim implements its OWN cursor with an integer index, custom outline, and manual centering"

**Verdict: CONFIRMED (with a material caveat on the outline).**

- `currentFocusedTweetIndex` ref — line 12. Confirmed positional integer index.
- `getNavigableElements()` (lines 198-233): collects `[data-testid="tweet"]` plus `[data-testid="cellInnerDiv"]` cells whose `<button>` text matches `/^Show \d+ posts?$/i` ("Show N posts"), then sorts by `compareDocumentPosition`. Confirmed.
- `focusTweet()` (lines 258-310): draws highlight via inline `element.style.outline = '4px solid #1d9bf0'` + `outlineOffset = '-4px'` + `boxShadow`. **Caveat:** the claim implies this is unconditional. It is drawn in *both* the zen-mode (line 298) and normal-mode (line 303) branches, so effectively always — but the boxShadow differs by mode, and there is an entire `isZenMode` opacity/scale system the claim doesn't mention. Substance holds.
- `centerElementInViewport()` (lines 312-354): `requestAnimationFrame` → if `rect.bottom < 0 || rect.top > viewportHeight` (off-screen) then `scrollIntoView({behavior:'instant', block:'center'})` then a second rAF smooth-corrects; else `window.scrollBy({behavior:'smooth'})`; both guarded by `Math.abs(scrollOffset) > 10` dead-zone. Confirmed exactly.
- **Anti-pattern (positional index drifts against virtualized list):** valid. `focusNextTweet`/`focusPreviousTweet` (lines 235-256) clamp the integer index against a freshly re-queried `getNavigableElements()` every keypress; since X mounts/unmounts `article`s on scroll, the index↔element mapping is unstable. Tracking the element/status-id is the better pattern — sound.

---

## Claim C — "Both tools dispatch by scoping to the selected article and clicking stable data-testid children"

**Verdict: CONFIRMED for twittervim; PARTIALLY REFUTED for xkey.**

- **twittervim:** `clickOnFocusedTweet(sel)` does `focusedElement.querySelector(sel).click()` (lines 389-412); bound selectors are `[data-testid="reply"]` (131), `[data-testid="retweet"]` (137), `[data-testid="like"]` (143), `[data-testid="bookmark"]` (149). `openFocusedTweet()` uses `focusedElement.querySelector('a[href*="/status/"]')` then `window.location.href = link.href` (lines 414-437). Confirmed.
- **xkey:** Confirmed it uses **visible-text/aria regex**, not data-testids, for its controls:
  - `SHOW_MORE_RE = /^show more$/i` (line 44).
  - **Correction:** the Grok regex is `EXPLAIN_POST_WITH_GROK_RE = /^(explain this post|grok(?: actions)?)$/i` (line 45) — the claim wrote `/^(explain this post|grok)$/i`, omitting the optional `(?: actions)?`. xkey also matches a `data-testid` containing `grok` via `GROK_TEST_ID_RE = /grok/i` (line 46, `hasGrokTestId`).
  - **Correction:** xkey does **not** simply `.click()` the referenced sub-tweet link. `findReferencedTweetUrl()` parses `a[href]` for a `/{user}/status/{id}` whose `statusId !== ownStatusId`, then **navigates via `window.location.assign(referencedTweetUrl)`** (line 687). Only the *card* fallback (`referencedTweetCard?.click()`, line 691) is a click. So "opens sub-tweets by parsing a[href] for a differing status id" is right; "clicks" is wrong for the primary path.
- **"These four action-bar data-testids are stable":** Plausible and widely relied upon, but note the well-documented X behavior that `like`↔`unlike` and `bookmark`↔`removeBookmark` **toggle their testid by state**, and `retweet`↔`unretweet` likewise. twittervim only ever targets the un-acted state (`like`/`retweet`/`bookmark`), so re-pressing on an already-liked post finds nothing. Marking the "stable" assertion **uncertain** in the strict sense.

---

## Claim D — "Mute/Block/'Not interested' have NO per-action data-testid; none of the studied tools implement them; require opening the caret menu"

**Verdict: REFUTED on 'no keyboard binding'; CONFIRMED on tool coverage + caret-menu mechanism.**

- **REFUTED sub-claim:** X **does** expose native single-key bindings for mute and block. Two independent references agree: quickref.me/twitter.html and 40x50.com both list under *Actions*: `u = mute account`, `b = block account` (alongside `n` new post, `l` like, `r` reply, `t` repost/retweet, `m` DM, `enter` open, `o` expand photo, `/` search, `ctrl/cmd-enter` send). So mute/block are reachable from the keyboard on the focused tweet without manually opening the caret menu (X opens/confirms the flow itself). "Not interested" has no documented native key — that part stands.
- **CONFIRMED:** neither studied tool implements mute/block/not-interested. twittervim binds only reply/retweet/like/bookmark/open (+ j/k/Esc/z); xkey binds only show-more/grok/open-subtweet/screenshot. Confirmed by full file reads.
- **CONFIRMED (by task's own live-screenshot context):** the caret-menu rows carry no per-action data-testid; dispatch path = click `[data-testid="caret"]` in the article, then match `[role="menuitem"]` by trimmed `textContent`, click. The exact label list — "Not interested in this post", "Follow @user", "Add/remove from Lists", "Mute", "Block @user", "Embed post", "Report post", "Request Community Note" — is taken from the confirmed live screenshot in the task brief; I could not independently re-verify ordering against live X (auth-gated SPA). Menu being `[role="menu"]` portalled to `document.body` is consistent with cross-doc 09-caret-menu-dom research but not re-derived here → the DOM-structure portion is **medium** confidence.

Net: the headline "Mute/Block have NO per-action data-testid" is true about the *action bar*, but the surrounding claim that they are keyboard-unreachable / require manually opening the caret menu is **wrong** — `u`/`b` are native keys.

---

## Claim E — "Input guarding: event.target.closest() over editable selector + IME composition flag, not just activeElement.tagName"

**Verdict: CONFIRMED.**

- **xkey** `isEditableTarget(target)` (lines 788-805): `target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')`. Exact match to claim.
- **twittervim** `isTyping()` (lines 31-44): checks `activeElement?.tagName === 'INPUT' || 'TEXTAREA' || getAttribute('contenteditable') === 'true' || isComposing.value`. `isComposing` is set by `compositionstart`/`compositionend` listeners (lines 440-446). `hasModifier()` guards `Meta/Control/Alt/Shift` (lines 47-49). All confirmed. (Note: twittervim's editable check is `activeElement`-based, not `closest()`-based — exactly the weaker pattern the claim contrasts against.)
- **Vimium** `DomUtils.isEditable` (lib/dom_utils.js lines 268-271) = `isSelectable(el) || nodeName==='select'`, where `isSelectable` (247-262) = `input` minus `[button,checkbox,color,file,hidden,image,radio,reset,submit]`, OR `textarea`, OR `isContentEditable`. Confirmed as the canonical reference. mode_normal.js (lines 554-555) enters an `InsertMode` when `document.activeElement` is editable rather than per-key checks — confirmed.
- Synthesis ("xkey closest() + twittervim composition guard") is a sound recommendation.

---

## Claim F — "Capture-phase keydown at document_start; preventDefault+stopImmediatePropagation only for owned keys; ignore e.repeat and unclaimed modifiers"

**Verdict: CONFIRMED for xkey; CONFIRMED for the twittervim anti-pattern (with a mechanism correction).**

- **xkey:** `document.addEventListener('keydown', handleKeydown, true)` (line 78, capture phase) and `manifest.json` `run_at: "document_start"` (line 16). Confirmed.
- `isSupportedShortcut()` (lines 694-705) returns `false` on `event.repeat || altKey || ctrlKey || metaKey` and for any key it doesn't claim. Confirmed.
- Only on a handled key does it call `event.preventDefault()` + `event.stopImmediatePropagation()` (e.g. lines 642-643, 653-654, 665-666, 683-684); every other key falls through. Confirmed.
- **twittervim anti-pattern:** confirmed it binds bare `j/k/l/r/t/b` (lines 117-151) — which overlap X's native `j/k` (nav) and `l/r/t/b` (like/reply/repost/bookmark). **Mechanism correction:** twittervim does NOT add its own raw capture-phase `keydown` listener for these; it uses `useMagicKeys()` + `whenever()` from `@vueuse/core` (lines 1, 11, 28). So it reacts to the same key X reacts to (double-firing risk) rather than intercepting/suppressing — arguably *worse* than the claim implies, since it never suppresses X. g-navigation uses `window.location.href` (line 174 `navigateTo`), forcing a full reload and defeating the SPA — confirmed; preferring `[data-testid="AppTabBar_*_Link"]` clicks is sound (twittervim itself reads `[data-testid="AppTabBar_Profile_Link"]` at line 186, so the testid exists).
- **Surfingkeys per-site unmap:** confirmed — `api.js` defines `unmap(keystroke, domain)` (line 162) and `unmapAllExcept(keystrokes, domain)` (line 188) with a domain regex; the in-file JSDoc example is literally `unmapAllExcept(['E','R','T'], /google.com|twitter.com/)` (line 186).

---

## Claim G — "Vimium and Surfingkeys do NOT provide a tweet cursor — j/k are pixel scroll, actions via link hints"

**Verdict: CONFIRMED.**

- **Vimium** `defaultKeyMappings` (background_scripts/commands.js lines 409-414): `"j":"scrollDown"`, `"k":"scrollUp"`, `"h":"scrollLeft"`, `"l":"scrollRight"`. Link hints: `"f":"LinkHints.activateMode"`, `"F":"…ToOpenInNewTab"`, `"yf":"…ToCopyLinkUrl"` (lines 440-443). Confirmed exactly, including the claim's `h: scrollLeft`.
- **Surfingkeys** uses declarative `mapkey/imapkey/vmapkey` (default.js, dozens of uses) and `getRealEdit()` (defined utils.js line 329, imported default.js line 8). j/k are built-in Normal-mode scroll (not literal `mapkey('j',…)` in default.js — they're internal scroll handlers), consistent with "j/k are pixel scroll." No per-tweet cursor exists. Confirmed. They are the right reference for input-detection / key-suppression and the wrong model for a tweet cursor — sound.

---

## Claim H — "X ships a native j/k focus cursor + g-prefixed nav + single-key action set, discoverable via '?'"

**Verdict: CONFIRMED (premise + list); list confirmed from independent mirrors, not the gated official page.**

- Premise: xkey's README (line 14) asserts the native `?` keyboard-shortcuts menu documents these — and that its keys live alongside X's. Consistent.
- Native set corroborated by two agreeing mirrors (quickref.me, 40x50.com):
  - **Actions:** `n` new post, `l` like, `r` reply, `t` repost, `m` DM, `u` mute account, `b` block account, `Enter` open details, `o` expand photo, `/` search, `Ctrl/Cmd-Enter` send.
  - **Navigation:** `?` full menu, `j` next post, `k` previous post, `Space` page-down, `.` load new posts.
  - **Timelines (g + letter):** `g h` Home, `g o` Moments, `g n` Notifications, `g r` Mentions, `g p` Profile, `g l` Likes, `g i` Lists, `g m` DMs, `g s` Settings, `g u` go-to-profile.
- **Corrections to the claim's recalled list:** the claim wrote "u mute; m DM; n new post" and "g+letter: h home, p profile, n notifications, m messages" — the mirrors confirm `u`=mute, `m`=DM, `n`=new post, `g h`=home, `g p`=profile, `g r`=mentions(not g+n for notifications — notifications is `g n`, which the claim got right; mentions `g r` was unlisted in the claim). The claim's "Enter/. open/refresh" conflates two keys: `Enter`=open, `.`=load new posts. Minor.
- The claim that X "sets aria-activedescendant / :focus-within on the selected article" is consistent with xkey's resolution chain relying on exactly those signals (a strong indirect indicator) but was not directly observed on live X here → that DOM-signal detail is **medium** confidence.
- Consequence (a tool binding bare j/k/l/r/t/b overlaps X's own keys) — confirmed by the action list above.

---

## Summary of corrections

1. **xkey resolution chain is 5 steps, not 4**, and step 1 (`findActiveDescendantTweet`) uses `closest() || querySelector()`, and there is an extra `isFocusedSingleTweetWrapper` stage. (content.ts 807-861)
2. **xkey Grok regex** is `/^(explain this post|grok(?: actions)?)$/i`, not `/^(explain this post|grok)$/i`. (content.ts:45)
3. **xkey opens the referenced sub-tweet via `window.location.assign(url)`**, not `.click()` (clicking is only the card fallback). (content.ts:687,691)
4. **Mute and Block ARE native single keys** (`u`, `b`) on X — refutes the implication that they are keyboard-unreachable / always require manually opening the caret menu. (quickref.me, 40x50.com)
5. **twittervim does not use a raw capture-phase keydown listener** for j/k/etc.; it uses `@vueuse/core` `useMagicKeys()`+`whenever()`, so it never suppresses X's native handling (double-fire risk) — worse than the claim suggests.
6. **`like`/`retweet`/`bookmark` testids toggle by state** (`unlike`/`unretweet`/`removeBookmark`), so "stable" is qualified.
