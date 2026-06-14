# The Filter hides posts by collapsing the cell to a reversible stub, never by removing it

The Filter's job is to make unwanted posts go away while you read Home or a List. The obvious move — `display:none` on the post's `div[data-testid="cellInnerDiv"]` — is exactly the kind of change that passes every local test and then misbehaves on live x.com, which is the failure class MISSION.md exists to prevent. X's timeline is virtualized: it measures cell heights to position the scroll thumb and to decide when to fetch the next page (the scanner already notes this — "virtualized timeline mounts/unmounts them"). A height-0 cell can trip infinite-scroll into over-fetching and can jump the scroll anchor as cells above the viewport collapse. None of that shows up in happy-dom.

So we decided: the Filter collapses a hidden post to a **thin "· hidden — show" stub** (a small, measurable height) rather than removing it from layout. The stub keeps X's height math roughly sane, and it doubles as the inline un-hide affordance — clicking it reveals that one post without touching the rest of the filter.

Concretely (`content/filter-applier.ts`):

- **The Filter only ever toggles its own collapsed state on the cell.** It never deletes nodes and never edits anything X owns, so disabling the Filter or clicking "show" restores the native feed exactly.
- **Re-classify on every mount; never trust a cached verdict on a recycled node.** X mounts/unmounts cells as you scroll; a stub state must be recomputed from the current Tweet's Facets, or a recycled node would carry the wrong verdict.
- **Fail open.** A post whose Facets can't be read, or any throw in the applier, is shown — the Filter never hides a post it couldn't classify, and never hides the whole feed if its selectors break (a breakage-health guard watches for an implausible all-hidden distribution).
- **Never load-bearing.** A Filter failure leaves the page and the List-assign flow byte-for-byte unchanged (same posture as the Mirror, ADR-0009).

Trade-off accepted: a stub is visually less clean than a post vanishing entirely, and a row of stubs in a heavily-filtered feed is its own kind of clutter. We chose that over the live-virtualization risk of `display:none`. Full `display:none` stays open as a future upgrade **only** behind a live-DOM verification note (`verify-filter-virtualization-dom.md`) proving real x.com tolerates height-0 cells without over-fetch or scroll jumps — assumption is not proof (MISSION.md).
