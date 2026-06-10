# 06 · TDD & Testing Architecture — Lasso (X List Assigner)

> Project: `lasso-x-list-assigner` — MV3 Chrome extension, Vite + crxjs, strict TypeScript,
> Preact + `@preact/signals` in Shadow DOM. Adds tweet **authors** to X **Lists** in bulk.
> Status: research note · Date: 2026-06-07
> Scope: define the full test-first architecture — what runs in Vitest/happy-dom, what is mocked,
> what must run under a real browser (Playwright), and a concrete layered pyramid mapped to the
> actual modules in `src/`.

This note is grounded in the existing design spec
(`docs/superpowers/specs/2026-06-07-x-list-assigner-design.md`) and the code already present:
`src/core/selection-store.ts`, `src/core/x-client/types.ts`, `tests/setup.ts`,
`tests/core/selection-store.test.ts`, `vitest.config.ts`.

---

## 0. Guiding principle — push logic out of the browser

The single most important architectural decision for testability is the one the spec already made:
**isolate every impure dependency (chrome.*, fetch, DOM) behind a thin seam, and keep the logic
pure.** Chrome's own unit-testing guidance says exactly this: *"Code written without using
extension APIs can be tested as normal… consider using techniques such as dependency injection
which can help to remove dependencies on the `chrome` namespace in your lower level
implementation. If you need to test code which includes extension APIs, consider using mocks."*
([Chrome unit testing](https://developer.chrome.com/docs/extensions/how-to/test/unit-testing)).

For this project the seams already exist:

| Impure thing | Seam (the thin impure unit) | What stays pure (the testable core) |
|---|---|---|
| `fetch` to X GraphQL | `GraphqlXListApi` (one `fetch` call site) | request builders, response parsers, `XApiError` mapping |
| Live DOM of x.com | `page-driver.ts` (`find/click/wait`) | `DomXListApi` orchestration logic |
| `<article>` markup | `tweet-extractor.ts` reads a passed-in `Element` | the extraction rules (pure given an Element) |
| `chrome.storage` | `settings.ts` + `list-cache.ts` wrappers | fuzzy ranking, cache freshness logic |
| `document.cookie` | `auth.ts` (cookie/bearer read, injectable) | credential shaping |

Because of this, ~90% of the codebase is unit-testable in Vitest with **no extension build**.

---

## 1. Tooling baseline (already installed) and why each is here

From `package.json` / `vitest.config.ts` / `tsconfig.json`:

- **Vitest 4** — Vite-native runner; reuses the same `resolve.alias` (`@ → src`) and TS/JSX
  transform as the app build, so tests import exactly what ships. `globals: true` exposes
  `describe/it/expect/vi` without imports; types come via `"types": ["vitest/globals"]`.
  ([Vitest config](https://vitest.dev/config/), [environment](https://vitest.dev/config/environment)).
- **happy-dom 20** — the default `environment` in `vitest.config.ts`. A fast, lightweight DOM
  implementation; meaningfully faster than jsdom for unit/component tests
  ([Vitest environment guide](https://vitest.dev/guide/environment),
  [happy-dom test-env setup](https://github.com/capricorn86/happy-dom/wiki/Setup-as-Test-Environment)).
- **@testing-library/preact 3** + **@testing-library/jest-dom 6** — user-centric component
  queries (`getByRole`, `getByText`, `findBy*`) plus DOM matchers (`toBeInTheDocument`).
  Preact TL is *"a lightweight wrapper around `preact/test-utils`… must be called inside a DOM
  environment"* ([Preact Testing Library guide](https://preactjs.com/guide/v10/preact-testing-library/),
  [TL Preact API](https://testing-library.com/docs/preact-testing-library/api/)).
- **@types/chrome** — types for the `chrome.*` surface we mock.
- **Biome** — lint/format (not a test tool, but `bun run lint` belongs in CI).
- **Playwright** — *not yet a dependency.* It is the recommended E2E layer (§7) and should be
  added (`bun add -d @playwright/test`) at milestone 6. Note crxjs/Vite output is what gets loaded.

### Recommended `package.json` test scripts (delta)
```jsonc
"scripts": {
  "test": "vitest run",                 // CI unit/component
  "test:watch": "vitest",               // TDD inner loop
  "test:cov": "vitest run --coverage",  // add @vitest/coverage-v8
  "test:e2e": "playwright test",        // separate project, builds extension first
  "typecheck": "tsc --noEmit",
  "lint": "biome check ."
}
```

---

## 2. Vitest + happy-dom config — recommended evolution

The current config is fine. Two refinements worth making as the suite grows:

```ts
// vitest.config.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Per-file env override beats a single global env once both pure + DOM tests exist:
    environmentMatchGlobs: [
      ["tests/core/selection-store.test.ts", "node"], // pure: no DOM, fastest
      ["tests/ui/**", "happy-dom"],
      ["tests/content/**", "happy-dom"],
    ],
    environment: "happy-dom", // default for everything else
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/ui/**/*.css", "**/*.d.ts"] },
  },
});
```

Notes:
- `environmentMatchGlobs` lets the **pure** state-machine test (`selection-store`) run in the
  `node` environment (no DOM bootstrap = fastest), while UI/content tests get `happy-dom`. You can
  also opt a file in with a docblock `// @vitest-environment happy-dom`
  ([Vitest environment](https://vitest.dev/config/environment)).
- Keep `setupFiles` for the global chrome mock + `@testing-library/jest-dom` matchers (see §3, §6).

### happy-dom limitations that shape the pyramid (important)
happy-dom (like jsdom) has **no layout/rendering engine**. `getBoundingClientRect()` returns a
zero-sized box, `offsetWidth/Height` are 0, there is no real `IntersectionObserver` visibility,
no CSS cascade/computed layout, and `.toJSON()` on a rect was historically missing
([happy-dom #1161 — getBoundingClientRect().toJSON()](https://github.com/capricorn86/happy-dom/issues/1161),
[happy-dom #1416](https://github.com/capricorn86/happy-dom/issues/1416)).

Consequences for **this** extension:
- The **floating ActionBar position**, **hover-reveal checkbox geometry**, and any
  "is this tweet visible" `IntersectionObserver` logic in `content/main.ts` **cannot be verified
  in happy-dom** — these belong in Playwright E2E (§7).
- **Shadow DOM** *is* supported by happy-dom (attachShadow/shadowRoot), so component mounting and
  query within the shadow root works — but Testing Library queries on `screen` look at
  `document.body`; for shadow-rooted components query the returned `container`/`baseElement`
  or render into a host you control (see §6).

---

## 3. Mocking `chrome.*` (storage, runtime)

### 3a. What already exists (and is good)
`tests/setup.ts` installs a **real in-memory `chrome.storage.local`** (a fake, not a stub) with
working `get/set/remove/clear` and a `__reset()` called in `beforeEach`. This is the right call
for `settings.ts` and `list-cache.ts`: they exercise actual storage semantics (key filtering,
merge-on-set) instead of asserting "was called with". `vi.restoreAllMocks()` runs each test.

### 3b. Extend the fake to cover what v1 needs
Per the spec, the surface used is: `chrome.storage.local` (settings, list cache),
`chrome.runtime` (sendMessage/onMessage between content script and `background/sw.ts`), and
`chrome.storage.onChanged` (settings reactivity). Extend `tests/setup.ts`:

```ts
// tests/setup.ts (additions)
import { beforeEach, vi } from "vitest";

// storage.onChanged: a real listener registry so list-cache/settings reactivity is testable
function createEvent<T extends (...a: any[]) => void>() {
  const listeners = new Set<T>();
  return {
    addListener: (fn: T) => listeners.add(fn),
    removeListener: (fn: T) => listeners.delete(fn),
    hasListener: (fn: T) => listeners.has(fn),
    __emit: (...args: Parameters<T>) => listeners.forEach((l) => l(...args)),
  };
}
const onChanged = createEvent<(changes: object, area: string) => void>();

// runtime.sendMessage/onMessage: default mocks (override per-test with mockResolvedValue)
const runtime = {
  sendMessage: vi.fn(async () => undefined),
  onMessage: createEvent<(msg: unknown, sender: unknown, send: (r: unknown) => void) => void>(),
  lastError: undefined as { message: string } | undefined,
  id: "test-extension-id",
};

// @ts-expect-error — minimal shim, not the full chrome typings surface.
globalThis.chrome = { storage: { local, onChanged }, runtime };
```

Then in a test you drive it:
```ts
// resolveUserId failure path bubbles a typed error to the caller
chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false, kind: "auth" });
```

### 3c. When to prefer a library vs. a hand-rolled fake
- **Hand-rolled fake (current approach): preferred here.** The chrome surface this extension
  touches is tiny (storage + runtime), the fakes are <60 lines, and they give *real* behavior.
- **`@types/chrome` + `vi.spyOn`** for one-off return values, mirroring Chrome's own Jest example
  (`jest.spyOn(chrome.tabs, "query").mockResolvedValue(...)`)
  ([Chrome unit testing](https://developer.chrome.com/docs/extensions/how-to/test/unit-testing)).
- **Libraries** (`sinon-chrome` / `jest-chrome` / `vitest-chrome`) auto-generate the *entire*
  `chrome` namespace as stubs. Useful if you touch many APIs; overkill for storage+runtime and they
  add a dependency whose typings lag the real API. Mark as *medium confidence / community* —
  consider only if the surface grows (e.g. `tabs`, `scripting`, `contextMenus`).
  ([jest-chrome write-up](https://eduardo-aparicio-cardenes.website/blog/chrome-extensions-effective-unit-testing-with-jest-chrome)).

### 3d. Critical rule: do not assert on the mock, assert on behavior
Chrome's e2e guidance generalizes to units too: *"it is generally best practice to avoid accessing
internal state… base your tests on what is visible."*
([Chrome e2e testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).
For `list-cache`, assert that a second `getLists()` returns cached data **without a second backend
call** (spy the injected `XListApi`, not chrome) and that `force: true` refetches.

---

## 4. Mocking `fetch` for the X GraphQL client (`GraphqlXListApi`)

### 4a. The real request shapes (so tests assert the right thing)
X's web app calls its **internal GraphQL** endpoints at
`https://x.com/i/api/graphql/<queryId>/<OperationName>`. The operations this project needs map
1:1 onto `GraphqlConfig.ops` in `src/core/x-client/types.ts`:

| Op | Method | URL (queryId drifts — keep in `GraphqlConfig`) | Maps to `XListApi` |
|---|---|---|---|
| `ListAddMember` | `POST` | `https://x.com/i/api/graphql/vWPi0CTMoPFsjsL6W4IynQ/ListAddMember` | `addMember(listId,userId)` |
| `ListRemoveMember` | `POST` | `https://x.com/i/api/graphql/cAGvZIu7SW0YlLYynz3VYA/ListRemoveMember` | `removeMember(...)` |
| `UserByScreenName` | `GET` | `https://x.com/i/api/graphql/IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName` | `resolveUserId(screenName)` |

(query ids from the community-maintained
[fa0311/TwitterInternalAPIDocument · GraphQL.md](https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/markdown/GraphQL.md)
— **medium confidence**: these ids rotate, which is *exactly why* the spec centralizes them in
`GraphqlConfig.ops` and the risk register flags "query-id drift".)

Required headers (from the logged-in web session, supplied by `auth.ts → Credentials`):
- `authorization: Bearer <public web bearer>` (the long `AAAA...` web bearer)
- `x-csrf-token: <ct0 cookie>` (the `Credentials.csrf` field already modeled in `types.ts`)
- `content-type: application/json` (for POST mutations)
- `x-twitter-active-user: yes`, `x-twitter-auth-type: OAuth2Session` (web-app headers)
- cookies ride along automatically (`credentials: "include"`).

POST body shape (GraphQL mutation):
```jsonc
{
  "queryId": "vWPi0CTMoPFsjsL6W4IynQ",
  "variables": { "listId": "1734...", "userId": "44196397" },
  "features": { /* the big feature-flag object from GraphqlConfig.features */ }
}
```
This is why `GraphqlConfig` carries `baseUrl`, `ops`, and `features` — the test asserts the client
assembles **this exact URL + headers + body** from `Credentials` + config.

### 4b. How to mock fetch in Vitest (recommended pattern)
Use a typed `vi.fn()` installed on `globalThis.fetch`, restored each test. This keeps the test
hermetic and lets you assert the request the client built.

```ts
// tests/core/x-client/graphql-api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import { XApiError } from "@/core/x-client/types";

const creds = { csrf: "ct0value", bearer: "AAAA-webbearer" };
const cfg = {
  baseUrl: "https://x.com/i/api/graphql",
  ops: { ListAddMember: "vWPi0CTMoPFsjsL6W4IynQ", ListRemoveMember: "cAGvZIu7SW0YlLYynz3VYA",
         UserByScreenName: "IGgvgiOx4QZndDHuD3x9TQ" },
  features: { responsive_web_graphql_timeline_navigation_enabled: true },
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => vi.restoreAllMocks());

describe("GraphqlXListApi.addMember", () => {
  it("POSTs ListAddMember to the right URL with csrf + bearer headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { list: { members_count: 12 } } }));
    const api = new GraphqlXListApi(creds, cfg);
    await api.addMember("1734", "44196397");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.com/i/api/graphql/vWPi0CTMoPFsjsL6W4IynQ/ListAddMember");
    expect(init.method).toBe("POST");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer AAAA-webbearer");
    expect(h.get("x-csrf-token")).toBe("ct0value");
    expect(JSON.parse(init.body)).toMatchObject({ variables: { listId: "1734", userId: "44196397" } });
  });

  it("maps HTTP 429 to XApiError{kind:'rate-limited'}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ code: 88 }] }, { status: 429 }));
    const api = new GraphqlXListApi(creds, cfg);
    await expect(api.addMember("1734", "44196397"))
      .rejects.toMatchObject({ kind: "rate-limited" } satisfies Partial<XApiError>);
  });

  it("maps GraphQL 'already a member' error code to XApiError{kind:'already-member'}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ code: 139, message: "already a member" }] }));
    const api = new GraphqlXListApi(creds, cfg);
    await expect(api.addMember("1734", "44196397")).rejects.toMatchObject({ kind: "already-member" });
  });
});

describe("GraphqlXListApi.resolveUserId", () => {
  it("GETs UserByScreenName and returns rest_id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { user: { result: { rest_id: "44196397" } } } }));
    const api = new GraphqlXListApi(creds, cfg);
    expect(await api.resolveUserId("elonmusk")).toBe("44196397");
  });
  it("returns null when the user is not found", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { user: {} } }));
    const api = new GraphqlXListApi(creds, cfg);
    expect(await api.resolveUserId("ghost")).toBeNull();
  });
});
```

Why a hand-rolled `vi.fn()` over MSW here:
- The client targets **one** host with a tiny op set; asserting the *outgoing* request (URL +
  headers + body) is the actual contract and is more direct with a fetch spy.
- **MSW** ([mswjs.io](https://mswjs.io/)) is worth it *medium confidence* if you later want
  realistic network-layer interception shared between unit tests and Playwright (request handlers
  reused). For v1 it adds a dependency for little gain. Use the real `Response`/`Headers` globals
  (available under happy-dom/node 18+) so the parser sees real header casing.
- Always restore: leaving `globalThis.fetch` patched leaks across files. `afterEach(vi.restoreAllMocks)`.

### 4c. Backoff / throttle testing (spec §7) — fake timers
The `429 → exponential backoff` and "conservative concurrency cap" logic is pure scheduling and
must be tested deterministically with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` so the
test does not actually wait. Keep the delay/jitter function pure and injectable (e.g. pass a
`sleep` and a `random` so jitter is seedable).

---

## 5. Testing DOM extraction with saved HTML fixtures (`tweet-extractor.ts`)

`extractAuthor(article: Element): TweetAuthor | null` is **pure given an Element** — the perfect
fixture target. Capture *real* article markup from x.com (DevTools → copy outerHTML of an
`<article data-testid="tweet">`), save under `tests/fixtures/tweets/`, and load it into happy-dom.

### 5a. The real X selectors the extractor relies on (so fixtures stay realistic)
X marks up timeline cells with stable-ish `data-testid` hooks:
- tweet cell: `article[data-testid="tweet"]`
- author block: `div[data-testid="User-Name"]` (contains display name + `@handle` link)
- handle: the `a[href^="/"]` inside `User-Name` whose text starts with `@`; the `href` is
  `/<screenName>` (no `@`) — primary source of `screenName`
- tweet text: `div[data-testid="tweetText"]`
- avatar: `div[data-testid="Tweet-User-Avatar"] img` (→ `avatarUrl`)
- tweet permalink (→ `tweetId`): `a[href*="/status/"]` (last path segment)

(`data-testid` usage on x.com is well-documented by scrapers/automation; treat exact ids as
**medium confidence** since X can rename them — which is precisely why extraction lives in one pure
unit. [SO: what is data-testid in Twitter components](https://stackoverflow.com/questions/64915354/what-is-data-testid-in-twitter-components-for-tweeter-unlike-automation-code),
[ScrapingBee: web scraping Twitter](https://www.scrapingbee.com/blog/web-scraping-twitter/),
[simonw TIL: collecting replies](https://til.simonwillison.net/twitter/collecting-replies)).
`userId` (rest_id) is **not** in the DOM → extractor returns `userId: undefined`; it gets resolved
later via `XListApi.resolveUserId`. This is already reflected in `TweetAuthor.userId?` being optional.

### 5b. Fixture-driven test pattern
```ts
// tests/core/tweet-extractor.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { extractAuthor } from "@/core/tweet-extractor";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "../fixtures/tweets", name), "utf8");

function firstArticle(html: string): Element {
  document.body.innerHTML = html;            // happy-dom parses real markup
  const a = document.querySelector('article[data-testid="tweet"]');
  if (!a) throw new Error("fixture has no tweet article");
  return a;
}

describe("extractAuthor", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("pulls screenName + displayName from a standard timeline tweet", () => {
    const author = extractAuthor(firstArticle(fixture("standard.html")));
    expect(author).toMatchObject({ screenName: "elonmusk", displayName: "Elon Musk" });
    expect(author?.userId).toBeUndefined();          // rest_id not in DOM
    expect(author?.tweetId).toMatch(/^\d+$/);
  });

  it("handles a retweet: returns the ORIGINAL author, not the retweeter", () => {
    const author = extractAuthor(firstArticle(fixture("retweet.html")));
    expect(author?.screenName).toBe("originalauthor");
  });

  it("handles a promoted/ad tweet (no real author) → null", () => {
    expect(extractAuthor(firstArticle(fixture("promoted.html")))).toBeNull();
  });

  it("handles a quote-tweet (outer author wins over quoted author)", () => {
    expect(extractAuthor(firstArticle(fixture("quote.html")))?.screenName).toBe("quoter");
  });

  it("returns null when the markup changed (no User-Name testid)", () => {
    expect(extractAuthor(firstArticle("<article data-testid='tweet'></article>"))).toBeNull();
  });
});
```

Fixture hygiene:
- Keep fixtures **small and trimmed** to just the article subtree; strip volatile junk and any PII
  beyond the public handle/name shown.
- Maintain one fixture **per edge case**: `standard`, `retweet`, `quote`, `reply`, `promoted`,
  `protected-account`, `deleted/placeholder`. Each is a regression anchor when X tweaks markup.
- Add a tiny script (`tests/fixtures/README.md`) documenting *how* a fixture was captured so they
  can be refreshed when X ships a redesign (drift mitigation per spec §9).

---

## 6. Component-testing Preact UI with `@testing-library/preact`

Components (`ListPicker`, `ActionBar`, `TweetOverlay`, `Toast`) consume the `selection-store`
signals and the actions registry — not concrete backends — so they test in happy-dom with fakes.

### 6a. Setup: jest-dom matchers + auto-cleanup
Add to `tests/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";   // registers toBeInTheDocument, toHaveTextContent, ...
// @testing-library/preact auto-runs cleanup() after each test when globals/afterEach exist.
```
Preact TL registers an automatic `cleanup()` (unmount + DOM teardown) via the test framework's
`afterEach`, so components don't leak between tests — but only when the runner exposes the global
afterEach hook, which Vitest does with `globals: true`
([TL Preact API — cleanup](https://testing-library.com/docs/preact-testing-library/api/),
[TL React setup, same model](https://testing-library.com/docs/react-testing-library/setup/)).

### 6b. The Preact-specific gotcha: render is async — use `findBy*` / `waitFor`
Preact flushes renders/effects asynchronously. The official guide warns that asserting immediately
after `fireEvent` is wrong; wrap in `waitFor` (or use `findBy*`):
*"We need this to ensure that Preact had enough time to render to the DOM and flush all pending
effects."* ([Preact Testing Library guide](https://preactjs.com/guide/v10/preact-testing-library/)).

```tsx
// tests/ui/ActionBar.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { createSelectionStore } from "@/core/selection-store";
import { ActionBar } from "@/ui/ActionBar";

describe("ActionBar", () => {
  it("is hidden when nothing is selected", () => {
    const store = createSelectionStore();
    render(<ActionBar store={store} onAssign={vi.fn()} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("shows 'N selected' reactively as the signal store updates", async () => {
    const store = createSelectionStore();
    render(<ActionBar store={store} onAssign={vi.fn()} />);
    store.add({ screenName: "alice" });
    store.add({ screenName: "bob" });
    expect(await screen.findByText(/2 selected/i)).toBeInTheDocument();  // findBy waits for flush
  });

  it("invokes onAssign with the current selection when 'Assign to list' is clicked", async () => {
    const store = createSelectionStore();
    const onAssign = vi.fn();
    store.add({ screenName: "alice" });
    render(<ActionBar store={store} onAssign={onAssign} />);
    fireEvent.click(screen.getByRole("button", { name: /assign to list/i }));
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith([{ screenName: "alice" }]));
  });
});
```

```tsx
// tests/ui/ListPicker.test.tsx — keyboard-first fuzzy picker
it("filters lists as the user types and selects with Enter", async () => {
  const lists = [{ id: "1", name: "AI folks" }, { id: "2", name: "Climbing" }];
  const onPick = vi.fn();
  render(<ListPicker lists={lists} onPick={onPick} />);
  const box = screen.getByRole("combobox", { name: /search lists/i });
  fireEvent.input(box, { target: { value: "clim" } });
  expect(await screen.findByText("Climbing")).toBeInTheDocument();
  expect(screen.queryByText("AI folks")).not.toBeInTheDocument();
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith({ id: "2", name: "Climbing" });
});
```

### 6c. Shadow DOM caveat
UI mounts inside a Shadow DOM root for CSS isolation (spec §2). `screen.*` queries scan
`document.body`; content inside a *closed* shadow root or a detached host won't be found. Two
options, both happy-dom-supported:
- Render the component directly with TL (it mounts into TL's `container` in light DOM) for unit
  tests of the component **in isolation** — fastest, recommended for `ListPicker`/`ActionBar`.
- For the shadow-root mounting logic itself (the bit in `content/main.ts` that does
  `host.attachShadow({mode:"open"})` and renders into it), query `host.shadowRoot` explicitly with
  `within(host.shadowRoot as unknown as HTMLElement)`; use `mode:"open"` so tests can introspect.
- Interaction model with **hover-reveal** + **pixel positioning** is *not* meaningfully testable in
  happy-dom (no layout) → assert presence/`aria`/class toggles here, defer visual geometry to E2E.

### 6d. `@testing-library/user-event` (optional upgrade)
`fireEvent` is sufficient and is what the Preact docs show. For higher-fidelity keyboard flows in
`ListPicker` (typeahead, arrow navigation), `@testing-library/user-event` simulates real event
sequences ([user-event intro](https://testing-library.com/docs/user-event/intro/)) — *medium
confidence* nice-to-have; add only if `fireEvent.keyDown` proves too low-level.

---

## 7. Testing the DOM-automation backend against fixture menus (`DomXListApi` + `page-driver`)

The **default** backend automates the user's own "Add to List" UI clicks (spec §2, §7). Split it:
- `page-driver.ts` — the *only* impure unit: `findAddToListControl(article)`, `openListMenu()`,
  `clickList(name)`, `waitFor(sel)`. Brittle, thin, **integration-tested** against fixtures.
- `DomXListApi` — orchestration (sequence the driver calls, map outcomes to `AssignResult`,
  apply human-paced delays). Tested against a **fake `PageDriver`** (pure) *and* against rendered
  fixture menus for the driver itself.

### 7a. Real X "Add to Lists" menu markup to fixture
The add-to-list flow on x.com opens a dialog/menu with each list as a toggle row. Useful hooks:
`div[role="dialog"]`, list rows commonly `div[data-testid="listMembershipDialogListItem"]` (or a
`label`/`checkbox` per list), and a confirm/close control. Capture the dialog's outerHTML into
`tests/fixtures/menus/add-to-list-dialog.html`. (Exact `data-testid`s are **low/medium confidence**
— they drift; the fixture *is* the contract and the test breaks loudly when X changes them, which
is the intended early-warning.)

### 7b. Two-layer test
```ts
// tests/core/x-client/page-driver.test.ts  (drive the real driver over fixture markup)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PageDriver } from "@/core/x-client/page-driver";

const menu = readFileSync(resolve(__dirname, "../../fixtures/menus/add-to-list-dialog.html"), "utf8");

describe("PageDriver", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds the add-to-list control inside a tweet article", () => {
    document.body.innerHTML = readFileSync(
      resolve(__dirname, "../../fixtures/tweets/standard.html"), "utf8");
    const article = document.querySelector('article[data-testid="tweet"]')!;
    expect(new PageDriver(document).findAddToListControl(article)).not.toBeNull();
  });

  it("clickList toggles the row matching the list name in the open dialog", async () => {
    document.body.innerHTML = menu;
    const driver = new PageDriver(document);
    await driver.clickList("AI folks");
    const row = document.querySelector('[data-testid="listMembershipDialogListItem"][aria-checked="true"]');
    expect(row?.textContent).toContain("AI folks");
  });

  it("waitFor resolves once a node appears (MutationObserver path)", async () => {
    const driver = new PageDriver(document);
    queueMicrotask(() => { document.body.innerHTML = '<div role="dialog">ready</div>'; });
    await expect(driver.waitFor('div[role="dialog"]')).resolves.toBeTruthy();
  });
});
```

```ts
// tests/core/x-client/dom-api.test.ts  (orchestration against a FAKE driver — pure, fast)
import { describe, expect, it, vi } from "vitest";
import { DomXListApi } from "@/core/x-client/dom-api";

const fakeDriver = () => ({
  findAddToListControl: vi.fn(() => ({} as Element)),
  openListMenu: vi.fn(async () => {}),
  clickList: vi.fn(async () => "added" as const),
  waitFor: vi.fn(async () => ({} as Element)),
});

describe("DomXListApi.addMember", () => {
  it("opens the menu and clicks the target list, resolving without throwing", async () => {
    const d = fakeDriver();
    const api = new DomXListApi(d, { sleep: async () => {} }); // inject no-op sleep for speed
    await api.addMember("AI folks", "ignored-userid");
    expect(d.openListMenu).toHaveBeenCalled();
    expect(d.clickList).toHaveBeenCalledWith("AI folks");
  });

  it("throws XApiError{kind:'not-found'} when the control is missing (markup changed)", async () => {
    const d = fakeDriver();
    d.findAddToListControl = vi.fn(() => null);
    const api = new DomXListApi(d, { sleep: async () => {} });
    await expect(api.addMember("AI folks", "x")).rejects.toMatchObject({ kind: "not-found" });
  });
});
```

Key points: inject `sleep` so the human-pacing delays don't slow the suite; the **fake driver**
keeps orchestration tests pure while the **fixture-backed driver** tests verify selectors. happy-dom
*does* support `MutationObserver`, so `waitFor` is testable; it does **not** support real layout, so
anything that depends on element visibility/scroll must be E2E.

### 7c. The shared-contract trick: one suite, two backends
Both `GraphqlXListApi` and `DomXListApi` implement `XListApi`. Write a **contract test** that takes
any `XListApi` factory and asserts interface-level invariants (e.g. `addMember` on an
already-member surfaces `already-member`, not a throw of a different kind). Run it twice — once per
backend — so the strategy seam stays honest.

---

## 8. The `actions` layer — testing against a fake `XListApi`

`assign-to-list.ts` orchestrates per-author `addMember` (resolving `userId` first when missing) and
collects per-item `AssignResult`s for the toast summary (spec §3 data flow, §4 error handling).
This is **pure given a fake backend**:

```ts
// tests/core/actions/assign-to-list.test.ts
import { describe, expect, it, vi } from "vitest";
import { assignToList } from "@/core/actions/assign-to-list";
import { XApiError } from "@/core/x-client/types";

const backend = (over: Partial<Record<string, unknown>> = {}) => ({
  getLists: vi.fn(async () => [{ id: "1", name: "AI folks" }]),
  resolveUserId: vi.fn(async (s: string) => (s === "ghost" ? null : "42")),
  addMember: vi.fn(async () => {}),
  removeMember: vi.fn(async () => {}),
  ...over,
});

describe("assignToList", () => {
  it("resolves userId when missing, then adds, producing an 'added' result", async () => {
    const api = backend();
    const [r] = await assignToList(api, "1", [{ screenName: "alice" }]);
    expect(api.resolveUserId).toHaveBeenCalledWith("alice");
    expect(api.addMember).toHaveBeenCalledWith("1", "42");
    expect(r).toMatchObject({ outcome: "added", author: { screenName: "alice" } });
  });

  it("skips resolve when userId already known", async () => {
    const api = backend();
    await assignToList(api, "1", [{ screenName: "bob", userId: "99" }]);
    expect(api.resolveUserId).not.toHaveBeenCalled();
    expect(api.addMember).toHaveBeenCalledWith("1", "99");
  });

  it("maps an already-member XApiError to outcome 'already-member' (no abort)", async () => {
    const api = backend({ addMember: vi.fn(async () => { throw new XApiError("already-member", ""); }) });
    const results = await assignToList(api, "1", [{ screenName: "alice" }, { screenName: "bob", userId: "7" }]);
    expect(results.map((r) => r.outcome)).toEqual(["already-member", "added"]); // continues past failure
  });

  it("yields a 'failed' result for an unresolvable handle", async () => {
    const api = backend();
    const [r] = await assignToList(api, "1", [{ screenName: "ghost" }]);
    expect(r.outcome).toBe("failed");
  });
});
```

This single suite verifies the entire error-handling matrix from spec §4 without any network/DOM.

---

## 9. E2E with Playwright — load the unpacked, built extension

### 9a. The canonical pattern (official)
Extensions load **only** in Chromium launched with a **persistent context**, using
`--disable-extensions-except` + `--load-extension`, and the `chromium` channel to allow headless
([Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)):

```ts
// e2e/fixtures.ts
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";

const pathToExtension = path.resolve(__dirname, "../dist"); // crxjs/Vite build output

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // MV3: derive id from the service worker URL
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw.url().split("/")[2]);
  },
});
export const expect = test.expect;
```

Chrome's own e2e guidance adds: run on headless machines with **`--headless=new`** (old headless
can't load extensions), and pin a **consistent extension ID** (via the `key` field in the manifest)
so you can allow-list origins and open extension pages deterministically
([Chrome e2e testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).

### 9b. What E2E must cover for THIS project (and only this)
E2E is expensive — reserve it for the things unit/component tests *cannot* prove:
- Extension actually **loads on x.com**, content script injects, overlays mount in the Shadow DOM.
- **Layout-dependent UX**: hover reveals the checkbox; the floating ActionBar appears with the
  right count and is positioned/visible (happy-dom can't do layout — §2 limitation).
- **Real wiring across worlds**: content script ↔ `background/sw.ts` via `chrome.runtime`,
  `chrome.storage` persistence of settings/list-cache across reload.
- A **DOM-backend happy path** against a *stubbed* X page (do **not** mutate real Lists in CI —
  see §9d).

### 9c. Driving extension internals (storage/SW) from a test
Inspect/seed `chrome.storage` by evaluating in an extension context. Chrome documents the
service-worker `evaluate` approach; Playwright exposes the SW via `context.serviceWorkers()`:
```ts
test("settings persist across reload", async ({ context, page, extensionId }) => {
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ backend: "dom" }));
  await page.goto("https://x.com/home");
  // ...assert UI reflects the DOM backend...
});
// Or open the popup/options page directly:
test("options page renders", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole("heading", { name: /lasso/i })).toBeVisible();
});
```
(Chrome shows the equivalent in Puppeteer/Selenium: `worker.evaluate(() => chrome.storage.local.get(...))`
and navigating to `chrome-extension://<id>/page.html`
— [Chrome e2e](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).

### 9d. Limitations & gotchas (be explicit)
- **Only Chromium, only persistent context, only Playwright-bundled Chromium.** Google Chrome /
  Edge removed the side-load flags; *"use Chromium that comes bundled with Playwright"*
  ([Playwright](https://playwright.dev/docs/chrome-extensions)). No Firefox in this flow.
- **MV3 service-worker idle suspension**: the SW suspends after ~30s idle and restarts on demand.
  Playwright keeps the same `Worker` handle alive across the restart, but an `evaluate()` *in flight
  at the moment of suspension* throws `"Service worker restarted"` — handle/retry it
  ([Playwright](https://playwright.dev/docs/chrome-extensions)). Conversely, under an attached
  debugger SWs may **not** terminate as in production (Chrome notes this for Selenium/ChromeDriver),
  so don't rely on E2E to validate termination behavior — test SW lifecycle separately if needed
  ([Chrome e2e](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing),
  [Playwright service workers](https://playwright.dev/docs/service-workers)).
- **Auth on x.com**: hitting the real logged-in timeline needs a real session — fragile, rate-
  limited, and policy-sensitive (spec §7: no mass automation). **Recommended:** serve a **local
  fixture page** that mimics the timeline DOM (reuse the §5/§7 HTML fixtures as a static page) and
  point the content script at it via `host_permissions`/test config, OR use Playwright route
  mocking (`page.route`) to stub the GraphQL responses. Reserve any real-session smoke test for a
  manual, local, non-CI run.
- **No real network writes in CI.** Never call the real `ListAddMember` against a live account in
  automated tests — stub it (route mocking or DOM-fixture page). This honors spec §7 (explicit user
  action only, conservative limits) and keeps CI deterministic.
- **Flakiness**: prefer auto-waiting locators/`expect(...).toBeVisible()` over fixed sleeps; the
  human-paced delays in the DOM backend make naive timeouts brittle.
- **Headless**: use `channel: "chromium"` (works headless) or run headed; if using a system Chrome,
  pass `--headless=new`.

### 9e. Keep E2E out of the Vitest run
Playwright tests live in `e2e/` with their own `playwright.config.ts` and run via
`bun run test:e2e` (which should `vite build` first). Vitest's `include` already excludes `e2e/`.

---

## 10. CI considerations

- **Two jobs / stages**:
  1. *Fast gate* (every push/PR): `bun install` → `bun run lint` (Biome) → `bun run typecheck`
     (`tsc --noEmit`, strict) → `bun run test` (Vitest unit/component) → `bun run test:cov`.
     This is the bulk of coverage and runs in seconds with happy-dom.
  2. *E2E* (slower; on PR-to-main / nightly): `bun run build` → `bunx playwright install --with-deps
     chromium` → `bun run test:e2e`.
- **Headless extension loading needs a display or new-headless.** Either rely on Playwright's
  bundled Chromium with `channel:"chromium"` (headless-capable), or wrap with `xvfb-run` on Linux
  CI if you must run headed. (`--headless=new` is the Chrome-side requirement —
  [Chrome e2e](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).
- **Cache**: cache `~/.bun` / `node_modules` and the Playwright browser download
  (`~/.cache/ms-playwright`) to keep E2E job times sane.
- **Artifacts on failure**: enable Playwright `trace: "on-first-retry"`, `screenshot:
  "only-on-failure"`, `video: "retain-on-failure"` — invaluable for debugging extension-load issues
  in CI ([Playwright trace viewer / CI](https://playwright.dev/docs/ci-intro)).
- **No secrets / no real X account in CI.** E2E uses fixture pages or route mocks (see §9d). Keep
  any real-session smoke test as a documented manual step.
- **Deterministic time**: `vi.useFakeTimers()` in unit tests for backoff; in E2E avoid wall-clock
  assertions and use Playwright's auto-wait.
- **Coverage gate**: enforce a threshold on `src/core/**` (the pure logic) where it's cheap to keep
  high; don't gate on `src/ui/**` geometry that lives in E2E.

---

## 11. Recommended layered test pyramid for THIS project

Bottom (many, fast, pure) → Top (few, slow, real browser). Counts are guidance, not quotas.

```
              ▲  E2E  (Playwright, built extension on x.com / fixture page)   ~5–8 specs
             ╱ ╲   load+inject, hover→ActionBar geometry, content↔SW↔storage wiring,
            ╱   ╲  DOM-backend happy path vs stubbed page
           ╱─────╲ Integration / fixture (happy-dom)                          ~25–40 tests
          ╱       ╲ page-driver over real menu HTML, tweet-extractor over tweet HTML,
         ╱         ╲ list-cache over fake chrome.storage, content/main MutationObserver
        ╱───────────╲ Component (testing-library/preact, happy-dom)           ~20–30 tests
       ╱             ╲ ListPicker, ActionBar, TweetOverlay, Toast (fakes for store/registry)
      ╱───────────────╲ Unit — pure logic (Vitest, node/happy-dom)            ~60–90 tests
     ╱_________________╲ selection-store, GraphqlXListApi(fetch-mock), auth, actions,
                          response/error mappers, backoff/throttle, fuzzy ranking
```

### Module → layer → example test names

| Module (`src/`) | Layer | Env | Mocks/fakes | Example `it(...)` names |
|---|---|---|---|---|
| `core/selection-store.ts` | Unit | node | none (pure) | *"dedupes by screenName case-insensitively and merges newly-known userId"*; *"count is a reactive computed signal"* (already written, keep) |
| `core/x-client/graphql-api.ts` | Unit | node | `vi.fn()` `fetch` | *"POSTs ListAddMember to the right URL with csrf + bearer headers"*; *"maps HTTP 429 to XApiError{kind:'rate-limited'}"*; *"resolveUserId returns rest_id"*; *"resolveUserId returns null when user not found"* |
| `core/x-client/types.ts` (`XApiError`) | Unit | node | none | *"XApiError carries kind and name"* |
| `core/auth.ts` | Unit | node/happy-dom | injected `document.cookie` | *"extracts ct0 as csrf and the web bearer into Credentials"*; *"throws auth error when ct0 cookie is absent"* |
| `core/x-client/page-driver.ts` | Integration | happy-dom | tweet/menu HTML fixtures | *"finds the add-to-list control inside a tweet article"*; *"clickList toggles the row matching the list name"*; *"waitFor resolves once a node appears"* |
| `core/x-client/dom-api.ts` | Unit | node | **fake PageDriver** + injected `sleep` | *"opens the menu and clicks the target list"*; *"throws not-found when the control is missing"* |
| `core/x-client/index.ts` (`selectBackend`) | Unit | node | settings fake | *"returns GraphqlXListApi when backend='graphql'"*; *"defaults to DomXListApi"* |
| `core/tweet-extractor.ts` | Integration | happy-dom | tweet HTML fixtures | *"pulls screenName + displayName from a standard tweet"*; *"returns the ORIGINAL author for a retweet"*; *"returns null for a promoted tweet"*; *"returns null when User-Name testid is missing"* |
| `core/list-cache.ts` | Integration | happy-dom | fake `XListApi` + chrome.storage fake | *"caches getLists and does not refetch on second call"*; *"force:true refetches"*; *"search ranks fuzzy matches"*; *"invalidates cache after TTL"* |
| `core/actions/assign-to-list.ts` | Unit | node | fake `XListApi` | *"resolves userId when missing then adds"*; *"maps already-member error to outcome without aborting"*; *"yields 'failed' for an unresolvable handle"* |
| `core/actions/registry.ts` | Unit | node | none | *"registers an action and lists it"*; *"rejects duplicate action ids"* |
| `core/settings.ts` | Unit | happy-dom | chrome.storage + onChanged fakes | *"reads defaults when storage empty"*; *"persists backend choice"*; *"notifies subscribers on change"* |
| `ui/ListPicker.tsx` | Component | happy-dom | props/fakes | *"filters lists as the user types and selects with Enter"*; *"arrow keys move the highlighted row"* |
| `ui/ActionBar.tsx` | Component | happy-dom | fake selection-store | *"is hidden when nothing is selected"*; *"shows 'N selected' reactively"*; *"invokes onAssign with current selection"* |
| `ui/TweetOverlay.tsx` | Component | happy-dom | fake store | *"toggles selection when the checkbox is clicked"*; *"quick +List opens the picker"* |
| `ui/Toast.tsx` | Component | happy-dom | props | *"summarizes 'Added 3 · 1 already in list · 1 failed'"* |
| `content/main.ts` | Integration | happy-dom | DOM fixture + MutationObserver | *"mounts an overlay when a new tweet article is added"*; *"wires hotkeys to selection-store"*; *"mounts UI inside an open shadow root"* |
| `background/sw.ts` | Integration | happy-dom | chrome.runtime/storage fakes | *"relays addMember requests to the active backend"*; *"sets sane default settings on install"* |
| whole extension | E2E | Playwright/Chromium | built `dist/`, stubbed x.com page | *"loads on x.com and injects the overlay"*; *"hover reveals the checkbox and the ActionBar shows the count"*; *"assign-to-list happy path against a stubbed page"*; *"settings persist across reload"*; *"options page renders"* |

### TDD order (red→green→refactor), straight from spec §5 — already partly done
1. `selection-store` ✅ (exists, green)
2. `GraphqlXListApi` (fetch-mocked request/response/error mapping)
3. `auth` (credential extraction from fixtures)
4. `tweet-extractor` (HTML fixtures)
5. `list-cache` (caching + fuzzy ranking)
6. `actions/assign-to-list` (fake `XListApi`)
7. `DomXListApi` + `page-driver` (happy-dom menu fixtures)
8. UI components (`ListPicker`, `ActionBar`, `TweetOverlay`, `Toast`)
9. `content/main` integration (happy-dom)
10. Playwright E2E (later milestone)

---

## 12. Open questions / risks to track

- **X query-id & data-testid drift** (spec §9): query ids (`vWPi0CTMoPFsjsL6W4IynQ` etc.) and
  `data-testid`s rotate. Mitigation already in design — centralize ids in `GraphqlConfig.ops`,
  isolate DOM in `page-driver`, anchor everything with fixtures so a drift breaks a *named* test.
- **GraphQL `features` object** is large and version-coupled; keep it in `GraphqlConfig.features`
  and assert *presence/shape* in tests, not exact contents (it changes often).
- **Real-session E2E vs policy**: don't automate real List writes in CI (spec §7). Decide on a
  static fixture page vs `page.route` GraphQL stubbing for the E2E DOM/GraphQL happy paths.
- **crxjs/Vite build for E2E**: E2E depends on a successful `vite build` to `dist/`; if crxjs
  fights the latest Vite (spec risk), the fallback multi-entry build must still emit a loadable
  unpacked extension. Unit/component tests are insulated (they never build).
- **MSW adoption**: revisit if request stubbing needs to be shared between Vitest and Playwright.
```
