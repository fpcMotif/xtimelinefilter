# 03 — Reliable author extraction from a tweet element (current x.com DOM)

> Scope: from a **content script**, given a timeline `<article data-testid="tweet">`, extract
> `screen_name` (handle), `display name`, `tweet status id`, and ideally `rest_id`
> (numeric user id). Covers stable selectors, React‑fiber reading, retweets / quotes /
> threads / promoted / who‑to‑follow, and the MutationObserver pattern for the virtualized feed.
>
> Maps directly onto `src/core/tweet-extractor.ts` (`extractAuthor(article): TweetAuthor | null`)
> and `TweetAuthor { screenName, userId?, displayName?, avatarUrl?, tweetId? }`
> (`src/core/selection-store.ts`).
>
> Primary references inspected: **control-panel-for-twitter** (insin, ~2.5k★, actively
> maintained against the *current* X web app) and **OldTwitter** (dimdenGD) — both cloned and
> read line‑by‑line; plus the X home‑timeline GraphQL shape (trekhleb), ScrapFly's X guide, and
> official Chrome extension docs. No `./reference` repo was present in this project.

---

## 0. TL;DR / decision summary

1. **Handle + status id are reliably available in the DOM**, from the permalink `<a>` inside
   `[data-testid="User-Name"]` and the `<time>`'s parent link. Pattern: `/<handle>/status/<id>`.
2. **Display name is in the DOM** but mixed with verified‑badge spans and emoji `<img alt>`;
   extract via the first text "line" of `User-Name`, not `textContent` blindly.
3. **`rest_id` (numeric user id) is NOT present as a DOM attribute.** Three ways to get it,
   in order of robustness:
   - (a) Read it from **React state / props** (the X web app keeps a Redux‑like store with
     `entities.tweets` and `entities.users`, and per‑node `__reactProps$…` carry user objects).
     **Requires running in the page's MAIN world** (content scripts are isolated and cannot see
     these keys). Fragile to X internal refactors.
   - (b) Intercept X's own **GraphQL timeline responses** (`HomeTimeline`/`HomeLatestTimeline`)
     and build a `statusId → {rest_id, screen_name}` map. Robust data, moderate plumbing.
   - (c) Resolve lazily via **`UserByScreenName`** GraphQL when you actually need the id
     (this project already plans `resolveUserId(screenName)` in `XListApi`). Most robust, one
     extra request per unique handle, cacheable.
4. **For this project specifically**: extract `{screenName, displayName, tweetId, avatarUrl}`
   purely from the DOM (zero fiber dependency, fully unit‑testable with HTML fixtures), and
   leave `userId` undefined — let `XListApi.resolveUserId()` fill it via `UserByScreenName`.
   Treat fiber/state reading as an **optional fast‑path optimization**, not the contract.

---

## 1. Stable container & timeline structure

The home/list/profile/search timeline is a **virtualized list**. Structure (current X web):

```
div[data-testid="primaryColumn"]
  …
  div[aria-label="Timeline: …"]               ← the scroller
    div[style="transform: translateY(…)"]     ← absolutely-positioned row wrapper
      div[data-testid="cellInnerDiv"]          ← ONE timeline "cell" (tweet OR who-to-follow OR ad OR cursor)
        article[data-testid="tweet"]           ← the tweet itself (role="article")
```

- Each **cell** is `div[data-testid="cellInnerDiv"]`. A cell may contain a tweet, a
  "Who to follow" module, a promoted unit, a "Show more"/cursor, etc. Iterate cells, then look
  for `article[data-testid="tweet"]` **inside** each cell.
- control-panel-for-twitter iterates `for (let $item of $timeline.children)` and does
  `$item.querySelector('[data-testid="tweet"]')` per row — i.e. it treats the timeline's
  direct children as the cells (`script.js:6226–6238`). Cells without a tweet are skipped.
- The timeline scroller selector used by cpft:
  `div[data-testid="primaryColumn"] section > h1 + div[aria-label] > div`
  (`Selectors.TIMELINE`, `script.js:2310`). A simpler, broadly-working alternative is to
  observe `div[aria-label^="Timeline"]` or just observe `document.body` with `subtree:true`
  and react to added `article[data-testid="tweet"]` nodes (see §6).
- Because the list is **virtualized**, tweets are added/removed from the DOM as you scroll;
  off‑screen tweets are destroyed. You must re-extract on each appearance — never cache by DOM
  node identity. Cache by **status id**.

---

## 2. Selector table (with fragility ratings)

Ratings: **A** = data-testid / structural contract X clearly relies on (most stable);
**B** = href / pattern matching (stable shape, values drift); **C** = positional / class /
visually‑hidden‑text heuristics (fragile, locale‑ or layout‑dependent).

| What | Selector (relative to the `article` unless noted) | Rating | Notes |
|---|---|---|---|
| Tweet container | `article[data-testid="tweet"]` | **A** | The anchor for everything. Also `role="article"`. cpft `Selectors.TWEET` (`script.js:2312`). |
| Timeline cell | `div[data-testid="cellInnerDiv"]` | **A** | One row; may be tweet / WTF / ad / cursor. |
| Timeline scroller | `div[aria-label^="Timeline"]` (locale‑sensitive aria text) or cpft's `primaryColumn section > h1 + div[aria-label] > div` | **B/C** | aria-label text is localized; prefer `[aria-label]` presence + structure over exact text. |
| Primary column | `div[data-testid="primaryColumn"]` | **A** | cpft `Selectors.PRIMARY_COLUMN` (`script.js:2304`). |
| Author name block | `[data-testid="User-Name"]` | **A** | Contains display name span(s) + `@handle` span + permalink + `<time>`. |
| Author permalink (status link) | `[data-testid="User-Name"] a[href*="/status/"]` | **B** | href = `/<handle>/status/<id>`. Most reliable single source for **both** handle and tweetId. |
| Timestamp link (status link, alt) | `a:has(> time)` or `time` → `.closest('a')` | **B** | The `<time datetime>` link's href is also `/<handle>/status/<id>`. Good cross-check. |
| Handle text span | inside `User-Name`, the span whose text starts with `@` | **C** | Prefer parsing the href instead of scraping the `@…` span. |
| Display name | first text "line" of `[data-testid="User-Name"]` (first child link's text, excluding the `@handle` line) | **C** | Mixed with verified badge `<svg>` and emoji `<img alt>`. See §3.2. |
| Avatar container | `[data-testid^="UserAvatar-Container-"]` | **A** | **The testid suffix is the screen name**: `UserAvatar-Container-jack`. Great independent handle source. cpft uses `div[data-testid^="UserAvatar-Container"]` (`script.js:6022`). |
| Avatar image | `[data-testid^="UserAvatar-Container-"] img[src*="profile_images"]` | **B** | `src` = `https://pbs.twimg.com/profile_images/<userNumericId>/<hash>_normal.jpg`. The path segment after `profile_images/` is the **numeric user id** in many cases (see §4.4) — opportunistic only. |
| Tweet text | `[data-testid="tweetText"]` | **A** | Not needed for author, but handy. Contains text nodes + emoji `<img alt>` + link `<a>`. |
| Social context (RT/pinned/promoted label) | `[data-testid="socialContext"]` | **A** | Presence ⇒ retweet / pinned / community / "Promoted" label row. See §5. |
| Promoted/ad wrapper | `[data-testid="placementTracking"]` (ancestor) | **A** | `$tweet.closest('[data-testid="placementTracking"]')` ⇒ promoted. cpft `PROMOTED_TWEET_CONTAINER` (`script.js:2307`). |
| Promoted label icon (alt) | `socialContext` svg path `Svgs.PROMOTED_PATH` (`script.js:2324`) | **C** | Icon‑path matching; brittle, only a fallback. |
| Who‑to‑follow user cell | `[data-testid="UserCell"]` | **A** | Recommendation rows; **not** an `article[data-testid="tweet"]` — naturally excluded if you require the tweet article. |
| Verified badge | `svg[data-testid="icon-verified"]` / `svg[data-testid="verificationBadge"]` | **A** | Strip from display name. cpft `Selectors.VERIFIED_TICK` (`script.js:2313`). |
| Quote-tweet "Quote" marker | visually-hidden span: `div[id^="id__"] > div[dir] > span` whose text === localized "Quote" | **C** | cpft `getTweetType` (`script.js:5733,5739`) — locale-dependent string match. |

### 2.1 Canonical href / status-id patterns (from cpft, `script.js:2385–2395`)

```js
// handle is [A-Za-z0-9_], 1–20 chars; status id is digits
const URL_TWEET_BASE_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/;     // matches with trailing path
const URL_TWEET_RE      = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)\/?$/; // exact permalink
const URL_MEDIAVIEWER_RE = /^\/[a-zA-Z\d_]{1,20}\/status\/\d+\/mediaviewer$/i;
```

Use `anchor.pathname` (already host-stripped), not raw `href`. cpft consistently does
`link.pathname.substring(1)` to get `<handle>` and matches `URL_TWEET_BASE_RE` for `[handle, id]`
(`script.js:5691`, `6249`, `2564`).

---

## 3. DOM extraction algorithm (no fiber needed for handle/name/id)

### 3.1 Handle + status id (rating B, very reliable)

```js
function statusLink(article) {
  // The User-Name block's status link is the author's own permalink for THIS tweet.
  return article.querySelector('[data-testid="User-Name"] a[href*="/status/"]')
      // fallback: the timestamp link
      ?? article.querySelector('time')?.closest('a[href*="/status/"]')
      // last resort: any /status/ link directly in the article (avoid nested quote tweet, see §5)
      ?? article.querySelector(':scope a[href*="/status/"]');
}

function parsePermalink(a) {
  if (!a) return null;
  const m = a.pathname.match(/^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/);
  return m ? { screenName: m[1], tweetId: m[2] } : null;
}
```

Cross-check: the `UserAvatar-Container-<handle>` testid gives the handle independently —
useful to disambiguate the author from a quoted account (the avatar container nearest the top
of the article belongs to the author):

```js
function handleFromAvatar(article) {
  const el = article.querySelector('[data-testid^="UserAvatar-Container-"]');
  return el?.getAttribute('data-testid')?.slice('UserAvatar-Container-'.length) || null;
}
```

### 3.2 Display name (rating C — needs care)

`[data-testid="User-Name"]` typically renders two "lines":

```
<div data-testid="User-Name">
  <div> … <a href="/jack"><span>…display name spans…</span></a> <svg data-testid="icon-verified"/> </div>
  <div> <a href="/jack"><span>@jack</span></a> · <a href="/jack/status/…"><time datetime=…>…</time></a> </div>
</div>
```

- The display name can contain multiple `<span>`s (font fallback / emoji split), inline emoji
  rendered as `<img alt="🔥">`, and a trailing verified `<svg>`. Naive `.textContent` mixes in
  the `@handle` and the timestamp.
- Robust approach: take the **first descendant link whose pathname is `/<handle>`** (no
  `/status/`) and read its visible text, expanding emoji `<img>` via `alt`:

```js
function readText(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
    else if (n.nodeName === 'IMG') out += (n.alt || '');          // emoji
    else if (n.nodeName === 'SVG' || n.nodeType === Node.ELEMENT_NODE)
      out += readText(n);
  }
  return out;
}
function displayName(article, screenName) {
  const block = article.querySelector('[data-testid="User-Name"]');
  if (!block) return undefined;
  // first link to the profile (not the status link)
  const nameLink = [...block.querySelectorAll('a')]
    .find(a => a.pathname === `/${screenName}`);
  const raw = readText(nameLink ?? block);
  return raw.replace(/\s+/g, ' ').trim() || undefined;
}
```

cpft reads the quoted user's display name with the analogous
`$userName.querySelector('[tabindex="-1"]')?.textContent` (`script.js:5692`) — the `[tabindex="-1"]`
wrapper around the name is another (more fragile, **C**) hook.

### 3.3 Avatar URL (rating B)

```js
function avatarUrl(article) {
  const img = article.querySelector('[data-testid^="UserAvatar-Container-"] img[src]');
  return img?.src || undefined;  // pbs.twimg.com/profile_images/<id>/<hash>_normal.jpg
}
```

X also uses CSS `background-image` divs for avatars in some surfaces; prefer the `<img>` when
present, else read `style.backgroundImage` from the avatar container's inner `div[style*="background-image"]`.

### 3.4 Putting it together (DOM-only `extractAuthor`)

```js
function extractAuthor(article) {
  if (!article || article.getAttribute('data-testid') !== 'tweet') return null;

  // Author handle/id from the author's OWN permalink (top of the article).
  // Restrict to the author's name block first to avoid grabbing a quoted tweet's link.
  const nameBlock = article.querySelector('[data-testid="User-Name"]');
  const authorLink = nameBlock?.querySelector('a[href*="/status/"]')
                  ?? article.querySelector('time')?.closest('a[href*="/status/"]');
  const pl = parsePermalink(authorLink);

  const screenName = pl?.screenName ?? handleFromAvatar(article);
  if (!screenName) return null;             // can't identify author → skip

  return {
    screenName,
    tweetId: pl?.tweetId,
    displayName: displayName(article, screenName),
    avatarUrl: avatarUrl(article),
    userId: undefined,                       // resolved later via UserByScreenName
  };
}
```

This is **pure and fixture-testable** (matches the design's `tweet-extractor.ts` contract and
its happy-dom HTML-fixture test plan).

---

## 4. Getting `rest_id` (numeric user id)

`rest_id` is the numeric user id (e.g. `"12"` for @jack). X's GraphQL write endpoints
(`ListAddMember`) take the **numeric id**, not the handle — so this project needs it eventually.

### 4.1 It is NOT a plain DOM attribute

There is no `data-user-id` / `data-rest-id` on tweet nodes in the current web app. Confirmed by
how both reference extensions obtain ids: **OldTwitter** always pulls `rest_id` from GraphQL
responses (`scripts/apis.js`, e.g. lines 2728, 2792, 4165 — `id_str = rest_id`), never from DOM
attributes; **control-panel-for-twitter** reads it from React state (§4.3).

### 4.2 Option C (recommended for this project): resolve via `UserByScreenName`

Lowest coupling, already in the design (`XListApi.resolveUserId(screenName)`).
Request shape (operation/query-id drifts; keep it in `GraphqlConfig.ops` as the spec already does):

```
GET https://x.com/i/api/graphql/<QUERY_ID>/UserByScreenName
    ?variables=%7B%22screen_name%22%3A%22<handle>%22%2C%22withSafetyModeUserFields%22%3Atrue%7D
    &features=%7B…%7D
Headers:
  authorization: Bearer <public web bearer>          # see §4.5
  x-csrf-token:  <ct0 cookie value>
  x-twitter-active-user: yes
  x-twitter-auth-type: OAuth2Session
  x-twitter-client-language: <lang>
  content-type: application/json
credentials: include
→ data.user.result.rest_id   // and .legacy.screen_name / .core.name
```

(Real query id observed in OldTwitter: `sLVLhk0bGj3MVFEKTdax1w` for `UserByScreenName`,
`scripts/apis.js:2686` — **will drift; do not hard-code long-term**.) Cache `handle → rest_id`
in `chrome.storage` / a Map; resolve only the handles you actually act on.

### 4.3 Option A (fast path): read from React **state** — needs MAIN world

The X web app keeps a Redux-like store reachable from the React root's props. cpft does
(`script.js:2782–2854`):

```js
// Walk: react root → __reactProps$ → children.props.children.props.store.getState()
function getTopLevelProps() {
  const root = document.querySelector('#react-root') ?? document.body.firstElementChild;
  const el = root.firstElementChild;                       // the app root host node
  const key = Object.keys(el).find(k => k.startsWith('__reactProps'));
  return el[key]?.children?.props?.children?.props;        // { store, … }
}
function getState() { return getTopLevelProps()?.store?.getState(); }

// Entities:  state.entities.tweets.entities[<statusId>]   → tweet (has user id_str etc.)
//            state.entities.users.entities[<userId>]      → { screen_name, followers_count, … }
function getStateEntities() { return getState()?.entities; }
```

`state.entities.tweets.entities[statusId]` carries the user id; `state.entities.users.entities`
is keyed by numeric id and includes `screen_name`. So: statusId (from DOM, §3.1) → tweet entity
→ user id → confirm against users entity. This avoids any network call.

### 4.4 Option A′: per-node `__reactProps$` (verified-badge trick generalizes)

cpft's `getVerifiedProps` (`script.js:5751–5777`) reads `__reactProps$…` off a DOM node and
walks the props tree to find a user object (it pulls `isBlueVerified`; the **same node's props
subtree contains the user, including `rest_id`/`id_str` and `screen_name`**). General recipe:

```js
// MAIN world only. ISOLATED-world content scripts CANNOT see these keys.
function reactProps(el) {
  if (el.wrappedJSObject) el = el.wrappedJSObject;          // Firefox xray-wrapper unwrap
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  return key ? el[key] : null;
}
function reactFiber(el) {
  const key = Object.keys(el).find(k =>
    k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  return key ? el[key] : null;     // .memoizedProps / .return walks up the fiber tree
}
```

From a fiber you can climb `fiber.return` (parent) / descend `fiber.child` and read
`fiber.memoizedProps` until you hit a node carrying the tweet/user object. This is the most
fragile path (depends on X's component tree shape) — use only as an optimization with a hard
fallback to §4.2.

> Avatar-URL id heuristic (**opportunistic, C**): `pbs.twimg.com/profile_images/<digits>/<hash>…`
> — the `<digits>` segment is frequently the user's numeric id. Cheap to read but **not
> guaranteed** (legacy/default avatars differ); never rely on it as the sole source.

### 4.5 The public web bearer token (for any internal GraphQL call)

The X web app's public bearer is a constant baked into its JS bundle; both reference projects use
it verbatim. Observed value (cpft `script.js:2827`):

```
Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
```

Pair it with the `ct0` cookie as `x-csrf-token` (this project's `auth.ts` already lifts both
into `Credentials {csrf, bearer}`). The bearer can rotate; prefer scraping it from the live
bundle/requests when possible, with this as a fallback default.

---

## 5. Tweet variants — classification & whose author you extract

Use cpft's `getTweetType($tweet)` logic (`script.js:5716–5748`) as the reference state machine:

```js
function getTweetType(article) {
  if (article.closest('[data-testid="placementTracking"]')) return 'PROMOTED_TWEET';
  if (article.querySelector('[data-testid="socialContext"]')) {
    // social context row present → retweet / pinned / community / "promoted" label
    if (article.querySelector('article')) return 'UNAVAILABLE_RETWEET'; // blocked/muted quoted acct
    if (hasQuoteMarker(article))          return 'RETWEETED_QUOTE_TWEET';
    return 'RETWEET';
  }
  if (hasQuoteMarker(article)) return 'QUOTE_TWEET';
  if (article.querySelector('article')) return 'UNAVAILABLE_QUOTE_TWEET';
  return 'TWEET';
}
// hasQuoteMarker: visually-hidden localized "Quote" span (rating C):
//   article.querySelector('div[id^="id__"] > div[dir] > span')?.textContent.includes(<"Quote">)
```

**Who is "the author" you want, per type:**

| Type | Detection | Author you should extract |
|---|---|---|
| Plain tweet | default | The single `User-Name` block → its handle/id. |
| **Retweet** | `[data-testid="socialContext"]` present, text "… reposted" | The **original tweet's author** — i.e. the `User-Name` block *below* the social-context row. The retweeter's handle is in the `socialContext` link (`[data-testid="socialContext"] a` → `.pathname.substring(1)`); decide product-wise whether to add the original author or the retweeter. For "assign tweet author to a List", you almost always want the **original author**, which is the article's main `User-Name`. |
| **Quote tweet** | "Quote" marker; a nested tweet block (often a second `User-Name`/`UserAvatar-Container`) | Two authors: the quoter (outer/top `User-Name`) and the quoted (inner). Extract the **outer** as the tweet author; cpft reads the quoted user via `getQuotedTweetDetails` using `div[id^="id__"] > div[dir] > span` → `.parentElement.nextElementSibling` then `[data-testid="User-Name"]` inside it (`script.js:5686–5705`). The nested quoted block is itself a clickable `/status/` link — your `extractAuthor` must scope to the **author name block** (§3.4) so it doesn't accidentally pick the quoted handle. |
| **Thread / self-reply** | a connector line; consecutive tweets by same author; cpft `isReplyToPreviousTweet` | Each tweet is still its own `article[data-testid="tweet"]` with its own `User-Name`; extract per article as normal. On a permalink/conversation page, the focal tweet has no `User-Name` status link in the same place — read the page URL or the `time` link. |
| **Promoted / ad** | `article.closest('[data-testid="placementTracking"]')` | Has a real `User-Name`; you *can* extract the advertiser's author, but typically **skip** promoted units for a "curate accounts" feature. |
| **Who-to-follow** | `[data-testid="UserCell"]`, **no** `article[data-testid="tweet"]` | Not a tweet. If you want these accounts: handle/id come from `UserCell` → `[data-testid^="UserAvatar-Container-"]` (handle in testid) and a `a[href="/<handle>"]`; there is **no** tweetId. Otherwise naturally excluded by requiring the tweet article. |
| **Unavailable (blocked/muted/deleted) quoted tweet** | nested bare `<article>` with "unavailable" text | Outer author still extractable; nested has no usable author. |

**Guard against picking the wrong author**: always scope handle/id extraction to the
**author's `User-Name` block** (the first one in document order within the article) or to the
top `UserAvatar-Container`, and reject `/status/` links that live inside a nested quoted-tweet
subtree.

---

## 6. MutationObserver pattern for the virtualized timeline

The feed mounts/unmounts tweet nodes as you scroll. Pattern distilled from cpft
(`observeTimeline` `script.js:3758`, `observeTimelineItems`, `onTimelineChange` `script.js:6192`,
`observeElement` wrapper `script.js:2966`):

1. **Wait for the timeline scroller** to exist (poll with `requestAnimationFrame` /
   `getElement` until `div[aria-label^="Timeline"]` / cpft's `Selectors.TIMELINE` appears).
2. **Observe the scroller** with `{ childList: true }` (cells are added/removed as direct
   children). On each mutation, iterate `scroller.children`, and for each cell
   `querySelector('article[data-testid="tweet"]')`.
3. **Handle tab/route changes**: X replaces the timeline element when you switch tabs
   (Following/For-you) or navigate. cpft also observes the scroller's **parent** and re-attaches
   the child observer when a new timeline node is inserted (`script.js:3789`, `3819`).
4. **Idempotency / dedupe**: mark processed articles (e.g.
   `article.setAttribute('data-lasso-seen','')` or a `WeakSet`) so re-fires don't double-mount
   overlays. cpft tags nodes with attributes like `cpft-…` for exactly this.
5. **De-bounce**: a single scroll can fire many mutations; coalesce per animation frame.

### Minimal, robust variant (recommended starting point)

```js
const seen = new WeakSet();

function scan(root = document) {
  for (const article of root.querySelectorAll('article[data-testid="tweet"]')) {
    if (seen.has(article)) continue;
    seen.add(article);
    const author = extractAuthor(article);
    if (author) mountOverlay(article, author);   // your Preact overlay in a Shadow root
  }
}

const obs = new MutationObserver((mutations) => {
  let touched = false;
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.matches?.('article[data-testid="tweet"]') ||
          n.querySelector?.('article[data-testid="tweet"]')) { touched = true; }
    }
  }
  if (touched) requestAnimationFrame(() => scan());
});

obs.observe(document.body, { childList: true, subtree: true });
scan(); // initial
```

- Observing `document.body` with `subtree:true` is simplest and survives X's frequent re-renders
  and SPA route changes (no need to chase the exact scroller node). Cost is fine because work is
  gated behind the `article[data-testid="tweet"]` check + `WeakSet`.
- For a tighter, lower-overhead observer, scope to `div[data-testid="primaryColumn"]` once it
  exists, and re-acquire it on `popstate`/route change.
- Because nodes are recycled, `WeakSet` keyed by node is fine for "did I mount an overlay on this
  live node"; but **dedupe domain data by status id** (`tweetId`) in `selection-store`, which the
  store already does by `screenName` key.

---

## 7. Content-script world / injection (why fiber reading needs page context)

- **Chrome content scripts run in an "isolated world"** and **cannot read** page objects or the
  `__reactProps$…` / `__reactFiber$…` keys that React stamps on DOM nodes — those live in the
  page's MAIN world. (Official: *Work in isolated worlds*,
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts.)
- DOM **attributes / textContent / href** (everything in §3) ARE readable from the isolated
  world — so the DOM-only `extractAuthor` works in a normal content script with no special setup.
- To read React state/props (§4.3–4.4) you must run that code in the **MAIN world**:
  - Manifest `content_scripts[].world: "MAIN"`, or
  - `chrome.scripting.registerContentScripts`/`executeScript` with `world: "MAIN"`
    (`ExecutionWorld` enum: `"ISOLATED" | "MAIN"`, default `ISOLATED` —
    https://developer.chrome.com/docs/extensions/reference/api/scripting), or
  - the classic trick: inject a `<script src=chrome.runtime.getURL('page.js')>` into the page and
    `postMessage` results back to the isolated content script.
- **Recommendation for this project**: keep the default isolated content script doing all DOM
  extraction + UI; if you add the rest_id fast-path, isolate it in a tiny MAIN-world script that
  posts `{statusId → rest_id}` back, and keep `UserByScreenName` as the always-correct fallback.
  This keeps `tweet-extractor.ts` pure and unit-testable.

---

## 8. Concrete extraction algorithm (final)

```
GIVEN: a node `n` that was added to the DOM
1. Find each `article = n` (or descendant) matching `article[data-testid="tweet"]`.
2. type = getTweetType(article)                       // §5
3. If type === 'PROMOTED_TWEET' and product skips ads → return null.
4. Locate the AUTHOR name block:
     nameBlock = article.querySelector('[data-testid="User-Name"]')   // first in doc order
5. authorLink = nameBlock?.querySelector('a[href*="/status/"]')
              ?? article.querySelector('time')?.closest('a[href*="/status/"]')
   { screenName, tweetId } = parsePermalink(authorLink)               // §2.1 regex
   if !screenName → screenName = handleFromAvatar(article)            // UserAvatar-Container-<handle>
   if !screenName → return null
6. displayName = first profile-link text in nameBlock, emoji via <img alt>, strip verified <svg>  // §3.2
7. avatarUrl   = article '[data-testid^="UserAvatar-Container-"] img'.src                         // §3.3
8. userId      = undefined            // DOM path; fill later
9. (optional fast-path, MAIN world) userId =
       state.entities.tweets.entities[tweetId]?.<user id>             // §4.3
       || walk __reactProps$ on a node inside `article` to a user obj with rest_id   // §4.4
10. return { screenName, displayName, tweetId, avatarUrl, userId }    // TweetAuthor
11. When the action runs and userId is still undefined:
       userId = await XListApi.resolveUserId(screenName)   // UserByScreenName, cached  // §4.2
```

---

## 9. Fragility & maintenance notes

- **Most stable hooks** (X relies on them for its own a11y/automation): `data-testid="tweet"`,
  `User-Name`, `UserAvatar-Container-<handle>`, `tweetText`, `socialContext`,
  `placementTracking`, `cellInnerDiv`, `UserCell`, `icon-verified`. Build on these.
- **Stable shapes, drifting values**: the `/<handle>/status/<id>` href pattern and the
  `[A-Za-z0-9_]{1,20}` handle char-class. Safe to hard-code the *pattern*.
- **Fragile** (isolate behind one module, expect breakage): React props/fiber tree walks, the
  visually-hidden "Quote"/"reposted" **localized** strings, positional selectors
  (`div[id^="id__"] > div[dir] > span`, `[tabindex="-1"]`), GraphQL **query ids** and the
  **bearer** token, and the `profile_images/<id>` URL heuristic.
- This matches the project's own risk note (spec §9): "X markup/query-id drift → isolate DOM in
  `page-driver`, centralize GraphQL ids in one config." Put all selectors in one `Selectors`
  table and all GraphQL ids in `GraphqlConfig.ops` (already designed).
- Both reference extensions update these every few weeks; cpft even keeps a "Add 1 every time
  this gets broken" counter on its props-walking function (`script.js:5750`) — treat fiber
  reading as inherently churny.

---

## 10. Sources

- control-panel-for-twitter (insin) — cloned `--depth 1`; read `script.js`:
  selectors (2294–2316), URL regexes (2385–2395), `getTweetType` (5716–5748),
  `getQuotedTweetDetails` (5686–5705), React state/props access
  `getTopLevelProps`/`getState`/`getStateEntities` (2782–2854), per-node `__reactProps$`
  reader `getVerifiedProps` (5751–5777), GraphQL+bearer call (2819–2848),
  timeline observers (2966–3008, 3758–3832, 6192–6266).
  https://github.com/insin/control-panel-for-twitter
- OldTwitter (dimdenGD) — `scripts/apis.js`: `rest_id`→`id_str` mapping (2728, 2792, 4165, …),
  `UserByScreenName` request + query id `sLVLhk0bGj3MVFEKTdax1w` (2686).
  https://github.com/dimdenGD/OldTwitter
- X Home-timeline GraphQL response shape (`entries[].content.itemContent.tweet_results.result`,
  `core.user_results.result.rest_id`, promoted/pinned entries): trekhleb.dev —
  https://trekhleb.dev/blog/2024/api-design-x-home-timeline/
- ScrapFly "How to Scrape X.com" — `[data-testid='tweet']`, `[data-testid='primaryColumn']`,
  `rest_id`, GraphQL doc_id drift cadence (every 2–4 weeks):
  https://scrapfly.io/blog/posts/how-to-scrape-twitter
- Reading React props from a DOM node via `Object.keys(el).find(k => k.includes('Props'))`:
  https://javascript.plainenglish.io/how-to-get-react-instance-from-dom-node-bdf44380ce25 ,
  https://techkranti.com/how-to-access-react-props-from-chrome-extension/
- Chrome — content scripts run in an **isolated world** (cannot see page JS/React keys):
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome — `scripting` API `ExecutionWorld` (`"ISOLATED" | "MAIN"`, default ISOLATED):
  https://developer.chrome.com/docs/extensions/reference/api/scripting
