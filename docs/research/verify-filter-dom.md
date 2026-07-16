# Live-DOM verification: the AMBER FacetSelectors

**Status: PENDING** — `src/content/selectors.ts` `FacetSelectors` are **assumptions** about
x.com's DOM until confirmed on the live site. `tweet-read/facets.ts` reads each Tweet's Facets
through them; happy-dom unit tests prove the extraction *logic*, never that the selectors match
real posts (MISSION.md: assumption ≠ proof). This record gates promoting them from AMBER to
verified. Sibling record: [virtualization / compact mode](verify-filter-virtualization-dom.md).

## What is AMBER

`src/content/selectors.ts`:

| Facet | Selector under test | Produces (`facets.ts`) |
|-------|--------------------|------------------------|
| Photo | `[data-testid="tweetPhoto"]` | `hasPhoto` |
| Video | `[data-testid="videoPlayer"], [data-testid="videoComponent"]` | `hasVideo` |
| Card | `[data-testid="card.wrapper"]` | `hasLink` (card arm) |
| Quote | `[data-testid="tweet"] [data-testid="tweet"]` | `hasQuote` *(most uncertain)* |
| Link | `a[href^="http"]` | `linkHosts` |
| Repost | `[data-testid="socialContext"]` | `role:repost` |
| Lang | `[data-testid="tweetText"]` `lang` attr | `lang` |

Engagement (`engagement:liked`) was added 2026-06-27 and is **already verified** (see below),
so it is no longer AMBER. Bookmarked was dropped — no inline DOM signal exists.

Plus the structural anchors everything hangs off: `article[data-testid="tweet"]`,
`div[data-testid="cellInnerDiv"]`.

## How to verify

`scripts/verify-facet-selectors.console.js` is a **verify-by-ground-truth** probe — no extension
build needed.

1. Open a logged-in `https://x.com/home` (also test an `/i/lists/*` timeline and a media-heavy
   profile) with a populated feed.
2. DevTools → Console → paste the whole script → Enter.
3. **Scroll several screens** through mixed content — photos, native video, a GIF, a quote, a
   link-preview card, a poll/Spaces card, reposts — and **re-run** to fill in `NO-SAMPLE` rows.
4. Also: open a **profile** (for a pinned post) and a feed showing a **Promoted** unit — both
   carry `socialContext`, so the repost selector can only be cleared after seeing them.

The probe does **not** trust the selector. For each facet it computes an *independent*
ground-truth from a different DOM fact (e.g. photos by their `pbs.twimg.com/media/` CDN path, not
by `tweetPhoto`), keys every post by its `/status/<id>`, evaluates the **whole** Facets vector in
one pass, then re-runs after a settle delay to expose the lazy video-player hydration swap.

### Verdicts

- **PASS** — selector agreed with ground-truth on ≥1 positive *and* ≥1 negative sample.
- **FAIL** — they disagreed; selector drift or over/under-match. The printed ids are the posts.
- **NO-SAMPLE** — no positive (or no negative) sample in view. Scroll & re-run; not a pass.
- **SUSPECT-DRIFT** — media-heavy page but the selector never matched once. Likely renamed.
- **EYEBALL** — no DOM-independent oracle (cards, the *value* of `lang`/`linkHosts`). Samples are
  printed; a human must confirm.
- **NO-FP-OBSERVED** (repost only) — agreed in-view, but `socialContext` is known over-broad
  (pinned/promoted/community), so this never auto-passes; needs the profile + promoted run.

## Engagement facet (liked) — VERIFIED 2026-06-27; bookmarked dropped

The `engagement:liked` criterion (hide what the Owner already liked) reads `[data-testid="unlike"]`
host-scoped. **Verified live 2026-06-27** via a read-only oracle that needs no clicks: the
Bookmarks page (every post the Owner saved — and, for this Owner, liked) showed `unlike` on
**11/11** outermost posts; the Home timeline (un-liked) showed `unlike` on **0/11** and `like`
on 11/11. aria-label "已喜歡" (Liked) confirms the button. Host-scoping is logically safe because
a quoted post renders **no action bar** (so no like/unlike to leak); unit-tested in
`facets.test.ts`.

**Bookmarked was designed but dropped.** Live inspection (viewport 1876px, full 600px column, so
not a narrow-width artifact) found the inline action bar is exactly `reply · retweet · like ·
share` — there is **no bookmark button anywhere in the document** (`[data-testid*="bookmark"]`
matched 0 nodes). This build surfaces bookmarking only through the Share menu, so there is no DOM
signal to read. Deferred to a GraphQL-bookmarks follow-up (match status ids), which is the
"fetch" path the original timeline-filter design scoped out.

**Still UNCONFIRMED (non-blocking):** U1 — whether a *live* like-toggle is an `attributes` flip
of `data-testid` on the same node or a `childList` button-node swap. The applier observer watches
**both** (correct either way); `__lassoEngagementMechanism()` in the probe logs which actually
fires (avoided here to not like a random post). U3 — post types whose action bar is absent
(promoted/conversation/logged-out) fail open to shown, which is acceptable.

## Known false-confidence traps the probe defends against

Surfaced by an adversarial review of the probe design (do not regress these):

1. **Lazy video hydration** — a freshly-scrolled video post is byte-for-byte a `tweetPhoto`
   (memory `x-lazy-video-hydration`), so it reads `hasPhoto=true, hasVideo=false`. The probe keys
   by `/status/id` and re-runs after a settle delay; a post that flips photo→video is reported as
   a hydration swap, not two unrelated rows.
2. **Quote-bleed** — `facets.ts` uses unscoped `querySelector`, so a quoted post's photo/link/
   socialContext counts as the host's. The probe runs SEL unscoped (faithful) but GT host-scoped,
   so quote-bleed surfaces as a divergence instead of cancelling to a false PASS.
3. **Feedback-panel phantom** — the not-interested panel keeps `data-testid="tweet"` but has no
   caret; the probe samples only posts with a caret + permalink, so the panel can't masquerade.
4. **Over-broad `OUTBOUND_LINK`** — safe only because X uses *relative* hrefs for avatar/permalink/
   quote anchors. The probe audits every raw `a[href^="http"]` and warns if any is one of those.
5. **`hasLink` is `hasCard || linkHosts.length>0`** — a poll/Spaces card sets `hasLink` with no
   real outbound link; flagged for eyeball, not silently passed.

## Pass criteria

All seven facets reach **PASS** or a deliberately-recorded **EYEBALL**/repost confirmation across
Home, a List, and a profile, with no `FAIL`/`SUSPECT-DRIFT` and no `§8 fail-open` violation. Any
`FAIL` → fix the hook in `src/content/selectors.ts` (the one place, ADR-0004) and re-run.

## Result

**2026-06-27 — engagement only (Claude in Chrome, logged-in x.com, zh-Hant UI):**

| Facet | Selector | Pages | Verdict |
|-------|----------|-------|---------|
| Liked | `[data-testid="unlike"]` (host-scoped) | Home, /i/bookmarks | **PASS** — 0/11 on un-liked Home, 11/11 on the Bookmarks page; aria "已喜歡" |
| Bookmarked | _none exists_ | Home, /i/bookmarks | **DROPPED** — no inline bookmark button in the action bar (global `[data-testid*="bookmark"]` = 0) |

The other facets (photo/video/quote/link/repost/lang) were **not** re-run in this pass and remain
AMBER — their verification is still outstanding per the table above.
