# Bookmark Recall — ticket drafts

Drafts in the repo's child-ticket house style (Parent / What to build / Acceptance criteria /
Blocked by), ready for `gh issue create --title … --body-file …` once the design in
[2026-08-23-bookmark-recall-design.md](2026-08-23-bookmark-recall-design.md) is reviewed. Not
published. The parent's body is the spec itself (the #41 precedent). Replace `#PARENT` and the
`#R*` cross-references with real numbers after creation; sub-issue and `blocked_by` edges use the
`gh api … -F sub_issue_id=<database id>` mechanics recorded in memory for #41.

---

## Parent — Bookmark Recall: file the Bookmarks pile into Folders and find any saved post again

Body: the spec, verbatim. Label `ready-for-agent`. Sub-issues: R1–R5 below.

---

## R1 — The recall read: index Saved Posts and search them

### Parent

#PARENT — Bookmark Recall (spec §4.1, §5 D1/D5/D11).

### What to build

`CollectionStore` gains `searchSavedPosts(params)`, a bounded, cursor-paged read over Saved Posts
by text terms, author handle, tag, posted-at range and Folder, answered from the narrowest
index the query allows and finished in memory. Three secondary indexes land on the existing
`savedPosts` store behind `FOLDERS_DB_VERSION` 2→3: `by-tag` (`tags`, multiEntry), `by-author`
(`author.screenName`), `by-posted-at` (`postedAt`). The migration must add indexes to a store
that already exists — `createCollectionStores()` today only creates indexes inside the
store-creation branch and `applySchema` never sees the `versionchange` transaction — so
`applySchema` takes the upgrade transaction and guards each index with `indexNames.contains`.
The read is exposed as the `search-saved-posts` collections operation (no token), granted to
Options now and to x-content/social-content in the same change (the overlay in R2 needs it;
granting here keeps the allow-list walk in one PR). `src/core/recall-query.ts` parses the
user grammar (bare words, `@handle`, `#tag`, `after:`/`before:`) into params and never throws.
A query is ephemeral: nothing here persists, names, or binds a search. Ordering is `postedAt`
desc, then `capturedAt`. The no-facet full-scan path is allowed but budgeted, per
`scale.test.ts`'s discipline. No field is added to `SavedPost`; `by-author` hits are case-folded
on read (D11). Out of scope: any UI; `file-posts`; persisted searches; a popup grant.

### Acceptance criteria

- [ ] `CollectionStore` declares `searchSavedPosts(params: SearchSavedPostsParams): Promise<SavedPostPage>`; both `LocalCollectionStore` and `NullCollectionStore` implement it; the null store returns `{ posts: [], nextCursor: null }`; `account-freedom.test.ts`'s `KeysAre` pins and the exact-method-list assertion name the new method and no params key names an account.
- [ ] `schema.ts` declares `FOLDERS_DB_VERSION = 3` and the three indexes; `schema.test.ts`'s EXPECTED map lists them; `namesAnAccount` still passes; a new test opens a v2 database holding three Saved Posts, upgrades it, and asserts all rows survive and all three indexes exist.
- [ ] `applySchema` receives the upgrade transaction; `local-store.ts` passes `req.transaction`; an existing store gains indexes without being recreated.
- [ ] `searchSavedPosts` uses `by-tag` when `tag` is set, `by-author` when `authorHandle` is set, `by-posted-at` when `from`/`to` is set, `by-folder-added` when `folderId` is set, and `getAll()` only when none is — pinned by `scale.test.ts`: 3000 posts, each indexed path under the default timeout, the scan path under its own labelled `it(…, TIMEOUT)` budget.
- [ ] Contract tests (both implementations) cover: empty store; each facet alone; ANDed text terms over text, note and handle; paging with a cursor past the end; `limit > MAX_PAGE_LIMIT` rejected at the protocol.
- [ ] `src/core/protocol/collections.ts` adds `search-saved-posts` with an exact key set, `MAX_SEARCH_TERMS = 8`, term length ≤ 64, `isPostId`-free (no ids in the request); `tests/core/protocol-collections.test.ts`'s VALID table gains the entry; `message-policy.ts` grants it to options, x-content and social-content and the exhaustive-walk arrays say so.
- [ ] `src/core/recall-query.ts` parses the grammar into params, drops malformed tokens, caps terms, and is 100% covered by a table test.
- [ ] `bun run typecheck`, `lint`, `lint:boundaries`, `test:coverage` (100%) pass for the touched files; `folders` still imports nothing from `src/content`.

### Blocked by

- None — can start immediately.

---

## R2 — Recall surfaces: the in-page overlay and the Options Recall box

### Parent

#PARENT — Bookmark Recall (spec §3.2, §3.3, §4.5, §5 D6/D9/D10).

### What to build

Two surfaces over R1's read. **In-page:** `Alt+Shift+R` (`CommandId` `open-recall`) opens a
combobox-over-listbox overlay titled "Find a saved post", modelled on `FolderPicker.tsx`
(`useFocusTrap`, `UI_LAYER.modal`) and driven by a new signal-based `recall-controller.ts`
(status, query, results, active row, `act()` intents). Rows show author, posted date, a text
snippet and Folder chips; `↑↓` moves; **Enter opens the permalink in a new tab**; `Esc` closes;
the footer reads "Searches posts Lasso has filed". Results page by 50 with a "more…" row. The
overlay mounts on every in-scope x.com timeline and reads through `lasso:collections` only.
**Options:** the Folders workshop gains a search box above the Folder list with the same grammar
plus facet chips (Folder, author, tag, date), rendering hits with the shipped `SavedPostRow`. All
copy lives in `src/core/strings.ts`. The four proposed design cards on this branch
(`scripts/design-cards/out/recall-*.html`, `page-options-folders-recall.html`) are the reviewed
design; implementation reproduces them. Out of scope: the popup; persisted searches; bookmark
evidence display.

### Acceptance criteria

- [ ] `open-recall` is bound to `Alt+Shift+r` in `DEFAULT_KEYMAP`, passes `combosCollide()` against every existing binding, and opens the overlay on Home, a List, a profile and `/i/bookmarks`.
- [ ] The overlay is `role="dialog" aria-modal="true"`, focus-trapped, with a `role="combobox"` input and `role="listbox"` rows with `aria-activedescendant`; `ArrowUp/Down` move, `Enter` opens `post.permalink` via `window.open(_, "_blank", "noopener")`, `Escape` and outside-click close; the Bookmarks page's scroll position is unchanged after Enter.
- [ ] Typing debounces (≤ 200 ms) into `search-saved-posts`; loading, empty ("No saved posts match"), error (+Retry) and ready states render; "more…" appends the next page.
- [ ] The Options Recall box runs the same `parseRecallQuery`, facet chips add `folderId`/`authorHandle`/`tag`/`from`/`to`, hits render through `SavedPostRow`, and clearing the box restores the Folder list.
- [ ] Every new string is exported from `strings.ts` and pinned verbatim in `tests/core/strings.test.ts`.
- [ ] `e2e/a11y.spec.ts`'s axe sweep stays at zero violations in light and dark; `tests/ui/theme-contrast.test.ts` is unchanged and green.
- [ ] Unit tests (happy-dom) cover the controller's intents and the overlay's keyboard contract; coverage stays 100%.
- [ ] Manual: the implemented overlay and Options box match the reviewed design cards (needs human eyes; not tickable by the implementing agent).

### Blocked by

- #R1 — The recall read.
- Design review of the proposed cards in the Lariat design project.

---

## R3 — File what's loaded: the bulk Bookmarks gesture (needs ADR-0005 amendment)

### Parent

#PARENT — Bookmark Recall (spec §3.1, §4.2, §5 D2/D3/D4/D8, §7).

### What to build

On `/i/bookmarks` only, `Alt+Shift+F` (`CommandId` `file-visible-to-folder`) files every post X
currently has rendered into one Folder in one worker operation with one toast and one Undo.
Enumeration is synchronous at the keypress: `querySelectorAll(Selectors.TWEET)` → keep
`outermostTweet(el) === el` → drop `getTweetType(el) === "promoted"` → `capture()` → drop null
ids → dedupe by status id → truncate to `MAX_FILE_BATCH` (60 until §10 measures it). The
Folder Picker opens in **batch mode**: `FolderPickerController.openBatch(captures)`, a
`{ held, of }` holding view per Folder, a `chosen-batch` effect; the single-post path is
untouched. Two new store methods run as **one transaction each**: `filePosts` (loops
`savePost`'s nested-request logic under a shared `tx`; per-item `saved` / `already-there` /
`unsavable`) and `unfilePosts` (deletes the batch's membership rows, then `purgePost(tx, id)`
for each id this gesture created that no other Folder holds now). Both are protocol writes
(`file-posts`, `unfile-posts`) granted to x-content/social-content, and the content client
mints **one** fence token for the gesture and reuses it for file and undo. The toast reads
"Filed N posts into F · k already there · t filed this visit" with an Undo action; the visit
tally is in-memory only. Off the Bookmarks scope the command shows an info toast and does
nothing. Ships only with the dated ADR-0005 amendment in spec §7 (it is a decision, not a
formality) and the `docs/CONTEXT.md` glossary entry for "Batch file". Out of scope: any sticky
or scroll-driven mode; inline tagging; evidence rows.

### Acceptance criteria

- [ ] `docs/adr/0005-policy-invariants.md` carries the dated "filing a screen of the user's own Bookmarks" amendment (spec §7) and `docs/CONTEXT.md` defines **Batch file**; the amendment's "unchanged" clause is present verbatim.
- [ ] `file-visible-to-folder` is bound to `Alt+Shift+f`, passes `combosCollide()`, and is a no-op with the pinned info toast when `resolveScope(location.pathname).kind !== "bookmarks"` — tested on Home, a List and a profile.
- [ ] A controller test with a fixture page holding a plain post, a quote tweet (host + nested article), a promoted unit and an article with no permalink files exactly two posts: the plain post and the quote host; the nested article and the promoted unit are never captured; the no-id article is counted in the toast, not filed.
- [ ] `CollectionStore.filePosts` and `unfilePosts` exist on both implementations, are pinned in `account-freedom.test.ts`, and a `local-store.test.ts` case proves atomicity: a batch whose last item throws leaves zero new rows.
- [ ] `unfilePosts` removes only the batch's membership rows and deletes only Saved Posts in `createdStatusIds` that no other Folder holds; a post also held by another Folder survives with its note and tags.
- [ ] `collections.ts` adds `file-posts`/`unfile-posts` with exact key sets, `captures` bounded by `MAX_FILE_BATCH` and validated by `isCapture`; the VALID table and `message-policy.test.ts`'s x-content/social-content walks include both; the popup walk excludes both.
- [ ] One `begin` token is minted per gesture and reused for `file-posts` and the later `unfile-posts` — pinned by a client test that counts `begin` requests.
- [ ] `FolderPickerController.openBatch` renders "holds k of N" per Folder and the single-capture `open` path's tests are unchanged.
- [ ] Toast copy and the info toast are pinned in `strings.test.ts`; Undo arms only when the batch created or filed at least one row.
- [ ] Coverage 100%, `lint`, `format:check`, `lint:boundaries` green.
- [ ] Manual live verification (needs a signed-in x.com session; not tickable by the implementing agent): `docs/research/verify-bookmark-recall-dom.md` records spec §10 cases 1–3 and 5, and `MAX_FILE_BATCH` is set from the measured mounted-cell count in the same change.

### Blocked by

- The ADR-0005 amendment decision (spec §7) — product/policy, not engineering.
- Design review of the batch-picker and toast cards.

---

## R4 — Tags and notes: finally editable, in Options

### Parent

#PARENT — Bookmark Recall (spec §3.3, §5 D7).

### What to build

`SavedPost.note` and `SavedPost.tags` have existed since #68, and `set-note`/`set-tags` have been
validated, worker-implemented and Options-granted since #69 — with zero UI call sites. Each
`SavedPostRow` in the Folder contents view and in R2's results gains an inline tags editor
(chips, add/remove, bounded by `MAX_TAGS`/`MAX_TAG`) and a note field (bounded by `MAX_NOTE`),
saved through new `FoldersClient.setTags`/`setNote` methods. No protocol, schema or policy change.
Inline tagging from the content-script picker or toast is **not** in this ticket: it needs
`set-tags`/`set-note` added to two content allow-lists and is its own follow-up. Tags are plain
strings; `#tag` recall (R1) matches them exactly after trim and case-fold.

### Acceptance criteria

- [ ] `folders-client.ts` exposes `setTags(statusId, tags)` and `setNote(statusId, note)` calling the existing operations with a fresh fence token each; the inert client no-ops.
- [ ] `SavedPostRow` renders existing tags as chips with an accessible remove control, an "Add tag" input that trims, case-folds, dedupes and refuses the 33rd tag or a 49-char tag with the pinned message, and a note textarea with a character budget that refuses the 2001st character.
- [ ] Edits persist (re-read after write shows them) and a failed write shows an honest inline error with Retry while the previous value stays visible.
- [ ] No change to `message-policy.ts`, `collections.ts`, `schema.ts` or any `KeysAre` pin — asserted by the unchanged exhaustive walks.
- [ ] New copy pinned in `strings.test.ts`; axe sweep and contrast test green; coverage 100%.

### Blocked by

- None — can start immediately. (R2 renders these editors in its results too; whichever lands second adopts the other's component.)

---

## R5 — Docs and the live verification record

### Parent

#PARENT — Bookmark Recall (spec §10, §11).

### What to build

Close the loop the way #26/#78 do. `docs/adr/0013-…md` gains the "Recall" amendment (spec §7);
`docs/CONTEXT.md` defines **Recall** and **Recall query**; `docs/product-documentation.md` lists
`Alt+Shift+F` and `Alt+Shift+R` in the shortcuts table with one-line honest descriptions
("files what's loaded", "searches posts Lasso has filed"); `verify-bookmark-recall-dom.md` holds
the §10 record including the v2→v3 in-place upgrade check and the hotkey collision check. The
stale state of #25/#26 (landed in `f1c7028`, still open) is resolved in passing.

### Acceptance criteria

- [ ] ADR-0013 Recall amendment present, dated, with the popup-grant sentence.
- [ ] CONTEXT.md entries for Recall, Recall query and Batch file; product-documentation shortcuts table updated; a `strings.test.ts`-style pin is not needed for docs.
- [ ] `verify-bookmark-recall-dom.md` follows the `verify-*.md` skeleton (Status, AMBER table, How to verify, Verdicts, Known traps, Promotion) and records §10 cases 1–7 with dates and the account used (human-produced; not tickable by the implementing agent).
- [ ] #25 and #26 are closed with a comment pointing at `f1c7028`.

### Blocked by

- #R2 — Recall surfaces.
- #R3 — File what's loaded.
