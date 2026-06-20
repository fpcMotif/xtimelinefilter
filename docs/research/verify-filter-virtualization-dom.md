# Live-DOM verification: compact (0-height) hidden cells vs X's virtualization

**Status: PENDING** — compact mode (`compactHidden`) ships **opt-in, default off**. This
record gates whether height-0 collapsed cells are safe on real x.com, per
[ADR-0010](../adr/0010-filter-hides-cells-via-reversible-stub.md). Assumption is not proof
(MISSION.md): until the checks below are observed green on live x.com, treat compact mode as
experimental and do not make it the default.

## Why this exists

ADR-0010 chose a thin, measurable "· hidden — show" stub over `display:none` because X's
timeline is virtualized — it measures cell heights to place the scroll thumb and to decide when
to fetch the next page. Two risks of height-0 cells, neither visible in happy-dom:

1. **Over-fetch** — many ~0-height cells in the viewport make X think it needs more content and
   fetch page after page (runaway infinite scroll).
2. **Scroll-anchor jumps** — cells above the viewport collapsing to 0 shift the scroll offset,
   making the feed jump under the reader.

Compact mode keeps the cell node in the DOM (only its children are hidden), so it is *less*
aggressive than removing nodes — but it still enters the height-0 regime, so it must be checked.

## How to verify (verify-by-effect on real x.com)

Prereq: `bun run build`, load unpacked `dist/` in a Chromium profile signed into X.

1. On `https://x.com/home` with a populated feed, set a chip that hides most posts (e.g. `Video → only`).
2. In the **extension popup**, turn on **"Hide filtered posts completely"**.
3. Observe, scrolling several screens:
   - **No over-fetch:** the network tab does not show back-to-back `HomeTimeline`/`HomeLatestTimeline`
     fetches firing far faster than in stub mode; CPU/memory stay sane.
   - **No scroll jump:** scrolling past collapsed cells does not yank the anchor; reading position is stable.
   - **Reversible:** turning the toggle off restores the "· hidden — show" stubs; "show all" restores the
     native feed; disabling the filter restores it exactly.
   - Repeat on at least one `https://x.com/i/lists/*` timeline.
4. `scripts/live-verify-filter.console.js` reports whether `data-lasso-compact` is set and measures stub
   offsetHeight (≈0 when compact), but the over-fetch / jump checks are inherently observational — watch them.

## Pass criteria

- No runaway fetching and no scroll-anchor jumps across several screens of scrolling, on Home and a List.
- Compact mode is fully reversible (toggle off / show all / disable).

## Result

_Not yet recorded._ Fill in date, build, observations (network behavior, scroll stability,
screenshots), and verdict. If a risk reproduces, keep compact mode opt-in and file a follow-up
(e.g. clamp to a 1px hairline instead of 0, or cap how many cells collapse in-viewport) against
`src/content/filter-feature.ts` / `src/content/filter-applier.ts`.
