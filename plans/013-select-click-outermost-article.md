# 013 — Select-mode clicks must resolve the outermost article (quote-tweets)

- **Status**: TODO
- **Commit**: 7ce587e
- **Severity**: HIGH (ships the wrong person to a List)
- **Category**: Bugs & correctness
- **Rule**: Beyond the scan (manual)
- **Estimated scope**: 2 source files (`src/content/main.tsx` + 1 new tiny module) + 1 test file

## Problem

Quote-tweets nest one `article[data-testid="tweet"]` inside another. The codebase's own targeting rule says the outermost article owns the caret and author, and the mousemove path implements a climb:

```ts
// src/content/main.tsx:132-138 — current (mousemove, correct)
      let t = (e.target as Element | null)?.closest?.(Selectors.TWEET) ?? null;
      // Quoted tweets nest articles — the outermost one owns the caret and author.
      while (t) {
        const outer = t.parentElement?.closest(Selectors.TWEET);
        if (!outer) break;
        t = outer;
      }
```

(The same climb exists independently in src/core/x-client/caret-actions.ts:242-245, and nested-article fixtures are real: tests/core/x-client/caret-actions.test.ts:75.)

But the select-mode click handler resolves the INNERMOST article:

```ts
// src/content/main.tsx:214-220 — current (click, wrong)
      const article = origin?.closest?.(Selectors.TWEET);
      if (!article) return;
      const author = extractAuthor(article);
      if (!author) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      controller.toggleSelect(author);
```

Failure scenario: select mode on, the user clicks the body of a post that quote-tweets someone. The click lands inside the nested quoted article → `closest` returns it → `extractAuthor` returns the **quoted** account → the wrong person is selected and later added to the List, while the hover overlay the user was looking at highlighted the **outer** author. A user sweeping a thread of quote-tweets files a batch of wrong accounts.

## Target

Extract the climb into one named helper and use it in both the mousemove and click paths, so the two paths can never disagree again.

```ts
// src/content/outermost-tweet.ts — new file
import { Selectors } from "@/content/selectors";

/**
 * Resolve the outermost tweet article from a point inside it. Quoted tweets
 * nest articles — the outermost one owns the caret and author (ADR-0004).
 */
export function outermostTweet(from: Element | null): Element | null {
  let t = from?.closest?.(Selectors.TWEET) ?? null;
  while (t) {
    const outer = t.parentElement?.closest(Selectors.TWEET);
    if (!outer) break;
    t = outer;
  }
  return t;
}
```

```ts
// src/content/main.tsx — mousemove handler body (replacing lines 132-141)
      const t = outermostTweet(e.target as Element | null);
      visualHover.value = t;
      if (t) hoveredSticky = t;
```

```ts
// src/content/main.tsx — click handler (replacing line 214)
      const article = outermostTweet(origin);
```

Everything else in both handlers stays byte-identical. Do NOT touch the separate climb in caret-actions.ts — `core/` must not import from `content/` (layering), and that copy is already pinned by tests.

## Repo conventions to follow

- Small single-purpose modules with a product-reason doc comment — imitate `src/content/get-focused-tweet.ts`.
- `@/` path alias imports, type-only imports where possible.
- Tests: vitest + happy-dom DOM fixtures — imitate the nested-article fixture in `tests/core/x-client/caret-actions.test.ts:75`.

## Steps

1. Create `src/content/outermost-tweet.ts` with the exact code above.
2. In `src/content/main.tsx`, import it and replace the two resolution sites (mousemove lines 132-141, click line 214) as shown. Delete the now-inlined climb loop and keep the explanatory comment on the helper only.
3. Add `tests/content/outermost-tweet.test.ts`: build `<article data-testid="tweet"><div id="outer-body"><article data-testid="tweet"><p id="inner-text"/></article></div></article>`; assert `outermostTweet(innerText)` returns the OUTER article; assert a non-nested article returns itself; assert an element outside any article returns null.
4. Re-read the diff and remove unrelated churn.

## Boundaries

- Do NOT change `caret-actions.ts` or `tweet-scanner.ts` (the scanner intentionally reports nested quoted articles so the quoted author also gets an overlay — that per-overlay path is by design; only the whole-body click must target the outer author).
- Do NOT change the click handler's guard order, `preventDefault`, or `stopImmediatePropagation` semantics (plan 002 touches trust-gating in this area — coordinate via the README order).
- Do NOT add dependencies.
- STOP if `src/content/main.tsx` has drifted from commit 7ce587e (plan 011 also edits this file — land 011 first per README order); report drift instead of improvising.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run format:check && bun run test` all exit 0. `npx react-doctor@latest --scope changed` adds no new diagnostics, score not lower than baseline 62.
- **Behavior check**: on x.com, enable select mode, click the body text of a quote-tweet: the OUTER author's overlay must check, and the ActionBar facepile must show the outer author. Hover the same post and confirm the overlay that lights up is the same one the click selects.
- **Done when**: the new unit test passes, the quote-tweet click selects the outer author live, and required checks pass.
