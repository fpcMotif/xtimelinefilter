# Adversarial Verification — 06 · TDD & Testing Architecture (MV3)

> Verifier role: independently re-check each claim in the TDD/testing track against PRIMARY/OFFICIAL
> sources. Default to "uncertain" without corroboration; try to refute.
> Date: 2026-06-07 · Verifier: adversarial pass over `docs/research/06-tdd-testing.md`.

Methodology: `curl -sSL` on official docs (developer.chrome.com, playwright.dev, vitest.dev,
preactjs.com, testing-library.com), `gh api` for GitHub issues, shallow `git clone` of
`capricorn86/happy-dom` to read the actual source, `raw.githubusercontent.com` for the fa0311 doc,
and the in-repo reference (`reference/easy-twitter-lists/`) as a real-world capture cross-check.

---

## Claim 1 — Chrome unit-testing guidance = DI + mocks — **CONFIRMED**

Source fetched: https://developer.chrome.com/docs/extensions/how-to/test/unit-testing (last updated
2023-10-12 per page footer).

Exact text on the page:
> "Code written without using extension APIs can be tested as normal, using a framework such as
> Jest. To make code easier to test this way, consider using techniques such as dependency
> injection which can help to remove dependencies on the chrome namespace in your lower level
> implementation."
> "If you need to test code which includes extension APIs, consider using mocks."

The Jest example on the page (verbatim):
```js
// mock-extension-apis.js
global.chrome = { tabs: { query: async () => { throw new Error("Unimplemented.") }; } };
// test
test("getActiveTabId returns active tab ID", async () => {
  jest.spyOn(chrome.tabs, "query").mockResolvedValue([{ id: 3, active: true, currentWindow: true }]);
  expect(await getActiveTabId()).toBe(3);
});
```

Verdict: CONFIRMED. The quote in the claim is accurate. Minor precision note: the docs'
`mockResolvedValue` returns an **array** of tab objects (`[{id:3,...}]`), not a single object — the
claim's phrasing "mockResolvedValue(...)" is fine but anyone re-deriving the example should note the
array. Mapping to the project seams (GraphqlXListApi, page-driver, settings.ts) and the in-memory
`chrome.storage` fake in `tests/setup.ts` is a sound application, not a docs claim — and `tests/setup.ts`
does install a real fake storage area with `__reset()` in `beforeEach` (verified locally).

---

## Claim 2 — Playwright MV3 load pattern — **CONFIRMED**

Source fetched: https://playwright.dev/docs/chrome-extensions (© 2026 Microsoft footer).

Verbatim from the page:
> "Extensions only work in Chromium when launched with a persistent context."
> "Google Chrome and Microsoft Edge removed the command-line flags needed to side-load extensions,
> so use Chromium that comes bundled with Playwright."
> "Note the use of the chromium channel that allows to run extensions in headless mode."

Official fixture (verbatim):
```ts
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
});
// for manifest v3:
let [serviceWorker] = context.serviceWorkers();
if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
const extensionId = serviceWorker.url().split('/')[2];
```

Verdict: CONFIRMED on every sub-point — persistent context only, `--disable-extensions-except` +
`--load-extension`, `channel:'chromium'`, side-load flags removed from Chrome/Edge, and extensionId
= `serviceWorker.url().split('/')[2]`.

---

## Claim 3 — MV3 SW ~30s suspend; in-flight evaluate throws; debugger can prevent termination — **CONFIRMED (with attribution nuance)**

Sources: Playwright extensions page (above) + Chrome e2e page
(https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing).

Playwright page, verbatim:
> "Chrome MV3 service workers are automatically suspended after ~30 seconds of inactivity and
> restarted on demand. When this happens, Playwright keeps the same Worker object alive — no new
> 'serviceworker' event is emitted. New evaluate() calls issued during the restart window are stalled
> until the new context is ready and then resume automatically"
> note: "evaluate() calls that were already in-flight at the exact moment of suspension will throw
> with 'Service worker restarted', matching the behaviour of page navigations mid-flight."

Chrome e2e page, verbatim:
> "Note that when using some testing frameworks, service workers may not terminate automatically as
> they would in normal usage. This is the case in Selenium. It relies on ChromeDriver which attaches
> a debugger to all service workers preventing them from being stopped."

Verdict: CONFIRMED. All three sub-claims are directly supported. Two precision nuances for the
synthesis:
1. The "debugger prevents termination" statement is attributed by Chrome specifically to
   **Selenium/ChromeDriver**. The claim generalizes to "Attached debuggers can also PREVENT
   termination" — true in spirit, but the synthesis should attribute it to Selenium/ChromeDriver
   (the doc does NOT make a blanket statement that *any* debugger, e.g. Playwright/CDP, prevents it).
2. The claim says "Practical: retry SW evaluate." The Playwright doc actually says **new** evaluate
   calls during the restart window auto-resume; only calls **in-flight at the exact moment of
   suspension** throw. So a defensive retry is reasonable, but the doc's framing is "auto-resume for
   new calls, throw for the one in-flight at suspension." The conclusion "don't assert SW termination
   in E2E" is well supported.

---

## Claim 4 — happy-dom has no layout engine; geometry must go to E2E; MutationObserver + Shadow DOM ARE supported — **CONFIRMED (decisive primary-source code)**

Sources: GitHub issues + happy-dom source (shallow clone of `capricorn86/happy-dom`) + Vitest env page.

- Issue #1161 (https://github.com/capricorn86/happy-dom/issues/1161): title
  "element.getBoundingClientRect().toJSON() does not exist", state **closed**. Confirms the toJSON gap.
- Issue #1416 (https://github.com/capricorn86/happy-dom/issues/1416): title
  "`getBoundingClientRect` always returns 0", state **open**. Repro returns a zero object even with
  width/height/margin/padding set.

Direct source evidence (stronger than the issues):
- `packages/happy-dom/src/nodes/element/Element.ts` `getBoundingClientRect()`:
  ```ts
  public getBoundingClientRect(): DOMRect {
    // TODO: Not full implementation
    return new DOMRect();
  }
  ```
- `packages/happy-dom/src/dom/DOMRectReadOnly.ts` defaults all of x/y/width/height to `0`.
  → getBoundingClientRect is a literal zero box. No layout engine.
- `packages/happy-dom/src/intersection-observer/IntersectionObserver.ts`: `observe()`, `unobserve()`,
  `disconnect()` are all `// TODO: Implement` no-ops, and `takeRecords()` returns `[]`. The callback
  is **never invoked** → "no real visibility/IntersectionObserver" is exactly right.
- Shadow DOM IS supported: `Element.ts` implements `attachShadow(init)` (creates a ShadowRoot, sets
  host/mode/clonable/delegatesFocus, returns `this[shadowRoot]`) and a `shadowRoot` getter. 44 matches
  across 14 files referencing shadowRoot/slot logic.
- MutationObserver IS a real implementation: `mutation-observer/MutationObserver.ts` has real
  `observe(Node, options)`, `disconnect()`, `takeRecords()`, a `MutationObserverListener`, and stores
  observers on the window — not a stub.

Vitest env page (https://vitest.dev/guide/environment): "happy-dom emulates browser environment by
providing Browser API, and considered to be faster than jsdom, **but lacks some API**, uses happy-dom
package." This is supporting context only — the Vitest page does NOT itself enumerate the layout gap;
that comes from the happy-dom source/issues above.

Verdict: CONFIRMED. The pyramid consequence (ActionBar position, hover-checkbox geometry, tweet
"is-visible"/IntersectionObserver → Playwright E2E; tweet-detection via MutationObserver and
shadow-root mounting → unit/integration in happy-dom) is correct and now backed by the actual source.

---

## Claim 5 — @testing-library/preact renders async; assert via waitFor/findBy; auto-cleanup via afterEach — **CONFIRMED (exact quotes)**

Sources: https://preactjs.com/guide/v10/preact-testing-library/ and
https://testing-library.com/docs/preact-testing-library/api/.

Preact guide, verbatim:
> "You may have noticed the waitFor() call there. We need this to ensure that Preact had enough time
> to render to the DOM and flush all pending effects."

The page also shows the explicit WRONG pattern (verbatim comment in their code):
```ts
fireEvent.click(screen.getByText('Increment'));
// WRONG: Preact likely won't have finished rendering here
expect(screen.getByText("Current value: 6")).toBeInTheDocument();
```
and the right async-first fix using `await screen.findByText('Current value: 6')`.

TL Preact API page, verbatim on cleanup:
> "cleanup — Unmounts the component from the container and destroys the container. This is called
> automatically if your testing framework (such as mocha, Jest or Jasmine) injects a global
> afterEach() function into the testing environment. If not, you will need to call cleanup() after
> each test."

Verdict: CONFIRMED. Vitest with `globals: true` injects the global `afterEach`, so auto-cleanup
applies (Vitest behaves like the mocha/Jest/Jasmine case the docs list). Both load-bearing facts —
async render needing waitFor/findBy, and auto-cleanup tied to a global afterEach — are exact.

---

## Claim 6 — X GraphQL ops map 1:1 to GraphqlConfig.ops with concrete URLs/methods — **CONFIRMED for URLs+methods; body-shape PARTIALLY corroborated; query-id drift CONFIRMED empirically**

Source: https://github.com/fa0311/TwitterInternalAPIDocument (raw GraphQL.md) — community-maintained,
NOT official, so medium confidence as the spec already flags.

Exact matches in GraphQL.md:
- `ListAddMember` → `https://x.com/i/api/graphql/vWPi0CTMoPFsjsL6W4IynQ/ListAddMember`, Method `POST` ✓
- `ListRemoveMember` → `https://x.com/i/api/graphql/cAGvZIu7SW0YlLYynz3VYA/ListRemoveMember`, `POST` ✓
- `UserByScreenName` → `https://x.com/i/api/graphql/IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName`, `GET` ✓

All three queryIds and methods in the claim match the fa0311 doc exactly.

Body shape — caveats (the part to soften):
- The fa0311 doc lists `variables: None` and `queryId: None` for these ops (its scraper captured the
  feature-flag schema, not a populated request body). So the claim's exact body
  `{queryId, variables:{listId,userId}, features}` is NOT directly evidenced by fa0311.
- The in-repo reference `reference/easy-twitter-lists/background_add_member.js` IS a real captured
  request and corroborates most of it:
  ```js
  // POST, credentials:"include", headers: authorization + content-type:application/json + x-csrf-token
  body = JSON.stringify({
    variables: { listId: String(listID), userId: String(memberID) },
    features: { ...the feature-flag object... }
  });
  ```
  IMPORTANT DISCREPANCY: that real capture's body has **NO `queryId` field** — queryId lives only in
  the URL path. The project's own test `tests/core/x-client/graphql-api.test.ts` asserts the body
  contains `queryId: "addQID"`. Including `queryId` in the POST body is therefore an
  implementation/optional detail, not a universally-required part of the X request. The synthesis
  should not present "POST body must include queryId" as a hard external fact.
- The reference also uses **different queryIds** for the same ops (`fbJc4XYq7m2bA_UBWAj31g` for
  ListAddMember, `QK7JkzeJYfmid2ISB3H1Jw` for ListRemoveMember) than fa0311's
  (`vWPi0CTMoPFsjsL6W4IynQ`, `cAGvZIu7SW0YlLYynz3VYA`). Two independent captures → two different IDs
  for the same operation. This is *direct empirical proof* of "query ids ROTATE / drift-prone" and
  strongly validates centralizing them in `GraphqlConfig.ops` (which `src/core/x-client/types.ts`
  does, with the comment "query ids drift; keep them here").
- Headers: `x-twitter-active-user: yes` and `x-twitter-auth-type: OAuth2Session` are NOT present in
  the easy-twitter-lists capture (which sends only authorization + content-type + x-csrf-token +
  credentials:include). These extra headers are commonly required by X's web app but are not
  corroborated by the in-repo capture — treat as medium/low confidence.

Verdict: CONFIRMED for the 1:1 op→URL→method mapping and for query-id drift; the precise POST body
(esp. the `queryId` field) and the two extra `x-twitter-*` headers are only partially corroborated.
Confidence: medium, as the claim itself stated.

---

## Claim 7 — X timeline uses stable-ish data-testid hooks; rest_id NOT in the DOM — **CONFIRMED (with selector-name drift caveat)**

Sources: simonwillison TIL (https://til.simonwillison.net/twitter/collecting-replies),
ScrapingBee (https://www.scrapingbee.com/blog/web-scraping-twitter/, updated 14 Jan 2026),
plus in-repo `src/core/selection-store.ts` / `src/core/x-client/types.ts`.

simonwillison TIL (verbatim JS, scrapes the live timeline DOM):
```js
Array.from(document.querySelectorAll("[data-testid=tweet]"), (el) => {
  const username = el.querySelector('[data-testid="User-Name"] a')?.href.split("/").slice(-1)[0] || "";
  const tweet = el.querySelector('[data-testid="tweetText"]')?.innerText || "";
  ...
  // href example: https://twitter.com/simonw/status/1843290729260703801
});
```
This corroborates, exactly:
- `[data-testid=tweet]` (the claim's `article[data-testid=tweet]`)
- `div[data-testid=User-Name]` containing the author link, with `href=/<screenName>` → screenName
- `div[data-testid=tweetText]`
- tweet permalink `…/status/<id>` for tweetId (`a[href*=/status/]`)
And neither this source nor ScrapingBee extracts a `rest_id`/numeric userId from the DOM — only the
screen name from the href. → "rest_id (userId) is NOT in the DOM" is corroborated by two scrapers.

In-repo grounding: `TweetAuthor.userId?` is optional with the comment
"X numeric id (rest_id); may be unknown until resolved", and `XListApi.resolveUserId(screenName)`
exists — matching the claim's "resolveUserId step."

Caveat (the drift the claim itself predicts): ScrapingBee uses `data-testid="User-Names"` (plural)
and `data-testid="UserName"` (no hyphen, on the **profile** page), while the simonwillison timeline
example and the claim use `User-Name` (singular). So the exact testid string is genuinely
version/surface-dependent — which is precisely why the saved-HTML fixture "is the contract" and the
spec's drift mitigation (§9) applies. The claim's selectors are realistic for current timeline cells
(matching the most recent timeline-scoped source) but should be treated as medium confidence, as
stated.

Verdict: CONFIRMED. The selectors are real and current; rest_id-not-in-DOM is corroborated; only the
exact testid spelling is drift-prone (already the claim's own thesis).

---

## Claim 8 — Chrome e2e best practice: assert user-visible behavior, inspect via evaluate in extension context, navigate chrome-extension://<id>/page.html, --headless=new, consistent id via manifest key — **CONFIRMED**

Source: https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing.

Verbatim:
> "To avoid test failures when you change the internal behavior of your extension, it is generally
> best practice to avoid accessing internal state in an integration test. Instead, you should base
> your tests on what is visible to the user."
> "Extension pages can be accessed using their corresponding URL, e.g
> chrome-extension://<id>/index.html."
> "Start Chrome using the --headless=new flag (headless currently defaults to 'old', which does not
> support loading extensions)."
> "It is often desirable to have a fixed extension ID in tests… follow the steps under Keeping a
> consistent extension ID." (the "manifest key" mechanism is the linked procedure)

The state-inspection example on the page (verbatim, Puppeteer form):
```js
const workerTarget = await browser.waitForTarget(t => t.type() === 'service_worker');
const worker = await workerTarget.worker();
const value = await worker.evaluate(() => { chrome.storage.local.get('foo'); });
```
Selenium alternative: open `chrome-extension://<id>/popup.html` then `executeAsyncScript` calling
`chrome.storage.local.get('foo')`.

Verdict: CONFIRMED. All five sub-points are on the official page. Precision nuance: the
`worker.evaluate(...)` example is Puppeteer's `workerTarget.worker()` API (the claim wrote
`worker.evaluate(()=>chrome.storage.local.get('foo'))`, which is the same shape; in Playwright it's
`serviceWorker.evaluate(...)`). The "stub the X page / route-mock GraphQL in CI rather than write to a
real account" conclusion is a sound *application* of "base tests on what is visible to the user" plus
the project's own §7 safety constraints — not a verbatim Chrome statement, but a correct inference.

---

## Summary of CORRECTIONS for the synthesis

1. (Claim 1) Chrome's Jest example `mockResolvedValue` returns an **array** of tab objects, not a
   single object — keep the example faithful.
2. (Claim 3) Attribute "debugger prevents SW termination" specifically to **Selenium/ChromeDriver**
   (that is exactly how Chrome's doc scopes it). Do not imply Playwright/CDP debuggers do the same —
   the doc makes no such claim.
3. (Claim 3) Precise Playwright behavior: NEW evaluate calls during the restart window auto-resume;
   only the call **in-flight at the exact moment of suspension** throws "Service worker restarted."
   A retry is defensive, not strictly mandated by the doc.
4. (Claim 4) The "no layout / zero getBoundingClientRect / no-op IntersectionObserver" facts are best
   sourced from the happy-dom **source** (Element.getBoundingClientRect → `new DOMRect()` all-zero;
   IntersectionObserver methods are `// TODO: Implement` no-ops) and issues #1161/#1416 — NOT from the
   Vitest env page (which only says happy-dom "lacks some API"). Cite accordingly.
5. (Claim 6) Soften the POST body claim: the `queryId` field in the JSON body is optional/
   implementation-specific — the real in-repo capture (easy-twitter-lists) puts queryId ONLY in the
   URL path and omits it from the body. fa0311 lists `variables: None`/`queryId: None`.
6. (Claim 6) The `x-twitter-active-user: yes` and `x-twitter-auth-type: OAuth2Session` headers are NOT
   corroborated by the in-repo capture (which sends only authorization + content-type + x-csrf-token +
   credentials:include). Mark as medium/low confidence.
7. (Claim 6) Strengthen the query-id-drift point with the concrete evidence: easy-twitter-lists uses
   `fbJc4XYq7m2bA_UBWAj31g`/`QK7JkzeJYfmid2ISB3H1Jw` while fa0311 uses
   `vWPi0CTMoPFsjsL6W4IynQ`/`cAGvZIu7SW0YlLYynz3VYA` for the SAME ops — direct proof of rotation.
8. (Claim 7) Flag the testid drift explicitly: `User-Name` (singular, timeline) vs `User-Names`
   (plural, ScrapingBee) vs `UserName` (profile page). The current timeline selector is `User-Name`;
   the fixture-is-the-contract framing handles this.
