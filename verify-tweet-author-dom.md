# Adversarial Verification — Tweet/Author DOM Extraction

Verifier run date: 2026-06-07. Method: cloned primary repos at HEAD, grepped exact line numbers, fetched official Chrome docs + vendor blogs with `curl -sSL`, cross-checked X DOM facts via `gh search code`.

## Repos pinned
- `insin/control-panel-for-twitter` @ `bfff1b1` (Release v4.22.5, 2026-05-09). `script.js` = 8322 lines.
- `dimdenGD/OldTwitter` @ `c719233` (2026-05-22). `scripts/apis.js` = 9272 lines.

---

## CLAIM 1 — Handle + status id from permalink `/<handle>/status/<id>` in `[data-testid="User-Name"]`; handle class `[A-Za-z0-9_]{1,20}`
**Verdict: CONFIRMED**

Exact regexes (script.js):
- L2391 `const URL_TWEET_BASE_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/`
- L2393 `const URL_TWEET_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)\/?$/`
- `[a-zA-Z\d_]` is exactly `[A-Za-z0-9_]`. Char class + `{1,20}` confirmed.

Handle read via anchor.pathname.substring(1):
- L5688 `$quotedByLink = $tweet.querySelector('[data-testid="User-Name"] a')`
- L5691 `let quotedBy = $quotedByLink?.pathname?.substring(1)`
- L6248-6249 identical pattern (`$tweet.querySelector('[data-testid="User-Name"] a')` then `.pathname.substring(1)`).
- L6410 additional handle regex `/^\/([a-zA-Z\d_]{1,20})\//.exec(location.pathname)[1]`.

Caveat / correction: cited lines were "2385-2395" — actual definitions are at 2391/2393 (within ±6). The `[data-testid="User-Name"] a` selected here is the PROFILE link (`/<handle>`), so `pathname.substring(1)` yields the bare handle, NOT `<handle>/status/<id>`. The `/status/` permalink is matched separately via URL_TWEET_BASE_RE against `location.pathname` (L7026, L7354) or via the `<time>` anchor. The synthesis should not conflate "the User-Name `a` gives handle+status id" — one `a` gives the handle; the status id comes from the timestamp/permalink anchor or React state. The `<time>` cross-check is plausible/standard but I did not find an explicit cpft line that reads the `<time>` ancestor `<a>` for the id (cpft gets the id from React state via getTweetInfo, not the time anchor).

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L2391, L2393, L5688-5691, L6248-6249, L6410)

---

## CLAIM 2 — Stable per-tweet selectors (Selectors object) + avatar suffix = screen name "used at 6022"
**Verdict: CONFIRMED for the selector list; REFUTED for the specific avatar-suffix attribution.**

Selectors object (script.js L2298-2314) confirmed verbatim:
- L2314 `TWEET: '[data-testid="tweet"]'`
- L2308 `PRIMARY_COLUMN: 'div[data-testid="primaryColumn"]'`
- L2311 `PROMOTED_TWEET_CONTAINER: '[data-testid="placementTracking"]'`
- L2315 `VERIFIED_TICK: 'svg[data-testid="icon-verified"]'` (icon-verified also used L7946)
Other selectors confirmed elsewhere:
- L5720 `[data-testid="socialContext"]`
- L7497 `[data-testid="cellInnerDiv"]` (row container, via `.closest`)
- L5688/5690 `[data-testid="User-Name"]`
- L4898/4944 `[data-testid="UserCell"]` (BUT only inside HoverCard selectors)

REFUTATION of avatar sub-claim: claim says `[data-testid^="UserAvatar-Container-<handle>"]` is "used at script.js:6022 — an independent handle source." FALSE as attributed:
- L6022 actually uses `getElement('div[data-testid^="UserAvatar-Container"]', {context: $hoverCard ...})` — a PREFIX match with NO handle suffix, for a user hovercard. cpft never reads the suffix as a handle. `rg 'UserAvatar-Container-'` over script.js = 0 hits.

HOWEVER the underlying X DOM FACT (avatar testid suffix == screen name) is TRUE and independently corroborated (community sources, no official X docs exist):
- `Ablaze-MIRAI/Twitter-UI-Customizer`: `getAttribute("data-testid").replace("UserAvatar-Container-", "")`
- `vahidbaghi/twitter-js-scraper`: `getAttribute('data-testid').replace('UserAvatar-Container-', "")`
- `aiya000/...`: `data-testid="UserAvatar-Container-{handle}"`
- `haxibami/findmuskist`, `DimensionDev/Maskbook`, `steveseguin/social_stream` all prefix-match `UserAvatar-Container-`.
So the synthesis CAN keep avatar-suffix-as-handle as a real, useful extraction path, but must DROP the false citation "used at cpft script.js:6022" and downgrade to community-corroborated (medium confidence; no primary X doc).

ScrapFly corroboration (HTTP 200): `wait_for_selector="[data-testid='tweet']"` and `="[data-testid='primaryColumn']"` both present. Note ScrapFly extracts data from XHR/GraphQL, not DOM attributes — which actually supports Claim 3.

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L2298-2315, L6022)
- https://scrapfly.io/blog/posts/how-to-scrape-twitter
- gh search code: Ablaze-MIRAI/Twitter-UI-Customizer, vahidbaghi/twitter-js-scraper, DimensionDev/Maskbook, haxibami/findmuskist

---

## CLAIM 3 — rest_id is NOT a DOM attribute; comes from React state or UserByScreenName GraphQL
**Verdict: CONFIRMED**

OldTwitter (scripts/apis.js):
- L2686 `/i/api/graphql/sLVLhk0bGj3MVFEKTdax1w/UserByScreenName?variables=...screen_name...` — exact query id matches.
- L2728 `result.legacy.id_str = result.rest_id;`
- L2792 `user.id_str = user.rest_id;`
- L4165 `user.rest_id,`
- Plus L3935, L4023, L4266, L6182, L6298, L7178, L8016, L8102 all derive id_str from rest_id. Never from a DOM attribute.

cpft: `rg 'rest_id'` over script.js = 0 hits — cpft does not parse rest_id from DOM; it indexes cached tweet/user objects in React state instead (see Claim 4).

X home-timeline GraphQL shape (trekhleb.dev, confirmed):
- `Tweet.core.user_results.result` = `User` with `rest_id: string // '1867041249938530657'`.
- Entry path: `content.itemContent` (TimelineTweet) -> `tweet_results.result` (Tweet) -> `core.user_results.result` (User) -> `rest_id`. Matches claimed path (claim folds the intermediate TimelineTweet, fine).

Sources:
- https://github.com/dimdenGD/OldTwitter/blob/master/scripts/apis.js (L2686, L2728, L2792, L4165)
- https://trekhleb.dev/blog/2024/api-design-x-home-timeline/

---

## CLAIM 4 — React props/state can yield rest_id without network, but only MAIN world; content scripts (ISOLATED) can't read __reactProps$/__reactFiber$
**Verdict: CONFIRMED**

cpft React state walk (script.js):
- L2782-2792 `getTopLevelProps()`: `$reactRoot.firstElementChild` -> `Object.keys(...).find(k=>k.startsWith('__reactProps'))` -> `[key].children?.props?.children?.props`.
- L2794-2801 `getState()` -> `props.store?.getState()`.
- L2884 `getTweetInfo(tweetId)` -> `getStateEntities()?.tweets?.entities[tweetId]`.
- L2903 `getUserInfo()` -> `getStateEntities()?.users?.entities` (keyed by screen_name; each `user` has following/followers_count/screen_name).
- L2860 `state?.entities?.users?.entities?.[user_id]?.screen_name`.
This matches the claimed path `children.props.children.props.store.getState()` then `state.entities.tweets.entities[statusId]` / `state.entities.users.entities[id]`. (My first grep `entities.tweets` missed it because the code is `getStateEntities()?.tweets?.entities` — corrected.)

Per-node `__reactProps$` + Firefox `wrappedJSObject` (script.js L5751-5777 = `getVerifiedProps`):
- L5765-5767 `if ($parent.wrappedJSObject) { $parent = $parent.wrappedJSObject }`
- L5768 `let reactPropsKey = Object.keys($parent).find(key => key.startsWith('__reactProps$'))`
Exactly the claimed pattern. (This particular fn reads isBlueVerified, not rest_id, but it proves the technique.)

Chrome official docs CONFIRM isolation + worlds:
- developer.chrome.com content-scripts: "Content scripts live in an isolated world... JavaScript variables in an extension's content scripts are not visible to the host page" -> cannot read page React keys from ISOLATED.
- developer.chrome.com scripting: `ExecutionWorld` enum `"ISOLATED"` (unique to extension) / `"MAIN"` (shared with host page's JS), Chrome 95+. `world ExecutionWorld optional Chrome 102+ ... Defaults to ISOLATED.`
- developer.chrome.com manifest/content-scripts: `"world": "ISOLATED"` (or MAIN) manifest key shown.
So to read `__reactProps$`/`__reactFiber$` you need `world:"MAIN"` (manifest content_scripts.world or chrome.scripting), or inject a page `<script>` + postMessage. Confirmed.

Caveat: claim cited cpft 2782-2854 for the entity-by-id reads; the walk helpers are 2782-2860 and the actual `tweets.entities[id]`/`users.entities` reads are at 2884/2903 (a few lines past the cited block). Functionally accurate.

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L2782-2792, L2884, L2903, L5751-5777)
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts

---

## CLAIM 5 — Variant classification by presence markers; scope author to first User-Name to avoid quoted author
**Verdict: CONFIRMED (with minor attribution nits)**

cpft `getTweetType($tweet, checkSocialContext)` (script.js L5716-5748):
- L5717 PROMOTED via `$tweet.closest(Selectors.PROMOTED_TWEET_CONTAINER)` (= `[data-testid="placementTracking"]`).
- L5720 `[data-testid="socialContext"]` present -> RETWEET (or COMMUNITY_TWEET / PINNED_TWEET when checkSocialContext, by svg path).
- L5726/5733 nested `<article>` -> UNAVAILABLE_RETWEET / UNAVAILABLE_QUOTE_TWEET.
- L5730/5740 QUOTE via `$tweet.querySelector('div[id^="id__"] > div[dir] > span')?.textContent.includes(getString('QUOTE'))` (localized visually-hidden "Quote").
All four markers match the claim.

Scoping: `getQuotedTweetDetails` (L5686-5705) shows the quoted account has its OWN second `[data-testid="User-Name"]` block (`$quotedTweet?.querySelector('[data-testid="User-Name"]')`), so the article-level first User-Name `a` is the main author and the quoted author is nested — confirms "scope to first User-Name block."

Nits: (a) claim says socialContext `<a>` "holds the retweeter handle" — plausible and standard but I didn't isolate a cpft line reading it; treat as reasonable inference. (b) claim says who-to-follow "uses `[data-testid="UserCell"]`" — the UserCell selector for who-to-follow is real (corroborated by Maskbook `'[data-testid="UserCell"] [data-testid^="UserAvatar-Container-"]'`), but cpft itself only uses UserCell inside HoverCard selectors (L4898/4944), not for who-to-follow. The "has no tweet article -> naturally excluded" reasoning holds.

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L5686-5748)
- gh search code: DimensionDev/Maskbook (UserCell + UserAvatar-Container)

---

## CLAIM 6 — Virtualized timeline needs MutationObserver + dedupe + route re-acquisition; cache by status id not DOM node
**Verdict: CONFIRMED**

cpft:
- L2966 `observeElement($target, callback, nameOrOptions, mutationObserverOptions = {childList: true})` — wrapper with named observers + disconnect bookkeeping (L2966-3008). Confirmed.
- L3758 `observeTimeline(...)`: gets `Selectors.TIMELINE`, observes it (`observeTimelineItems` L3776), and RE-ATTACHES when X replaces the timeline element: on tab change it observes `$timeline.parentElement` for addedNodes -> new timeline -> re-observe (L3788-3806); also a "waiting for timeline" path observing parent for the first real timeline (L3815-3832). Confirms route/tab re-acquisition.
- L6192 `onTimelineChange($timeline, page, options)`: iterates `for (let $item of $timeline.children)` (L6225) and `$item.querySelector(Selectors.TWEET)` per row (L6231). Confirms per-row iteration with childList observation.

cpft caches by tweet id (React state `tweets.entities[tweetId]`, L2884) and by screen_name (`users.entities`, L2903) — consistent with "cache by status id not DOM node" for virtualized mount/unmount. The "minimal variant" (observe body subtree, gate on `article[data-testid="tweet"]`, WeakSet dedupe, rAF coalesce) is sound standard practice (recommendation, not a cpft citation).

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L2966-3008, L3758-3832, L6192-6231)

---

## CLAIM 7 — Display-name extraction is tricky (spans + emoji img alt + @handle + verified svg + timestamp); naive textContent wrong
**Verdict: CONFIRMED (logic) / partially MISATTRIBUTED**

cpft:
- L5688 `$quotedByLink = $tweet.querySelector('[data-testid="User-Name"] a')` then L5691 handle via pathname.substring(1) — confirms "first descendant a whose pathname is /<handle>" approach for the handle.
- L5692 `let user = $userName?.querySelector('[tabindex="-1"]')?.textContent` — confirms the FRAGILE positional `[tabindex="-1"].textContent` hook for the quoted user's NAME. Matches claim.
- L5698-5704 img-alt expansion (`if node.nodeName == 'IMG' return node.alt`) — BUT this is applied to the quoted-tweet TEXT (`$qtText`), NOT to the display name. So "read its [name] text expanding <img alt> for emoji and skipping the verified svg" is a RECOMMENDED technique, not what cpft does for names (cpft's name read is the raw `tabindex=-1` textContent, which would already exclude the svg since svg has no text, and would NOT expand emoji img alts). Synthesis should present emoji-img-alt expansion as the recommended robust approach, and the `tabindex=-1` textContent as cpft's fragile shortcut.

Avatar URL heuristic: claim says `pbs.twimg.com/profile_images/<digits>/` "often contains the numeric user id but is not guaranteed." This is correctly hedged. Adversarial note: the leading digits in profile_images paths are NOT the user rest_id — they are an image/media id, so do NOT treat them as the user id. Keep this as low confidence / mark as unreliable for rest_id; the only reliable rest_id sources remain React state and GraphQL (Claims 3-4).

Sources:
- https://github.com/insin/control-panel-for-twitter/blob/v4.22.5/script.js (L5688-5704)

---

## CORRECTIONS the synthesis MUST apply
1. (Claim 2) Drop the assertion that the avatar testid suffix is "used at cpft script.js:6022 — an independent handle source." cpft L6022 is a PREFIX-only match (`UserAvatar-Container`, no suffix) used for a hovercard; cpft never extracts a handle from the suffix. Keep avatar-suffix-as-handle as a real X DOM fact, but cite community sources (Maskbook, Twitter-UI-Customizer, twitter-js-scraper) and mark medium confidence (no official X docs).
2. (Claim 1) `[data-testid="User-Name"] a` yields the bare handle (`/<handle>`), not `/<handle>/status/<id>`. The status id comes from the permalink/`<time>` anchor or React state, parsed by URL_TWEET_BASE_RE. Do not state both come from the same User-Name anchor. The `<time>`-ancestor-`<a>` cross-check is reasonable but unverified in cpft source.
3. (Claim 4) Entity-by-id reads are at script.js L2884 (`tweets.entities[tweetId]`) and L2903 (`users.entities`), just past the cited 2782-2854 block; the walk helpers are 2782-2860. Minor line-range correction.
4. (Claim 5) `[data-testid="UserCell"]` for who-to-follow is real but is NOT a cpft-sourced fact (cpft only uses UserCell inside HoverCard selectors). socialContext `<a>` holding the retweeter handle is a reasonable inference, not a verified cpft line.
5. (Claim 7) Emoji `<img alt>` expansion in cpft is applied to quoted-tweet TEXT (L5698-5704), not the display name. cpft reads the name via raw `[tabindex="-1"].textContent` (L5692). Present alt-expansion as the recommended robust technique, not cpft's name behavior.
6. (Claim 7) profile_images leading digits are a media/image id, NOT the user rest_id. Explicitly warn against using them for rest_id.
7. Line numbers for URL regexes are 2391/2393 (claim said 2385-2395) — within tolerance, but cite precisely.

## Net assessment
All 7 claims are substantively CONFIRMED on their core technical assertions, backed by exact lines in pinned source and official Chrome docs. The only outright REFUTATION is a citation error inside Claim 2 (avatar suffix attributed to cpft L6022). Remaining issues are attribution/line-range nits and over-precise wording, captured as corrections above.
