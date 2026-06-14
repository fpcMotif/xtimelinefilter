# Task 003 — Link classifier (impl / Green)

- **type:** impl
- **depends-on:** ["002"]
- **files:** `src/core/link-classifier.ts` (new)

## Contract

```ts
import type { LinkDest, LinkRule } from "@/core/filter-types";
export function classifyHost(href: string, userRules?: LinkRule[]): LinkDest;
```

## BDD Scenario

(Implements the scenarios in task 002 — see that file for the full Gherkin.)

```gherkin
Scenario: User rule wins over a default
  Given a user rule { host: "youtube.com", dest: "article" }
  When classifyHost("https://youtube.com/watch?v=x", [rule]) is called
  Then it returns "article"
```

## Steps (what, not how)

1. Implement `classifyHost`: parse the host from `href` (robust to malformed input — fall back to `"article"`, never throw).
2. Match against user rules first (suffix/host match), then the built-in default table (`arxiv.org`→arxiv, `news.ycombinator.com`→hn, `reddit.com`→reddit, `youtube.com`/`youtu.be`→youtube, `github.com`→github), else `"article"`.
3. Match subdomains (e.g. `old.reddit.com`).
4. Pure — no DOM, no I/O.

## Verification

- `bunx vitest run tests/core/link-classifier.test.ts` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
