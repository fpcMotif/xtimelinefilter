# Live-DOM verification: the durable capture

**Status: PARTIALLY VERIFIED (2026-07-29)** — case 1 confirmed on live x.com via
the save gesture (#70). The remaining cases are still open. The hooks
`tweet-read`'s `capture()` relies on are **assumptions** about x.com's DOM until a human
confirms them on the live site with a logged-in session. happy-dom unit tests prove the
capture *logic*, never that the selectors match real posts (MISSION.md: assumption ≠ proof).

An implementing agent cannot produce or tick this record: it needs a logged-in x.com
session and human eyes on real posts. Until the verdicts below are filled in, the new
hooks stay **AMBER**.

Siblings: [facets](verify-filter-dom.md), [virtualization](verify-filter-virtualization-dom.md).

## What is AMBER

`src/content/selectors.ts` → `CaptureSelectors`:

| Hook | Selector under test | Produces (`capture()`) |
|------|--------------------|------------------------|
| Media image | `img[src]` inside a matched `FacetSelectors.PHOTO` node | `media[].url` for a photo |
| Video poster | `video[poster]` inside a matched `FacetSelectors.VIDEO` node | `media[].url` for a video |
| Video thumbnail | `img[src]` inside a matched `FacetSelectors.VIDEO` node (fallback) | `media[].url` for a video |
| Timestamp | `time` (host-scoped), `datetime` attribute | `postedAt` |
| Follow button | `[data-testid$='-follow'], [data-testid$='-unfollow']`, digits-only prefix | `author.userId` |

Reused, already-tabled hooks the capture also leans on — re-check them opportunistically
while you are here, but they are not what this record gates:
`Selectors.STATUS_LINK_IN_NAME`, `Selectors.TWEET`, `Selectors.TWEET_TEXT`,
`Selectors.AVATAR_CONTAINER`, `Selectors.AVATAR_IMG`, `FacetSelectors.PHOTO`,
`FacetSelectors.VIDEO`.

The numeric `author.userId` is read from the follow button's testid prefix
(`<rest_id>-follow`), the only place a tweet article is believed to expose it. Research 03
§4 is otherwise right that `rest_id` is **not** a DOM attribute, so expect this field to be
absent on most timeline posts — that is correct behaviour, not a miss. Deliberately **not**
read from the avatar CDN path: `/profile_images/<digits>/` is the image's own id, not the
user's, and populating a field named `userId` from it would write wrong data into a durable
record. This hook is the least-verified entry here; case 8 below is where it gets settled.

## How to verify

Verify **by effect**, on live x.com, with a logged-in session — not against a fixture.

1. Open `https://x.com/home` with a populated feed. Scroll until the view holds a plain
   text post, a photo post, a native video post, a quote tweet, a repost, and (if one
   appears) a promoted unit.
2. In DevTools, load the built extension's `capture` or paste an equivalent probe, then
   for each `article[data-testid="tweet"]` in view record what came back.
3. Cross-check each result against what the post visibly is — the id against the
   permalink you get from the post's own "Copy link", the author against the visible
   handle, the text against what is rendered, the media URL by opening it.

## Verdicts — to be filled in by a human

| # | Case | Expected | Observed | Verdict |
|---|------|----------|----------|---------|
| 1 | Plain post | usable id, permalink, author, text, media, posted-at | Alt+Shift+B on a live Home post filed `@nomiso_jiru` with its text and a composed `https://x.com/nomiso_jiru/status/2082026756043858224`; read back from the store. Media and posted-at not inspected. | **PASS (id, permalink, author, text)** |
| 2 | Quote tweet | the **host** post's id — never the quoted post's | | PENDING |
| 3 | Repost | the **underlying** post's id and original author | | PENDING |
| 4 | Photo post | `media: [{kind:"photo", url}]`, url opens the image | | PENDING |
| 5 | Native video | `media: [{kind:"video", url}]` from poster or thumbnail, counted once after the player hydrates | | PENDING |
| 6 | Promoted unit | its own id, permalink and author like any other post | | PENDING |
| 7 | Posted-at | ISO instant matching the post's visible time | | PENDING |
| 8 | Author user id | on a post whose article renders a Follow button: `userId` equals that account's real `rest_id` (cross-check against a `UserByScreenName` response or the profile's own markup). Absent elsewhere. | | PENDING |

A case only passes on a **positive and a negative** sample where one exists. "Did not
crash" is not a pass.

Case 5 also settles a structural question the code currently guards defensively: once a
player hydrates, is the poster still a `tweetPhoto` **nested inside** the video node, or
has it been swapped out entirely? `capture()` drops a photo node nested in a player so one
media item yields one entry. Record which shape you actually see.

Case 8 is the one hook with no prior repo evidence. If the Follow button's testid prefix
turns out **not** to be the `rest_id`, drop the hook and let `userId` stay absent — do not
substitute the avatar path.

## Promotion

When cases 1–7 pass, drop the AMBER note from `CaptureSelectors` in
`src/content/selectors.ts` and record the date and X build here. Case 8 gates only the
`FOLLOW_BUTTON` entry and `FOLLOW_BUTTON_USER_ID_RE`; the rest may be promoted without it.
