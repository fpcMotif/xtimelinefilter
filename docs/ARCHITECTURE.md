# Architecture

The code favors deep modules: a small interface hides substantial implementation. A shallow wrapper must add policy, isolation, or a stable seam; forwarding alone adds no depth.

## Boundaries

- `src/content/` owns page composition, shared Tweet lookup, and ephemeral UI state.
- `src/core/` owns domain rules and orchestration.
- `src/ui/` owns Shadow DOM presentation.
- `src/background/` owns browser-data authority and Chrome lifecycle duties.
- `src/packages/` contains deep modules. Consumers import only package-root entry points. See [`src/packages/README.md`](../src/packages/README.md).
- `convex/` owns the optional Mirror's schema and server functions.

The dependency boundary gate checks cycles and package privacy across `src/`, `tests/`, `convex/`, `e2e/`, and `scripts/`.

## Deep package interfaces

- `tweet-read` is the one read home for a known Tweet. Its parsing implementation stays private. It exposes two distinct reads of "which post is this", and they are not interchangeable: `identity()` is the scanner's recycle-safe per-cell key — loose by design, ephemeral, never persisted — while `capture()` is the durable capture, host-scoped and origin-checked, keyed by status id alone and the only one fit to be written down.
- `x-client` exposes `createXPageClient`, the page-scoped facade for auth, same-origin fetch, backend replacement, GraphQL repair, List reads, and quick REST actions. `XListApi` is the mutation seam; REST, DOM, and GraphQL are adapters. Its DOM driver owns only the Lists dialog protocol.
- `tweet-actions` owns one-Tweet UI actions. Content injects keyboard-safe Escape dispatch. It injects author-caret lookup into `x-client`'s DOM driver.
- `membership-store` exposes the optional Mirror seam. Convex and null implementations share one contract.
- `folders` owns the Folders domain and the `CollectionStore` seam: the local-first database now, a Destination adapter later, chosen by one factory. It is headless and standalone — no Chrome API, no DOM, no x.com — and declares the post capture's shape itself rather than importing it, so it never reaches the content tree. No operation takes an account (ADR-0013).

Keeping these interfaces narrow improves locality: X drift, Mirror transport, and Tweet parsing each change behind one boundary. Their leverage comes from every caller sharing the same policy.

## Application seams

- `SelectionStore` owns selected Authors.
- `content/controller.ts` conducts assignment, quick actions, the default-Folder save gesture, undo, and fail-open Filter commands. It calls, but does not persist, Coach.
- The page-scoped X facade owns List discovery. The Owner-qualified cache remains separate from `XListApi` mutation.
- Production Settings and Filter stores use the worker protocol plus storage watches. `synced-store` is the direct adapter for tests and non-extension hosts.
- `background/tab-badge-writer.ts` serializes document-bound toolbar badge writes.
- `content/content-activation.ts` owns boot state, queued activation intent, dormant select mode, and badge restoration.
- `content/main.tsx` is composition only. It wires modules; it does not own their policy.

## Authority

- X is authoritative for Lists and memberships.
- The Mirror records and caches X answers. It never drives X.
- Only the active Owner's Lists are writable. Code fences Owner changes; live Owner switching still needs proof.
- The worker serializes migration, Settings, Filter, Coach, List cache and usage, GraphQL catalog, Mirror status, collections, and Privacy clear.
- Settings live in `chrome.storage.local`; Filter preferences live in `chrome.storage.sync`.
- Folders and Saved Posts live in a worker-owned IndexedDB database, not `chrome.storage`: `sync` has a quota a pill-drag has already burned once, and `local` is deliberately closed to content. The worker is the only context that opens it, through an injected factory, so no surface names the implementation. Destination tokens live under their own worker-owned key outside the Settings record, so a Settings read grant cannot reach one.
- Sender capabilities are narrow: Options owns clear and full Settings/Filter work and every collections operation; Popup reads Settings and Mirror status, reads/commands Filter, and reads the collections counts summary alone; top-level x.com content gets its allowed commands only, and for collections that is list/holding/create/save/unsave with no count read. Unknown senders fail closed.
- Storage changes fan out in order per area/key to extension pages and top-level tab content.
- Filter state is display-only and never load-bearing for List assignment.

## Mutation strategies

- REST is the default. Its web v1.1 endpoints are undocumented and may change.
- DOM drives X's visible English List UI. It requires a visible Tweet; non-English interfaces fail before it clicks. Its checked-state and Save/Done acceptance rules need live X proof.
- GraphQL is opt-in. It uses private X endpoints, resolves IDs from X bundles, caches its catalog for seven days, and retains static IDs as fallback seeds.
- Every strategy implements the same mutation interface. List discovery does not vary by strategy.

## Runtime invariants

- One explicit gesture starts one run.
- Runs are human-paced and stop on rate limits.
- Authenticated X calls are designed to stay in the content script. The worker holds no X credential. A live authenticated mutation remains unverified.
- An action snapshots its backend at start; a settings change affects the next action. Undo uses that same snapshot and removes only newly added Authors.
- UI data is rendered through Preact in open Shadow DOM, never fetched HTML.
- Mirror failure cannot alter assignment, undo, selection, or feedback.
- Hidden Filter cells remain in the DOM for restoration. Their retained overlay is CSS-hidden; keyboard and pointer target seams reject the cell until it is shown.
- Privacy clear writes a terminal migration tombstone and rotates the persisted cache-observation epoch before deletion. Old cache commits cannot revive cleared data; later work may write fresh data. It also destroys the collections database and the reserved Destination-secrets key, and reports `localCleared: false` unless the database went too — so a collections write fenced by a pre-clear token is refused rather than landing after the wipe.

## Current stack

Lasso is a Chrome Manifest V3 extension built with CRXJS and Vite. It is not a WXT project.
