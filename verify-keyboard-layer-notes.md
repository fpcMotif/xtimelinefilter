# Adversarial verification — "Keyboard-layer best practices in an MV3 content script"

Date: 2026-06-08. Verifier brief: try to REFUTE each claim against primary sources; default to "uncertain" if uncorroborated. Focus on key-conflict claims and DOM selectors.

## Source-access notes (important caveat)

- **Official X help (`help.x.com` / `blog.x.com`) is Cloudflare-gated** ("Just a moment… Enable JavaScript and cookies to continue") — cannot be fetched via curl. Confirmed live.
- **Wayback Machine has NO usable capture** of `help.twitter.com/en/using-twitter/keyboard-shortcuts` — every snapshot path resolves to the X Help Center **404** page ("Sorry, this page doesn't exist"). The official shortcuts URL has been moved/renamed over time. CDX index returned empty/timed out for that path.
- **`webnots.com` returned 403**; **`computerhope.com` is Cloudflare-gated**. The two named third-party sources for the shortcut list were NOT directly verifiable.
- **`mgrep --web` is over its monthly quota** (HTTP 429) — could not be used for web discovery.
- MDN, the WHATWG DOM Living Standard, the Chrome extensions docs, and the WAI-ARIA APG **were all fetchable** and are the load-bearing primary sources for the technical claims (1–4, 7).
- Third-party corroboration for the shortcut list obtained from a GitHub-hosted cheat-sheet: `jqknono/reference-harmony` `mds/en/twitter.md` ("26 keyboard shortcuts found on Twitter").
- The reference repo file `reference/twittervim/src/composables/useTwitterKeyboard.ts` and `src/core/settings.ts` were read directly.

---

## Claim 1 — ISOLATED-world content script shares the page's single DOM and event-dispatch tree; only JS context is isolated. → CONFIRMED

Primary evidence:
- **Chrome docs** (developer.chrome.com/docs/extensions/develop/concepts/content-scripts): "Content scripts live in an **isolated world**, allowing a content script to make changes to its JavaScript environment without conflicting with the page… An isolated world is a private execution environment… **JavaScript variables in an extension's content scripts are not visible to the host page**." And earlier: content scripts "have access to the details of the web pages the browser visits, **make changes to them**…". The page's worked example shows a page listener and a content-script listener **both attached to the same button**, and states "**both alerts appear in sequence when the button is clicked**" — i.e. listeners from different worlds coexist on one node's listener list and both fire. This directly supports "shared DOM + shared event-dispatch tree; only JS context isolated."
- **WHATWG DOM** dispatch algorithm: a single per-target **event listener list**; `inner invoke` does "**For each listener of listeners, whose removed is false**… If phase is 'capturing' and listener's capture is false, then continue; If phase is 'bubbling' and listener's capture is true, then continue…" — one list, filtered by phase, invoked in registration order. There is no per-world / per-script partitioning in the spec.
- **MDN addEventListener**: "Event listeners in the **capturing phase are called before** event listeners in the target and bubbling phases." Hence a content-script capture-phase listener on window/document runs before X's bubble-phase handlers.

Adversarial check: The only nuance — Chrome says content scripts get a "clean" / "native" DOM and the page cannot see the content script's *JS objects*. That is JS-context isolation, exactly as claimed. No refutation found.

Sources:
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://dom.spec.whatwg.org/#concept-event-dispatch (verified text of "inner invoke" / dispatch)
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

---

## Claim 2 — A capture-phase listener can SUPPRESS X's native shortcut; use stopImmediatePropagation (not stopPropagation) + preventDefault, only for owned keys. → CONFIRMED

Primary evidence:
- **WHATWG DOM**: "The **stopPropagation()** method steps are to set this's **stop propagation flag**." "The **stopImmediatePropagation()** method steps are to set this's **stop propagation flag** *and* this's **stop immediate propagation flag**." In `inner invoke`, after each listener runs: "**If event's stop immediate propagation flag is set, then break.**" → Only the *immediate* flag halts the remaining listeners **on the same node**; plain `stopPropagation` lets sibling listeners on the same node still run. This is precisely the claim's rationale (X may have a listener on the same document/body node).
- **MDN addEventListener**: capture-phase listeners "are called before… target and bubbling phases" → a capture listener on document/window can act before X's React handlers.
- **MDN preventDefault** and stop* are independent operations (preventDefault sets the canceled flag; stop* set propagation flags) — orthogonal, as claimed.

The "only for keys you own / don't break j/k/g-h/./? and accessibility" portion is a best-practice prescription, consistent with the WAI-ARIA APG (see Claim 7), not a spec fact, but it is sound and corroborated by the accessibility source.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation (verified flag semantics + "then break")
- https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault

---

## Claim 3 — "Is the user typing" guard must cover contenteditable + ARIA textbox; X's composer/inline reply are contenteditable, NOT textarea; the reference repo's check is the brittle form. → CONFIRMED (with one DOM-fact nuance)

Primary evidence:
- **MDN HTMLElement.isContentEditable**: read-only boolean, true when the element is editable; example shows `<p contenteditable="true">` → `isContentEditable === true`. `isContentEditable` reflects *computed* editability (handles inherited editability), which `getAttribute('contenteditable')` does not — supporting the descendant-focus argument.
- **Reference repo brittle form CONFIRMED verbatim** — `reference/twittervim/src/composables/useTwitterKeyboard.ts` `isTyping()`:
  ```js
  activeElement?.tagName === 'INPUT'
    || activeElement?.tagName === 'TEXTAREA'
    || activeElement?.getAttribute('contenteditable') === 'true'
  ```
  This is exactly "`getAttribute('contenteditable') === 'true'` on activeElement" — it misses descendant focus, `contenteditable=""` (empty value, which is still editable), inherited editability, and all ARIA roles (textbox/searchbox/combobox). Refutation attempt failed; the criticism is accurate.

Nuance / partial caveat (does not refute the claim): The specific assertion that "X's composer is contenteditable, NOT textarea" is a runtime DOM fact about X that I could **not** verify against a primary source in this session (X DOM not loaded; no live inspection). It is widely true of the X/TweetDeck Draft.js / contenteditable composer and is consistent with the reference repo targeting contenteditable, but treat the *exact current X markup* as community/empirical, not spec-verified. The general guard guidance (cover contenteditable + ARIA textbox + INPUT/TEXTAREA/SELECT, use `isContentEditable`/`closest('[contenteditable]:not([contenteditable="false"])')`) is correct and MDN-grounded.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/isContentEditable
- /Users/martinfan/devv/xtimelinefilter/reference/twittervim/src/composables/useTwitterKeyboard.ts (verified brittle check)

---

## Claim 4 — Match on event.key, guard IME with isComposing, use AbortController for teardown, do NOT use passive. → CONFIRMED

Primary evidence:
- **MDN KeyboardEvent.key**: key is the character/named-key value, layout- and modifier-aware (vs `code` = physical position; `keyCode` deprecated). Consistent with the claim. (key vs code distinction is standard MDN content.)
- **MDN KeyboardEvent.isComposing**: "true… **after compositionstart and before compositionend**" — exactly the IME window the claim describes; bail there to avoid mid-CJK misfires. (The "legacy keyCode===229" detail is an accurate empirical fallback, though not on this MDN page.)
- **MDN addEventListener `signal`**: "An AbortSignal. **The listener will be removed when the abort() method of the AbortController which owns the AbortSignal is called.**" → confirms AbortController teardown.
- **MDN addEventListener `passive`**: "if true, indicates that the function… **will never call preventDefault()**. If a passive listener calls preventDefault(), **nothing will happen** and a console warning may be generated." → confirms passive must NOT be used when you need preventDefault. Note: default for `keydown` is `false`, so omitting passive is fine; the claim's "must not be used here" is correct.

No refutation found.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
- https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

---

## Claim 5 — True 'gg'/'g-then-letter' sequences need a buffer+timeout state machine, not chord detection; the reference uses useMagicKeys chord detection. → CONFIRMED

Primary evidence (reference repo, verified verbatim):
- `useTwitterKeyboard.ts` imports `useMagicKeys` from `@vueuse/core` and defines navigation combos as **simultaneous-down conjunctions**:
  ```js
  const keys = useMagicKeys()
  const g_h = computed(() => keys.g && keys.h)   // both currently DOWN
  const g_e = computed(() => keys.g && keys.e)
  // … g_n, g_m, g_k, g_p, g_l, g_b, g_c
  whenever(g_h, () => { if (!isTyping()) navigateTo('/home') })
  ```
  `keys.g && keys.h` is true only while **both keys are held at the same time** — this is chord detection. It cannot represent a *sequence* (`g` released, then `h`), and cannot distinguish `gg` from a held `g`. The criticism is exactly right.
- The buffer+timeout + classify (exact-match / prefix / no-match), reset-on-blur/popstate/modifier/Escape design is a standard, sound prescription (this part is engineering guidance, not a citable spec fact). The factual core — "the reference uses chord detection and cannot do true sequences" — is confirmed by the source.

Sources:
- /Users/martinfan/devv/xtimelinefilter/reference/twittervim/src/composables/useTwitterKeyboard.ts (verified useMagicKeys chord pattern)
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

---

## Claim 6 — X's native shortcuts the layer must coexist with. → MOSTLY CONFIRMED; one likely STALE binding; exhaustiveness UNCERTAIN

Could not reach the official X list (Cloudflare + no Wayback capture). Corroboration is third-party only, so confidence stays **medium**, matching the claim's own self-rating.

Third-party corroboration — GitHub `jqknono/reference-harmony` `mds/en/twitter.md` ("A visual cheat-sheet for the 26 keyboard shortcuts found on Twitter") confirms:
- Actions: `N` new, `L` like, `R` reply, `T` retweet, `M` DM, `U` mute, `B` block, `Enter` open, `O` expand photos, `/` search, `Ctrl`+`Enter` send. ✅ (matches claim)
- Navigation: `?` full menu, `J` next, `K` prev, `Space` page-down, `.` load-new. ✅
- g-prefix: `g e` Explore, `g n` Notifications, `g r` Mentions, `g p` Profile, `g l` Likes, `g i` Lists, `g m` Messages, `g s` Settings, `g u` user. ✅

Discrepancies / things NOT corroborated (refutation findings):
- **`g h` = Home**: the cheat-sheet maps **`g n` → Home timeline** and lists no `g h`. This is a known older-Twitter quirk; current X uses **`g h` for Home**. The claim's `g h` Home is consistent with current X but the only reachable corroborating source disagrees — so `g h` is plausibly correct but **not corroborated here** (mild uncertainty).
- **`b` block vs `x` block**: the claim lists BOTH `b` bookmark and `x` block AND `b`… wait — claim says `b bookmark` and `x block`; the cheat-sheet says **`B` = Block account** and has **no bookmark / no `x`**. So the older source maps `B` to block, whereas the claim maps `b`→bookmark and `x`→block. These are X-era reassignments; the claim's mapping is the modern one but **uncorroborated by the one reachable source** (which actively contradicts `b`=bookmark).
- **`g b` Bookmarks, `g d` display, `g k` Grok, `s` share, `n` new** — `g k` Grok and `g b` bookmarks appear in the reference repo's own command list (`navigateTo('/i/grok')` for `g k`, `navigateTo('/i/bookmarks')` for `g b`), giving weak corroboration for those two. `g d` display and `s` share were NOT found in any reachable source. Treat as **uncertain / X-version-dependent**.

Net: the *existence and broad shape* of the shortcut set is well-corroborated (high), but several specific modern bindings (`g h`, `b`/`x`, `g d`, `s`) and full exhaustiveness are **uncertain** because the authoritative X page was unreachable and the only reachable list is an older Twitter-era cheat-sheet. The claim's own "medium confidence on exhaustiveness, high that these exist" is the right calibration.

Sources:
- https://github.com/jqknono/reference-harmony/blob/main/mds/en/twitter.md (third-party cheat-sheet, "26 shortcuts")
- /Users/martinfan/devv/xtimelinefilter/reference/twittervim/src/composables/useTwitterKeyboard.ts (g k → /i/grok, g b → /i/bookmarks corroboration)
- https://help.x.com/en/using-x/keyboard-shortcuts (official; CONFIRMED Cloudflare-gated, content not retrievable)
- https://blog.x.com/en_us/a/2013/action-and-navigation-all-from-the-keyboard (official; CONFIRMED Cloudflare-gated)

---

## Claim 7 — Accessibility: never trap Tab/arrows/Enter; only intercept owned keys; keep focus escapable; WAI-ARIA APG. → CONFIRMED

Primary evidence:
- **WAI-ARIA APG — Developing a Keyboard Interface** (w3.org/WAI/ARIA/apg/practices/keyboard-interface/) loads and contains the relevant sections: "**Fundamental Keyboard Navigation Conventions**", management of focus as "**Tab and Shift+Tab keys are pressed**", roving-tabindex / focus management inside composite widgets, and explicitly: "**Assigning and revealing keyboard shortcuts, including guidance on how to avoid problematic conflicts with keyboard commands of assistive technologies, browsers**…". This directly backs: don't trap Tab; manage focus with roving tabindex / DOM focus; avoid conflicts with AT/browser shortcuts (i.e., don't swallow `?`/Escape).

The specific list "never trap Tab/arrows/Enter" is a reasonable application of the APG (Tab is the page-level focus mechanism; Enter activates; arrows are widget-internal) rather than a verbatim quote, but it is fully consistent with the cited page. No refutation.

Sources:
- https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ (verified content)

---

## Claim 8 — Configurable keymap should reuse the repo's chrome.storage.sync settings store with a canonical binding string. → CONFIRMED (with a small accuracy correction)

Primary evidence (repo, verified):
- `src/core/settings.ts` **does** persist to `chrome.storage.sync` (`createSettings(area = chrome.storage.sync …)`), uses key `"lasso:settings"`, and exposes **`get` / `set` / `subscribe`** exactly as claimed. Extending `LassoSettings` with `keymap: Record<binding, commandId>` is straightforward and consistent with the existing `DEFAULT_SETTINGS` merge pattern (`{ ...DEFAULT_SETTINGS, ...raw }`).
- **Correction to the claim's wording**: it says settings "already persists **hotkeySelectMode**". That field name is correct — `LassoSettings.hotkeySelectMode: string` exists (default `"s"`). ✅ So this sub-claim is accurate. (No error after all — verified the field is named `hotkeySelectMode`.)
- `subscribe(cb)` returns an unsubscribe fn and fires on every `set`, so "subscribe to rebuild the matcher live without re-adding the DOM listener" is implementable as described.
- **MDN Event.isTrusted**: exists and is the right gate to ignore page-synthesized events; the WHATWG dispatch text also shows `isTrusted` is `[LegacyUnforgeable] readonly` and only set true for genuine UA-dispatched events. The "optionally gate on isTrusted" advice is sound.

Canonical-binding-string design (sorted modifier prefixes + lowercased `event.key`) is a reasonable convention, not a spec fact; nothing contradicts it.

Sources:
- /Users/martinfan/devv/xtimelinefilter/src/core/settings.ts (verified chrome.storage.sync, hotkeySelectMode, get/set/subscribe)
- https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted

---

## Summary table

| # | Claim | Verdict |
|---|-------|---------|
| 1 | Isolated world = JS-context only; shared DOM/event tree | CONFIRMED |
| 2 | Capture-phase + stopImmediatePropagation (not stopPropagation) + preventDefault, owned keys only | CONFIRMED |
| 3 | Typing guard must cover contenteditable + ARIA; reference check is brittle | CONFIRMED (X-composer-is-contenteditable is empirical, not spec-verified) |
| 4 | event.key, isComposing IME guard, AbortController teardown, no passive | CONFIRMED |
| 5 | gg/g-prefix need buffer+timeout, not useMagicKeys chord | CONFIRMED |
| 6 | X native shortcut list | MOSTLY CONFIRMED; `g h`/`b`-vs-`x`/`g d`/`s` UNCERTAIN; exhaustiveness UNCERTAIN (official page unreachable) |
| 7 | Don't trap Tab/arrows/Enter; APG focus practices | CONFIRMED |
| 8 | Reuse chrome.storage.sync settings store; isTrusted gate | CONFIRMED |

## Corrections / cautions for the report
- Stop asserting the official X help list as primary-source-verified: it is Cloudflare-gated and has **no Wayback capture** (all snapshots 404). Downgrade `help.x.com`/`blog.x.com` citations to "exists, not retrievable."
- The single reachable third-party list (older Twitter cheat-sheet) **contradicts** the modern bindings `g h` (it uses `g n` for Home) and `b`=bookmark (it uses `B`=block). Mark `g h`, `b` (bookmark), `x` (block), `g d` (display), `s` (share) as **X-version-dependent / uncertain**.
- "X's composer is contenteditable not textarea" — true in practice and consistent with the reference repo, but verify against live X DOM before relying on it; it was not spec/primary-source confirmable in this session.
