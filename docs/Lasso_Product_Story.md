 # Lasso Product Story

**Direction:** Native Chameleon — "Shipped by X". The voice is X's own register: sentence case, terse, present tense, `·` separators, tabular numbers, X vocabulary — `List` capitalized, `people` not authors, `posts` not tweets, past-tense confirmations (`Muted @jane`). Every surface counts **people** (`3 people selected`, `Add 3 people to a List`) — the author-vs-post ambiguity is killed structurally. The name "Lasso" appears exactly twice on x.com (the shortcuts-sheet corner and a settings link): a native feature doesn't sign its work.

---

## 1. Discovery — the store listing promise

**What the user sees:** A real icon at last — one SVG path: a lasso rope whose open loop closes into a check. Single-color glyph, 1.5px stroke on a 20px grid; reads at 16px in the toolbar and 128px on the store tile. Listing name: **Lasso — add people to your X Lists from the timeline.** Description: "Select one or many posts as you scroll and file their authors into your X Lists — without leaving the feed. Keyboard-first. Runs entirely in your browser; nothing leaves x.com."

**What the design does:** The metaphor finally gets pixels (the loop IS the check), and the listing pre-answers the two questions that decide installs: what does it do (one sentence, the real unit — *people*), and is it safe (the trust line, stated before Chrome's permission warning ever appears). The promised-but-unbuilt hover "+List" quick action from the old PRD is not promised here — the listing describes only what ships.

## 2. Install moment

**What the user sees:** Chrome's host-permission warning ("Read and change your data on x.com"), then a new tab opens on `https://x.com/home#lasso-welcome`.

**Exact behavior:** `chrome.runtime.onInstalled` (reason `install`) → open x.com with the welcome hash; also set `chrome.runtime.setUninstallURL` to a one-question exit form. (Replaces the current `console.debug`.)

**What the design does:** The product IS the tour — no separate marketing tab. The user lands where the value lives, and the welcome card (next beat) immediately explains the permission they just granted.

## 3. First run — the welcome card

**What the user sees:** Once the timeline mounts, an X-anatomy dialog (the `#5b7083/40%` backdrop, 380px card, 16px radius) titled **Lasso is ready**, with three gesture rows:

- `Hover any post and press Alt+L to file its author into a List`
- `Press s to select many people, then add them all at once`
- `Press ? anytime to see every shortcut`

Primary pill **Try select mode** (enters select mode and dismisses), text button **Skip**. Footer: *Lasso runs entirely in your browser. Nothing leaves x.com.*

**What the design does:** Three gestures, one CTA, one trust fact — under 60 seconds to literacy. Dismissing writes `lasso:onboarded=true`; the card never re-shows (restorable via Settings → Replay intro). The timeline itself stays pristine: overlay checks are hidden by default, so nothing unexplained appears on every post. The welcome card carries the burden the always-on circles used to carry — and the decaying hints (beat 5) catch anyone who skips it.

## 4. First selection and first assign — the aha

**What the user sees:** Hovering any post fades in a 22px circle at the avatar's bottom-right corner (exactly where X puts its own check in DM select mode) — border brightens to blue on hover with a 40% ghost check previewing the action. First hover ever fires one X-anatomy tooltip: *Select — then add everyone to a List at once.* Click: the check fills X-blue instantly. The ActionBar slides up bottom-center: facepile of the selected person's avatar · **1 person selected** · **Add to List** (with an `Alt+L` keycap chip during the onboarding window) · ✕.

Clicking **Add to List** opens the picker **instantly** — 8px above the bar, X dropdown anatomy, header **Add @jane to a List**, placeholder **Search Lists**, rows grouped `Recent` / `All Lists` with member counts (`1,204 members`), lock icons on private Lists, and a footer legend: `↑↓ Navigate · Enter Add · Esc Dismiss · 1 selected`. Lists already containing @jane show a blue check — "already in."

Enter on a row: the picker closes, the bar shows a brief progress flash, then a toast: **Added 1 to Design Folks** with **View List** and **Undo** (`Z`). Hovering the count later may show (max 3 times): *Lasso adds people to Lists, not posts.*

**What the design does:** Cache-first open (the blocking `force:true` fetch is deleted) makes the first impression "this is faster than X." The membership checks prevent the silent no-op of re-adding. `View List` is the single promote action — the picker stays ephemeral. Undo is scoped strictly to `outcome === 'added'` so it can never remove a pre-existing membership.

## 5. Learning the keyboard layer — four nested rings

**What the user sees, in order of encounter:**

1. **Permanent:** the picker footer legend on every open; the `?`-sheet reference.
2. **Decaying (7 days or 5 assigns, whichever first):** the `Alt+L` keycap beside the ActionBar CTA; after the first pointer-driven assign, a toast: *Tip: Alt+L on a hovered post does this without the mouse*; the first-hover tooltip; the unit tooltip.
3. **Reactive:** pressing Alt+L/Alt+M with no target → toast *Hover a post first — or press j to focus one* (the console.warn, finally on screen). After 3 individual selections in one session → one-time toast *Tip: press s to select by clicking posts.*
4. **On demand:** `?` opens **Keyboard shortcuts** — the same key X uses for its own sheet, so the entire audience already knows to press it. The sheet renders from the LIVE keymap (rebinds self-document) and closes with the trust footer: *j and k move between posts — those are X's own shortcuts. Lasso never overrides them.*

Keycaps render platform-aware: `Alt` on Windows/Linux, `⌥` on macOS.

**What the design does:** Every hint is in-product, terse, and self-destructing. After decay, the UI returns to pure camouflage — the expert sees nothing they didn't ask for, and `Replay intro` in Settings restores the hints for a second pass.

## 6. Daily habit — the two-second assign

**What the user sees:** j/k to a post (X's own focus) → `Alt+L` → picker opens **in 0ms at the post's caret corner**, exactly where X's "…" menu opens, input pre-focused → two keystrokes of fuzzy → `Enter` → toast. Under two seconds, zero animation in the way, eyes never leave the post.

**The graduation chord:** once a **Default List** is set in Settings, **`Alt+Shift+L` adds the hovered/focused author straight to it — no picker at all.** Toast: `Added 1 to Design Folks · View List · Undo`. The whole flow collapses to one chord.

**Quick actions report back:** `Alt+M` → toast **Muted @jane · Undo** (`Z`, 10s window). `Alt+N` → **Hidden — not interested**. Failures: **Couldn't mute @jane · Retry**. Nothing is silent anymore; muting the wrong person is now visible and reversible.

**What the design does:** Caret-anchoring eliminates the gaze hop on every single assign; the usage-ranked `Recent` group means the right List is usually the first row; `Esc` follows one deterministic grammar everywhere (dialog → picker → review popover → select mode → clear selection).

## 7. The bulk session — select mode

**What the user sees:** Press `s`. Instantly (0ms — keyboard-triggered): every visible post's check fades in, and the ActionBar appears even at zero count: crosshair glyph · *Select mode · click posts or press x · s when done* · **Done**. **Clicking anywhere on a post's body toggles it** — sweeping a thread is one click per post, no aiming at 22px circles. `x` does the same from the keyboard. Selected checks stay visible while scrolling — the persistent record of the lasso. The toolbar badge mirrors the live count.

The bar grows: facepile (3 avatars + `+4`) · **7 people selected** · **Add to List** · ✕. Clicking the facepile opens a review popover — one row per person with a ✕ to remove individuals before committing.

`Alt+L` (or the button) → picker, header **Add 7 people to a List** → Enter. The bar becomes a progress surface: spinner · **Adding 2 of 7 to Design Folks…** with a **Stop** pill. Stop aborts the remaining calls and keeps un-attempted people selected (`2 added · 5 still selected`). On full success: toast **Added 7 to Design Folks · View List · Undo**, selection clears, bar exits.

**What the design does:** `s` finally does something visible (the signal nothing read is now consumed by every overlay host and the bar). Selection is never cleared until results return — only the successfully-added subset is removed. Exiting select mode keeps the selection.

## 8. When things go wrong — every failure is a designed beat

**No Lists yet (true empty):** picker shows *You don't have any Lists yet* / *Lists let you group people on X* + primary pill **Create a List on X** → `x.com/i/lists/create`. A brand-new user's first List becomes Lasso's first success.

**No match:** *No Lists match "des"* + **Clear search** + **Create "des" on X**. A failed search becomes a creation path, never a dead end.

**Logged out:** *Couldn't load your Lists* / *You may be logged out of X* + **Retry** pill — and pressing `r` retries from the keyboard. The cause is named; the old lie ("No matching lists") is dead.

**Rate-limited fetch:** same error frame, reason *X rate limited Lasso — try again in a few minutes.*

**Rate limit mid-run:** the run stops; danger toast with NO auto-dismiss: **X rate limit reached** / *Added 4 · 6 still selected — try again in 12 min* (minutes from `x-rate-limit-reset`). The 6 stay selected, the ActionBar stays up. A rate limit is a pause, not a catastrophe.

**Protected author (partial):** toast **Added 2 to Design Folks · 1 failed** / *@handle is protected and can't be added* + **Retry**. The vague "N not allowed" is gone; failed people remain selected.

**Total failure:** danger toast **Nothing was added** / reason line + **Retry**. Persists until dismissed. (Failure copy is always literal — no charm at the moment of loss.)

**No target:** info toast *Hover a post first — or press j to focus one.*

**Selector breakage (X redesign):** if the scanner sees >200 mutations with 0 post matches in a session, one-time toast: *Lasso can't read the timeline — X may have changed. Check for an update.* Breakage reads as a known state, not a vanished product.

**What the design does:** Five picker states (loading skeletons / error / empty / no-match / ready) mean no user is ever lied to again; every failure names a cause, preserves the selection, and offers exactly one verb (Retry / Create / Clear / Stop / Undo).

## 9. Settings and the disclosure

**What the user sees:** A real options page (X settings anatomy, same tokens, OS-theme fallback off-x.com):

- **Activation:** `On every visit (default)` / `Only when I click the toolbar icon`. Dormant tabs show a `zz` toolbar badge; clicking to wake fires *Lasso is awake on this tab* and clears it — ADR-0006's missing feedback loop, closed.
- **How Lasso talks to X** (the promised disclosure, verbatim): `Drive X's own menus — slow, but uses only what you could click yourself` / `X's public REST endpoints — fast, same calls X's site makes` / `GraphQL — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately.` **Prerequisite:** code ships `backend:'rest'` while PRD/CONTEXT say DOM-default — the team picks one and realigns docs *before* this copy ships, or the trust copy lies in the exact place trust is built.
- **Default List:** `None — always ask` default; when set, *Alt+Shift+L adds straight to this List.*
- **Keyboard shortcuts:** read-only live keymap (the `?` sheet's rows) + *Press ? on x.com anytime.*
- **Accessibility:** `Higher-contrast buttons` toggle (AA-safe darker-blue fills).
- **Privacy & data:** *Lasso has no servers. Your X session, your Lists, and your usage stats never leave this browser.* + **Clear Lasso data** (wipes `lasso:lists`, `lasso:list-usage`, `lasso:settings`, `lasso:coach`; inline `Cleared`) + **Replay intro**.

The **toolbar popup** (280px) shows the state line (`Active on x.com` / `Asleep — click to wake`), the top-3 shortcuts, and `All settings →` — discoverability for users who never press `?`.

**What the design does:** Every setting that existed only in `chrome.storage` gets a surface; the strongest trust facts move from ADRs into user-facing copy; the data Lasso keeps is named and wipeable.

## 10. Uninstall — closing the loop

**What the user sees:** On uninstall, one page with one question: "What made you remove Lasso?" (multiple choice + free text, optional, no login).

**What the design does:** `setUninstallURL` was set at install. Local data is cleared by Chrome with the extension; the settings page already told the user nothing ever left the browser, so there is nothing else to clean up. The exit is as quiet as the product — and the one question is the only telemetry Lasso will ever have.

---

## Canonical strings (implement verbatim)

1. Picker header: `Add @jane to a List` / `Add 3 people to a List`
2. Input placeholder: `Search Lists`
3. Success toast: `Added 3 to Design Folks` · action `View List` · action `Undo` (kbd `Z`)
4. Idempotent line 2: `1 was already in the List`
5. Protected: `@handle is protected and can't be added`
6. Rate limit: `X rate limit reached` / `Added 4 · 6 still selected — try again in 12 min`
7. Picker error: `Couldn't load your Lists` / `You may be logged out of X` · `Retry` (kbd `r`); rate-limited fetch reason: `X rate limited Lasso — try again in a few minutes`
8. True empty: `You don't have any Lists yet` / `Lists let you group people on X` · `Create a List on X`
9. No match: `No Lists match "des"` · `Clear search` · `Create "des" on X`
10. No-target nudge: `Hover a post first — or press j to focus one`
11. Mute: `Muted @jane` · `Undo`; failure `Couldn't mute @jane` · `Retry`
12. Select-mode bar: `Select mode · click posts or press x · s when done`
13. Post-assign tip: `Tip: Alt+L on a hovered post does this without the mouse`
14. Select-mode nudge: `Tip: press s to select by clicking posts`
15. Trust line: `Lasso runs entirely in your browser. Nothing leaves x.com.`
16. Wake toast: `Lasso is awake on this tab`
17. Progress: `Adding 2 of 5 to Design Folks…` · `Stop`; after stop: `2 added · 3 still selected`
18. Unit tooltip: `Lasso adds people to Lists, not posts.`
19. Selector health: `Lasso can't read the timeline — X may have changed. Check for an update.`
20. Shortcuts footer: `j and k move between posts — those are X's own shortcuts. Lasso never overrides them.`, and    baed on  test -driven dev