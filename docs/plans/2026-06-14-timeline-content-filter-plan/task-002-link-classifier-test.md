# Task 002 — Link classifier (test / Red)

- **type:** test
- **depends-on:** ["001"]
- **files:** `tests/core/link-classifier.test.ts` (new)

## Contract under test

```ts
// src/core/link-classifier.ts (impl in task 003)
import type { LinkDest, LinkRule } from "@/core/filter-types";
export function classifyHost(href: string, userRules?: LinkRule[]): LinkDest;
```

## BDD Scenario

```gherkin
Scenario: Built-in host maps to its destination
  Given the default Link rules
  When classifyHost("https://arxiv.org/abs/2401.00001") is called
  Then it returns "arxiv"

Scenario: Each built-in host maps correctly
  Given the default Link rules
  Then "news.ycombinator.com" → "hn", "reddit.com" → "reddit",
       "www.youtube.com" and "youtu.be" → "youtube", "github.com" → "github"

Scenario: Unknown external host falls back to Article/Blog
  Given the default Link rules
  When classifyHost("https://example.com/some-post") is called
  Then it returns "article"

Scenario: User rule wins over a default
  Given a user rule { host: "youtube.com", dest: "article" }
  When classifyHost("https://youtube.com/watch?v=x", [rule]) is called
  Then it returns "article"

Scenario: Subdomains and malformed input
  Given the default Link rules
  Then "https://old.reddit.com/r/x" → "reddit"
  And classifyHost("not-a-url") does not throw and returns "article"
```

## Steps

1. Write the failing test file covering every scenario above (vitest).
2. Use a small table of (input host, expected dest). Include subdomain + malformed-URL cases.
3. Assert user-rule precedence by passing a `userRules` array.

## Verification

- `bunx vitest run tests/core/link-classifier.test.ts` runs and **fails** (Red) — module not yet implemented.
