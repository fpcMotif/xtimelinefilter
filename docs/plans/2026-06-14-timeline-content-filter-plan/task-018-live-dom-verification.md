# Task 018 — Live-DOM verification gate (MISSION.md)

- **type:** verification (human-in-the-loop on live x.com)
- **depends-on:** ["016"]
- **files:** `verify-filter-dom.md` (new, repo root, alongside existing `verify-*.md` notes)

## Why this task exists

MISSION.md: a green local test means nothing if the fixtures encoded our assumptions instead of X's real DOM. Every facet selector and the stub's effect on virtualization must be confirmed on **live x.com** before we trust them. This is the gate that turns "green-dot" facets from assumed to verified.

## BDD Scenario

```gherkin
Scenario: Each facet selector is confirmed on live x.com
  Given the built extension loaded on a real logged-in /home and a real List
  When a human inspects real posts of each kind
  Then tweetPhoto / videoPlayer|videoComponent / card.wrapper / nested-quote /
       socialContext-repost / tweetText[lang] each select the intended posts
  And any selector that misses is corrected in content/selectors.ts (FacetSelectors)
  And the findings (with dates, like the existing verify-*.md notes) are recorded

Scenario: The stub does not disturb X's virtualization
  Given the filter is hiding a meaningful fraction of a live feed
  When the user scrolls Home and a List
  Then there is no runaway over-fetch and no scroll-anchor jump attributable to the stub
  And if a problem is observed, it is recorded and the stub height/strategy adjusted
  (ADR-0010 keeps full display:none gated behind this same note)

Scenario: The language attribute is reliable
  Given Japanese, English, and mixed/undetectable posts on live X
  Then tweetText[lang] reflects the post language often enough to gate on,
       and undetectable posts fall through as "show" (fail-open) as designed
```

## Steps

1. Build (`bun run build`), load unpacked, exercise a real `/home` and a real List while logged in.
2. Confirm each `FacetSelectors` entry against real posts; fix `content/selectors.ts` for any miss (especially the AMBER `QUOTE`).
3. Observe scroll/over-fetch with the filter hiding posts; record results.
4. Write `verify-filter-dom.md` with dated findings (match the existing `verify-tweet-author-dom.md` format). No facet is considered shippable until covered here.

## Verification

- `verify-filter-dom.md` committed, each green-dot facet marked confirmed (or corrected), and the stub-virtualization observation recorded. This task is **not** auto-testable — its artifact is the signed-off note.
