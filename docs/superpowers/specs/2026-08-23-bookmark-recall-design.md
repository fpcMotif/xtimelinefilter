# Bookmark Recall — find a bookmarked post again

**Status:** Design — awaiting review. UI mockups pushed to the claude.ai/design "Lasso — Lariat
Design System" project (house rule: design review before code). No product code has landed.
**Date:** 2026-08-23. **Branch:** `autoresearch/improve-the-reale-the-bookmark-lit-for-x-it-curr-20260823`.
**Builds on:** ADR-0013 Folders (#41), the Bookmarks-timeline Filter scope (#25/#26, landed
`f1c7028`), and #78's deferral of "reading X's existing bookmark history".

> **Provenance.** Produced by an 8-seam code/policy exploration, four independent designs from
> fixed angles (on-page-first, index-first/GraphQL, Folders-first, MVP-first), each scored by three
> judges (policy, architecture, user value) and a completeness critic — all on Sonnet — then
> synthesised here. Scores and the rejected angles are in §12. Every file:line claim below was
> re-verified against HEAD `e5d5ff5` before being written down.

## 1. Problem

X's Bookmarks are one undifferentiated, chronological pile. The only free way to find a post you
bookmarked months ago is to scroll the whole history; folders are a Premium feature, and X's
virtualised timeline destroys off-screen cells as you go, so even Lasso's Filter can only narrow
what happens to be mounted. ADR-0013 already names this ("X's Bookmarks are one undifferentiated
pile") and built Folders as the free answer — but Folders only know about posts the user files
*from now on*. Nothing reaches the pile that already exists, and nothing searches what Lasso
has filed: `savedPosts` has zero secondary indexes (`src/packages/folders/lib/schema.ts:52-54`),
`note`/`tags` exist in the schema and the worker protocol but **no UI reads or writes them**, and
the only reads are by exact status id or a per-Folder page.

**Recall** is a different job from **filtering**. Filtering narrows what is on screen. Recall
answers "that post about Rust lifetimes from a few months ago" in under ten seconds, whether or
not it is on screen. Recall needs a durable index that outlives the DOM. Lasso already owns one:
the worker-owned Saved Posts database. This spec makes that index (a) populated from the
existing pile, and (b) searchable from the page and from Options.

## 2. Goal & non-goals

**Goal.** A user with 500–3000 X bookmarks can (1) move their existing pile into Lasso Folders
screen by screen with one key per screen, and (2) find any post Lasso holds by text, author, tag
or date from an in-page overlay or the Options workshop — offline, account-free, with no new X
request.

**Non-goals (explicit, with the standing decision each one keeps).**

- **No GraphQL read of X's bookmark history.** #41 and #78 both park it; the operation name,
  query id and envelope are unverified anywhere in the repo (`rg -ni bookmark
  src/packages/x-client/*.ts` → 0 hits), and an Options-hosted trigger cannot reach an x.com
  content script (§12, design B). Revisit only after a live bundle-scrape record and a separate
  product/policy decision.
- **No sticky "file as you scroll" mode.** It is the self-draining queue ADR-0005 invariant 1
  names, and reintroduces "import my whole history" by another door (§5 D4).
- **No on-page free-text narrowing of the live timeline.** Capped by mount-visibility, pays its
  DOM reads on every scope, and trips `classify()`'s `activeCriteriaCount === 0` fast path
  (`src/content/filter-applier.ts:136`). Kept as a principle — a query is never a `CriterionId` —
  not as the mechanism (§12, design A).
- **No popup recall.** ADR-0013's Popup Saved-row amendment pins the popup's collections grant to
  the counts read; widening it is its own decision.
- **No Bookmarked criterion, no X Premium folders, no bindable Bookmarks scope, no saved/smart
  Folders.** Unchanged from #25, ADR-0013 and its Flat-Folders amendment.

## 3. Behaviour

Three gestures. Each is one explicit key, one bounded run, one honest toast.

### 3.1 File what's loaded — `Alt+Shift+F` on `/i/bookmarks`

On the Bookmarks timeline (and only there — `resolveScope(location.pathname).kind ===
"bookmarks"`, `src/content/route.ts:26-27`), `Alt+Shift+F` opens the Folder Picker in **batch
mode** for every post currently rendered. The picker's title says how many ("File 22 posts into a
Folder"); each Folder row says how many of those it already holds ("holds 4 of 22") instead of
the single-post checkmark. Enter files the batch into the chosen Folder in one worker operation
and shows one toast:

> **Filed 18 posts into Research** · 4 already there · 140 filed this visit — **Undo**

Undo reverses exactly what that press created: the 18 membership rows, and the Saved Post rows
this press minted that no other Folder holds. It is the existing single-slot `UndoRegistry`, ten
seconds, last-wins. The "this visit" tally is display-only session state so the user can tell
how far they have got; it is never persisted.

The batch is what X has mounted at the moment of the keypress: the user scrolls, presses again,
and the next screenful is filed. Posts already held by the chosen Folder are counted, never
duplicated (saved-once is the database's key layout, ADR-0013). Promoted units and nested
quote-tweet articles are excluded before capture. A post whose status id cannot be read is
skipped and counted in the toast ("2 couldn't be read"), never filed under an invented id.

### 3.2 Recall overlay — `Alt+Shift+R` on any in-scope x.com timeline

Opens a combobox-over-listbox overlay (the Folder Picker's shape, `src/ui/FolderPicker.tsx`)
titled "Find a saved post". Typing searches Lasso's Saved Posts — not the page, not X — with
this grammar, all terms ANDed, case-insensitive:

| Token | Matches |
|---|---|
| bare words | substring of post text, note, or author handle |
| `@handle` | author screen name |
| `#tag` | one of the post's tags |
| `after:2026-05` / `before:2026-06-15` | `postedAt` (falls back to `capturedAt` when X gave no date) |

Rows show `@author · posted date · text snippet · Folder chips`. `↑↓` moves, **Enter opens the
post in a new tab** (so the Bookmarks scroll position is kept), `Esc` closes. The footer is
honest: "Searches posts Lasso has filed". Results are newest-first and paged (limit 50; "more…"
row).

### 3.3 Options — Recall box and tags/notes

The Folders workshop gains a search box *above* the Folder list that runs the same query
grammar across all Folders, with facet chips (Folder, author, tag, date) and results rendered by
the shipped `SavedPostRow` card. Each card gains an inline **tags** editor and a **note** field
(both fields already exist on `SavedPost`; `set-tags`/`set-note` are already in the protocol and
already granted to Options). Tags feed `#tag` recall.

## 4. Mechanism

### 4.1 The read — `searchSavedPosts`

New `CollectionStore.searchSavedPosts(params): Promise<SavedPostPage>` in
`src/packages/folders/types.ts`, implemented in `lib/local-store.ts`, inert in
`lib/null-store.ts`, contract-tested in both.

```ts
interface SearchSavedPostsParams {
  text: string[];          // ANDed substrings over text, note, author.screenName
  authorHandle: string | null;
  tag: string | null;
  from: string | null;     // ISO date, inclusive
  to: string | null;       // ISO date, inclusive
  folderId: string | null;
  limit: number;           // ≤ MAX_PAGE_LIMIT
  cursor: string | null;   // opaque `${sortKey}:${statusId}`
}
```

The implementation picks the **narrowest index-backed candidate set** it can, then applies the
remaining predicates in memory:

1. `tag` → new `savedPosts.by-tag` (`tags`, `multiEntry: true`)
2. `authorHandle` → new `savedPosts.by-author` (`author.screenName`, case-folded at write)
3. `from`/`to` → new `savedPosts.by-posted-at` (`postedAt`, ISO strings sort lexically)
4. `folderId` → existing `folderMemberships.by-folder-added` cursor (what `readFolderPage` walks)
5. none of the above → `savedPosts.getAll()` scan, explicitly budgeted (§9)

Ordering is `postedAt` desc (then `capturedAt`), cursor-paged like `readFolderPage`.

**Schema v3 and the migration gap.** `createCollectionStores()` only ever creates indexes inside
`if (!db.objectStoreNames.contains(store))` (`schema.ts:45-77`), and `applySchema(req.result)`
never receives the `versionchange` transaction (`local-store.ts:56`). A naive bump would never
add an index to an installation that already has `savedPosts`. The v3 migration therefore
passes `req.transaction` into `applySchema`, opens the existing store from it, and guards **each
index** with `store.indexNames.contains(...)`. `schema.test.ts` gains a "v2 database with posts
gains the three indexes without losing a row" case beside the existing v1→v2 test.

`by-author` needs the handle case-folded; `toSavedPost()` writes `author.screenName` as captured,
so the index is declared on a derived `authorKey` field written lowercase — **or** the search
case-folds on read over the candidate set. Decision: derived field is cleaner but touches the
replica wire shape (six files, §6); v1 case-folds on read and keeps `SavedPost`'s key set
untouched. `by-author` then serves exact-case hits and the in-memory pass catches the rest.

### 4.2 The write — `filePosts` / `unfilePosts`

`savePost()` opens and commits **its own** transaction per call (`local-store.ts:253-276`), so N
calls are N independently-committing transactions, not a batch. Two new store methods:

- `filePosts({ folderId, captures }): Promise<{ results: { statusId; status }[]; createdStatusIds }>`
  — one `readwrite` transaction over `savedPosts` + `folderMemberships`, looping the same
  nested-request logic `savePost` uses; `unsavable` (null id) and `already-there` are per-item
  outcomes, never failures.
- `unfilePosts({ folderId, statusIds, createdStatusIds })` — one transaction: delete the
  membership rows, then `purgePost(tx, id)` (the existing private helper `deleteSavedPost` uses,
  `local-store.ts:240-246`) for each created id that **no other Folder holds now** — the
  single-save Undo's "only take back what this gesture minted" rule, generalised.

Both are protocol operations `file-posts` / `unfile-posts` (with `token`), bounded by a new
`MAX_FILE_BATCH` (60 until live measurement, §10), carrying `captures` validated by the existing
`isCapture`, and granted to `x-content`/`social-content` only. The content client mints **one**
fence token for the gesture and reuses it for file and, later, unfile — `undoSave`'s
one-token-two-legs rule (`src/content/collections-client.ts:66-91`) generalised to N.

**Capture enumeration** (content, `controller.ts` new command): `document.querySelectorAll
(Selectors.TWEET)` → keep `outermostTweet(el) === el` → drop `getTweetType(el) === "promoted"`
(the check `author()` has and `capture()` lacks) → `capture(el)` synchronously (the article may
be recycled during the round-trip, `controller.ts:502-509`) → drop null ids → dedupe by status
id → truncate to `MAX_FILE_BATCH`. Lazy video hydration is accepted as a known under-report of
`media.kind` (recall never matches on media kind); the toast does not claim media fidelity.

**Batch picker.** `FolderPickerController.open(capture)` and its `chosen` effect are typed to one
`PostCapture` (`src/core/folder-picker-controller.ts:45-58,116`). The controller grows a
`openBatch(captures)` entry and a `holding` view of `{ held: number; of: number }` per Folder
(from one `folders-holding` read per capture, coalesced); the single-post path is untouched. The
picker view renders "holds k of N" when in batch mode.

### 4.3 Protocol and capabilities

| Operation | Kind | options | popup | x-content / social-content |
|---|---|---|---|---|
| `search-saved-posts` | read | ✓ | ✗ | ✓ (new grant, for the overlay) |
| `file-posts` | write | ✓ (auto) | ✗ | ✓ (new grant) |
| `unfile-posts` | write | ✓ (auto) | ✗ | ✓ (new grant) |
| `set-tags` / `set-note` | write | ✓ (already) | ✗ | ✗ (unchanged — inline tagging is a follow-up) |

Every grant is an explicit literal added to the Set in `src/background/message-policy.ts` and
to the exhaustive-walk arrays in `tests/background/message-policy.test.ts`; omission denies.
Requests validate by exact key set; `captures[]` items reuse `isCapture`; `text[]` is bounded
(≤ 8 terms, ≤ 64 chars each); statusIds use `isPostId` (multi-platform) because Folders are.

### 4.4 Keyboard

Two new `CommandId`s in `src/content/keyboard.ts`: `file-visible-to-folder` → `Alt+Shift+f`,
`open-recall` → `Alt+Shift+r`. Both are absent from `DEFAULT_KEYMAP` and distinct from bare
`f`/`r` under `combosCollide()`'s modifier-aware grammar; bare `/` is X's own search-focus key
and is never claimed. `file-visible-to-folder` is a no-op with an info toast off the Bookmarks
scope ("Works on your Bookmarks page"). OS/AT collisions are checked live (§10).

### 4.5 Surfaces

- `src/ui/FolderPicker.tsx` — batch header/rows (same component, `batch?` view branch).
- `src/ui/RecallOverlay.tsx` (new) + `src/core/recall-controller.ts` (new; signal-based like
  the picker controller, `fuzzyRank` is *not* used — recall is predicate search, ranked by date).
- `src/options/FoldersOptions.tsx` — Recall box + facet chips; `SavedPostRow` tags/note editors.
- `src/options/folders-client.ts` + `src/content/collections-client.ts` — new methods.
- Copy in `src/core/strings.ts`, pinned in `tests/core/strings.test.ts`.

## 5. Resolved decisions (2026-08-23)

- **D1 — Recall is a read over Saved Posts, not a Filter criterion.** `CriterionId` is a closed,
  build-time catalog (`filter-criteria.ts:105-119`); a user-typed value cannot be one. The one
  valued gate precedent (`onlyMyLanguages`) lives inside `decide()`; a recall query outside
  `FilterState` would be skipped by the `activeCriteriaCount === 0` fast path. The Filter stays
  display-only and untouched.
- **D2 — Population is DOM capture on a gesture, not a GraphQL timeline read.** Same reader
  (`capture()`), same synchronous-at-gesture discipline, same idempotent store as the shipped
  single save. GraphQL's operation is unverified, its policy exposure is mechanism (a
  reverse-engineered endpoint), and #78's catalog-version bump would collide. Deferred, §12 B.
- **D3 — The bulk gesture is gated to the Bookmarks route.** Every post on `/i/bookmarks` is one
  the user already chose to keep. That is what keeps the ADR-0005 amendment narrow (§7): it
  extends "a post the user chose to keep" to "the posts the user chose to keep, as many as one
  screen shows", never "the feed at large".
- **D4 — One press, one Folder, one token, one Undo; sticky mode rejected.** A toggle that files
  whatever scrolls past has no gesture and no end — ADR-0005's self-draining queue — and would
  re-open "import my whole history". Press again for more.
- **D5 — A query is not a Folder and is not persisted.** This resolves ADR-0013's "saved
  searches / smart Folders — still open" clause narrowly: v1 ships an ephemeral query; a named,
  persisted search would be its own decision (a second ADR-0013 amendment, §7).
- **D6 — The popup is excluded.** Its grant stays counts-only.
- **D7 — Tags/notes editing is Options-only in v1.** Zero policy change (`set-tags`/`set-note`
  are Options-granted today). Inline tagging from the content-script picker needs two allow-list
  widenings and is a follow-up ticket, not a free rider.
- **D8 — Promoted units are excluded; video hydration under-report is accepted and stated.**
- **D9 — Hotkeys `Alt+Shift+F` / `Alt+Shift+R`.** Consistent with `Alt+Shift+B/L`.
- **D10 — Enter in the overlay opens a new tab.** Keeps the Bookmarks scroll position; a judge
  flagged losing it as the overlay's worst UX trap.
- **D11 — `by-author` case-folds on read, not via a derived field.** Keeps `SavedPost`'s pinned
  key set and the replica wire shape untouched in v1.

## 6. Architecture — files touched

| # | File | Change |
|---|---|---|
| 1 | `src/packages/folders/lib/schema.ts` | `FOLDERS_DB_VERSION` 2→3; `applySchema(db, tx)`; `by-tag` (multiEntry), `by-author`, `by-posted-at` on `savedPosts`, each guarded by `indexNames.contains` |
| 2 | `src/packages/folders/lib/local-store.ts` | pass `req.transaction`; `searchSavedPosts`, `filePosts`, `unfilePosts` (shared-tx loops; `purgePost` reuse) |
| 3 | `src/packages/folders/lib/null-store.ts` | empty page / empty results |
| 4 | `src/packages/folders/types.ts` | three methods + params/result types (account-free) |
| 5 | `src/packages/folders/tests/{schema,contract,scale,account-freedom,local-store}.test.ts` | EXPECTED indexes; v2→v3 migration case; method-name pins; scan budget; both impls |
| 6 | `src/core/protocol/collections.ts` | `search-saved-posts`, `file-posts`, `unfile-posts`; `MAX_FILE_BATCH`, `MAX_SEARCH_TERMS`; REQUEST_KEYS; validators; success shapes |
| 7 | `src/background/data-lifecycle/collections.ts` | three `run()` cases |
| 8 | `src/background/message-policy.ts` + test | grants per §4.3 |
| 9 | `src/core/recall-query.ts` (new) | `parseRecallQuery(raw) → SearchSavedPostsParams` (pure; malformed tokens dropped) |
| 10 | `src/core/recall-controller.ts` (new) | status/query/results signals; `act()` intents; page cursor |
| 11 | `src/core/folder-picker-controller.ts` | `openBatch(captures)`; batch `holding` view; `chosen-batch` effect |
| 12 | `src/content/collections-client.ts` | `filePosts`, `undoFilePosts` (one fence), `searchSavedPosts` |
| 13 | `src/content/controller.ts` | `file-visible-to-folder` (enumerate → picker → file → toast/Undo); `open-recall` |
| 14 | `src/content/keyboard.ts` | two `CommandId`s, two bindings |
| 15 | `src/ui/FolderPicker.tsx` | batch header/row variant |
| 16 | `src/ui/RecallOverlay.tsx` (new) | combobox/listbox overlay; `useFocusTrap`; `UI_LAYER.modal` |
| 17 | `src/content/app.tsx` / `surface-mount` | mount the overlay beside the picker |
| 18 | `src/options/folders-client.ts`, `FoldersOptions.tsx` | Recall box, facet chips, tag/note editors |
| 19 | `src/core/strings.ts` + `tests/core/strings.test.ts` | all new copy, pinned |
| 20 | `docs/adr/0005-policy-invariants.md`, `docs/adr/0013-…md`, `docs/CONTEXT.md`, `docs/product-documentation.md` | amendments (§7), glossary (Recall, Batch file), shortcuts table |
| 21 | `docs/research/verify-bookmark-recall-dom.md` (new) | §10 record |
| 22 | `scripts/design-cards/generate.test.tsx` | four proposed cards (done on this branch) |

Boundary gate: `folders` stays headless (no `src/content` import); the overlay reaches the store
only through `lasso:collections`; `core` never imports `content`.

## 7. Policy — the two amendments this needs

Neither is landed by this spec. Both are the user's decision; the draft text is here so the
decision is about words already written.

### ADR-0005 amendment draft — "Filing what the Bookmarks page shows"

> ## Amendment 2026-08-23 — filing a screen of the user's own Bookmarks
>
> The 2026-07-29 amendment licensed durable capture "of a post the user chose to keep, never of
> the feed at large", one post per gesture. Bookmark Recall files the posts the user's own
> Bookmarks page currently shows, on one explicit keypress, into one Folder. This extends the
> singular to a bounded plural without reaching the feed at large: every post on `/i/bookmarks`
> is one the user already chose to keep, the gesture is gated to that route, the batch is what X
> has rendered at the keypress (never scrolled for, never fetched, bounded by `MAX_FILE_BATCH`),
> and each press is its own run that ends with its own toast and Undo. Nothing files on scroll,
> on load, on a timer, or across presses. Capture limits are unchanged: status id, permalink,
> author, text, media URL references, posted-at; no media bytes; promoted units excluded.
>
> Unchanged: no X request of any kind is made by this feature; no third-party data; no reading
> of X's Premium bookmark folders; no reading of bookmark history Lasso cannot see on screen.

### ADR-0013 amendment draft — "Recall"

> ## Recall amendment — 2026-08-23
>
> **Saved Posts are searchable; a query is not a Folder.** The Flat-Folders amendment left
> "saved searches or smart Folders" open. This amendment decides the narrow half: Lasso may
> index Saved Posts by tag, author and posted-at and answer an ephemeral query over them from
> the page and from Options. A query is never persisted, never named, never a Folder, never
> bound to a scope, and never carries an account. The popup's grant stays counts-only. A
> persisted or named search remains its own future decision.

## 8. Known interactions (not blockers)

- **Undo is a single global slot.** A second `Alt+Shift+F` press evicts the first press's Undo —
  the same as every other quick action. The toast's "filed this visit" tally is the mitigation,
  not a second registry.
- **Replica.** `file-posts` schedules one replica sync per press (the existing every-write
  microtask), carrying up to `MAX_FILE_BATCH` Saved Posts + memberships — under `PUSH_BATCH_SIZE`
  (256). No new entity kind; the three indexes are local derived structure, never replicated.
- **Coverage baseline is red at HEAD** (96.33% statements; folders package ~46% after the replica
  commits) and `format:check` fails on generated `env.d.ts`. These are landing prerequisites
  independent of this feature; the tickets must not assume a green baseline.
- **Cross-surface freshness.** Options re-reads on mount/retry/own-write only (no collections
  fanout exists). Filing from the page while Options is open needs a manual refresh; accepted.
- **Multi-platform.** `isPostId` accepts `threads:`/`instagram:` ids, so Threads/Instagram saves
  are searchable too; the bulk gesture is X-Bookmarks-only by route gate.

## 9. Test plan — hold 100% coverage

- `recall-query.test.ts`: grammar table (bare, `@`, `#`, `after:`/`before:`, malformed dropped,
  term caps).
- folders `contract.test.ts` (both impls): empty search, search-by-tag/author/date/folder/text,
  paging; `filePosts` outcomes per item; `unfilePosts` leaves other Folders' rows and non-created
  posts alone.
- `local-store.test.ts`: atomicity — a thrown mid-batch write leaves zero rows (one tx).
- `schema.test.ts`: EXPECTED indexes; **v2 database with 3 posts upgrades to v3 with all indexes
  and all rows** (the migration-gap case).
- `scale.test.ts`: 3000 posts — tag/author/date searches under the default timeout; the
  no-facet full scan under its own labelled budget.
- `protocol-collections.test.ts` VALID table + exact-key rejection for the three ops;
  `message-policy.test.ts` exhaustive walks updated.
- `folder-picker-controller.test.ts`: `openBatch` holding counts; single path unchanged.
- `controller.test.ts`: enumeration excludes nested/promoted/null-id; one token for file+undo;
  toast counts; off-scope no-op.
- `RecallOverlay` / Options tests (happy-dom): keyboard nav, Enter opens new tab, empty/error.
- `strings.test.ts` pins; `e2e/a11y.spec.ts` axe sweep green; `theme-contrast.test.ts` untouched.

## 10. Live verification gate (AMBER → confirmed)

Needs a signed-in x.com session with a long Bookmarks history; cannot be produced or ticked by an
implementing agent (MISSION.md). Record in `docs/research/verify-bookmark-recall-dom.md`:

1. **Mounted-cell count on `/i/bookmarks`** at 1080p and 1440p after scroll-settle (sets
   `MAX_FILE_BATCH` honestly; today it is a guess).
2. One `Alt+Shift+F` press files N posts; reload Options → the Folder holds N; `Undo` → holds 0;
   a second press after scrolling files the next screen with no duplicates.
3. Promoted unit present on screen → not filed. Quote tweet on screen → host filed once.
4. `Alt+Shift+R` from Home finds a post filed in step 2 by word, `@handle`, `#tag`, `after:`.
5. Hotkeys do not collide with macOS/Windows Chrome or VoiceOver/NVDA defaults.
6. A v2 profile (pre-existing database) upgrades in place: posts survive, indexes present
   (DevTools → Application → IndexedDB).
7. Re-check that the inline action bar still shows no bookmark control (the 2026-06-27 finding is
   two months old); irrelevant to this design's mechanism but keeps §2's non-goal honest.

## 11. Rollout — tickets and order

```
R1 search read (schema v3 + searchSavedPosts + protocol)   ──┐
R4 tags/notes editors in Options (no policy change)         ──┼─► R2 recall surfaces (overlay + Options box)
R3 file-visible gesture (needs ADR-0005 amendment)          ──┘      (R2 is useful with R1 alone)
R5 docs + live verification record (closes the gate; flips MAX_FILE_BATCH from guess to measured)
```

- **R1** and **R4** start immediately; **R3** starts immediately but lands only with the ADR-0005
  amendment; **R2** is blocked by R1 and by design review of the cards; **R5** trails R2/R3.
- Day-one value: R3 + R1 + R2 together make the existing pile findable. R1 + R2 alone make
  everything filed so far findable.
- Ticket bodies in house style are in `2026-08-23-bookmark-recall-tickets.md` beside this spec,
  ready for `gh issue create --body-file` once reviewed.

## 12. Designs considered (judge scores: policy / architecture / user value)

| | Angle | Scores | Verdict |
|---|---|---|---|
| A | On-page-first: free-text narrowing of the live `/i/bookmarks` DOM, no storage | 8.5 / 6.5 / 4.5 | Cleanest policy; **not recall** (mount-bounded); fast-path no-op trap; per-scope cost. Kept as principle D1. |
| B | Index-first: opt-in GraphQL `Bookmarks` read → Saved Posts | 7 / 6 / 5.5 | Honest amendment draft; **operation unverified**; Options trigger cannot reach a content script; #78 catalog-bump collision; DMCA-adjacent mechanism. Deferred. |
| C | Folders-first: bulk DOM capture on gesture + indexed search | 7 / 7.5 / 6 | **Backbone.** Fixed: batch atomicity (shared tx, not N `savePost`), picker signature, migration gap. |
| D | MVP-first: turn on dead note/tags/foldersHolding machinery; staged roadmap | 8 / 7 / 4.3 | Sequencing borrowed; Stage 1 alone is save-hygiene, not recall; "no policy change" claim false for inline tagging. Grafted as R4 (Options-only). |

Critic's additions adopted: the `schema.ts` index-migration gap (§4.1), the Options→content
trigger impossibility (B), and "a rule-defined view is product-undecided, not pre-cleared" (D5).

Deferred follow-ups, each its own ticket when wanted: inline tagging from the page (two
allow-list entries); a Saved badge on the tweet overlay (needs a batched `folders-holding` read —
it would fire per mounted article on every scope); persisted named searches (ADR-0013);
Bookmarks as a bindable Filter scope; a GraphQL bookmark index (B) after live verification.
