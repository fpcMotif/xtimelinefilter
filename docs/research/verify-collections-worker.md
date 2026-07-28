# Live verification: the worker-owned collections database

**Status: PARTIALLY VERIFIED (2026-07-29)** — the save path is confirmed in a real
browser. Cases 2 and 3 are now covered by an automated test rather than by memory;
case 1 (survival across a worker restart) and case 5 (the page's narrower grant)
are still open.

The bug this record was written to catch was real and it caught it. `defaultCollectionStore`
reached the store through a dynamic `import()`, which Chrome MV3 forbids in a module
service worker after initial evaluation, so **every Folders operation failed in a real
browser while the entire suite stayed green** — the worker suite runs against an
injected in-memory store and the store's suite against fake-indexeddb, and neither is
Chrome. Fixed in db36485 by importing the store statically.

This is the Folders stack's first proof outside vitest, and it is the gate for
everything the worker ticket claims. **An implementing agent cannot produce or
tick it**: it needs a loaded unpacked extension, a running service worker, and a
human reading Chrome's own storage panel.

Until it is filled in, three claims stand on a fixture rather than on evidence:
the local store actually persists, the worker actually owns the database, and
Privacy Clear actually removes it. The worker suite runs against an **injected
in-memory store** — a fixture, not proof. A green suite says the logic is right,
never that Chrome behaves as assumed (MISSION.md: assumption ≠ proof).

## What is unproven

| Claim | Where the code assumes it | Checked by |
|---|---|---|
| The database persists across a worker restart | `data-lifecycle/collections.ts` reopens lazily after MV3 kills the worker | Case 1 |
| The worker — and only the worker — opens it | `defaultCollectionStore` reads `globalThis.indexedDB` | Case 2 |
| Privacy Clear destroys it | `defaultDatabaseDestroyer` → `deleteDatabase` | Case 3 |
| A close releases the connection so the delete is not `blocked` | `destroy()` closes before deleting | Case 3 |

## How to verify

1. `bun run build`, then load `dist/` at `chrome://extensions` as an unpacked
   extension with Developer mode on.
2. Open the **Options page as a tab** (`chrome://extensions` → Lasso → Extension
   options, or `chrome-extension://<id>/src/options/index.html`) and use THAT
   tab's DevTools. Sending from there is what makes the sender classify as
   `options`, the only capability allowed to submit every operation.

   Three consoles look plausible and are all wrong, each failing differently —
   this cost real time once already:

   | Console | Symptom | Why |
   |---|---|---|
   | The service worker's own | `Could not establish connection. Receiving end does not exist.` | A context cannot send itself a runtime message. `chrome.runtime` is present, so it looks right. |
   | An x.com page console | `Cannot read properties of undefined (reading 'sendMessage')` | The page runs in the main world; `chrome.runtime` exists only in extension pages and content scripts. |
   | An x.com content-script context | `undefined` returned for some operations | It classifies as `x-content`, which is denied the count reads and every post read by design. |

   Check with `location.href` before blaming the code: it must end in the
   options page path.
3. Create a Folder:

   ```js
   const begin = await chrome.runtime.sendMessage({ type: "lasso:collections", operation: "begin" });
   await chrome.runtime.sendMessage({
     type: "lasso:collections", operation: "create-folder",
     name: "Verification", token: begin.token,
   });
   await chrome.runtime.sendMessage({ type: "lasso:collections", operation: "counts" });
   ```

4. Stop and re-wake the service worker from `chrome://serviceworker-internals`
   (Stop, then send another message to wake it).
5. Inspect **Application → Storage → IndexedDB** for `lasso:folders`.
6. Run Privacy Clear from the Options page and re-inspect.

## Verdicts — to be filled in by a human

| # | Case | Expected | Observed | Verdict |
|---|------|----------|----------|---------|
| 1 | Folder survives a worker restart | after Stop + re-wake, `counts` still reports the Folder | | PENDING |
| 2 | The database exists where claimed | `lasso:folders` listed under IndexedDB | `databases: ['lasso:folders']`, `counts: {folders: 1, savedPosts: 1}` from the Options tab, Chrome 2026-07-29; and asserted every run by `e2e/mv3-smoke.spec.ts` | **PASS** |
| 3 | Privacy Clear removes it | after Clear, `lasso:folders` is gone and `clear()` returned `localCleared: true` | asserted every run by `e2e/mv3-smoke.spec.ts` against the real extension | **PASS (automated)** |
| 4 | Clear is honest when blocked | with a second tab holding the database open, Clear reports `localCleared: false` rather than hanging | | PENDING |
| 5 | The page cannot read a count | the same `counts` message from an x.com content console is denied | | PENDING |
| 6 | No new permission was needed | the extension still requests only `storage` and `webNavigation` | | PENDING |

Cases 2 and 3 moved from "a human must remember to check this" to "the suite checks it
every run": `e2e/mv3-smoke.spec.ts` loads the real extension in Chromium, drives the
collections family from a real Options page, and asserts the database exists before
Clear and is gone after. Prefer extending that test over adding manual cases here.

"Did not crash" is not a pass. Case 4 is the one most likely to surprise: the
delete resolves `blocked` rather than erroring, and the code treats that as a
failure on purpose.

## Promotion

When cases 1–6 pass, record the date and Chrome version here. Until then, treat
the worker's database ownership and Clear's coverage of it as unverified
regardless of a green suite.
