# ADR-0013 — Folders: Lasso-owned, account-agnostic, local-first, Destinations optional

Status: Accepted · 2026-07-29

## Context
X's Bookmarks are one undifferentiated pile; sorting them into folders is a Premium feature. Lasso gains **Folders** — user-named collections of saved posts — for free.

Every neighbouring store in this repo is Owner-scoped, because X Lists are: the List cache shards one storage key per Owner, list usage keys on `<ownerUserId>:<listId>`, `MembershipHit` keys on `(listId, ownerUserId)`, and `defaultList` carries a live migration converting an account-agnostic default *into* an Owner-qualified one. Folders invert that, so the inversion has to be written down rather than inferred — otherwise the next store to land will copy the reflex.

Users also don't want a fourth silo: what they save should be able to reach the notes system they already use.

## Decision
- **Lasso-owned, not X-owned.** A Folder is Lasso's own collection. Lasso never reads or writes X's Premium bookmark-folder structure, and a Lasso Folder may hold a post whether or not X bookmarked it.
- **Account-agnostic.** No Folder or Saved Post key, storage key, index, protocol message or settings value carries an X account under any name. The same Folders are present whichever account is signed in; switching accounts is not a data event. The default-Folder setting is a bare folder id — never an `{ownerUserId, folderId}` tuple — so no account comparison exists on the no-picker path. The one legitimate appearance of an account is **bookmark evidence**, where it is an attribute of an observation and never part of a key's identity.
- **Saved once, by status id.** One post is one Saved Post, deduped by X status id however many Folders hold it and however many of the user's accounts bookmarked it. Folder membership is many-to-many, keyed `(folderId, statusId)`: filing into a second Folder adds a row, never a second post, so a user's note and tags stay in one place. This diverges deliberately from X, whose bookmark folders are single-membership.
- **Local-first, and the local store is authoritative.** Folders live in a worker-owned local database, so the feature works with nothing configured, offline, and with no data leaving the browser. Local is the source of truth; nothing else may overwrite it.
- **Destinations are optional, one-way and never load-bearing.** A user may attach their Convex deployment, a Notion database or an Airtable table. Each is off until configured, receives a push as posts are filed, and never gates or alters a save: a failing Destination costs the user nothing but the sync. Lasso holds no network permission for a Destination until one is configured.
- **The database is worker-owned, and IndexedDB rather than `chrome.storage`.** Folders, Saved Posts, membership rows, bookmark evidence and Destination sync state live in one IndexedDB database the background worker alone opens. `chrome.storage.sync` has a quota a pill-drag has already burned once and would not hold thousands of posts; `chrome.storage.local` is deliberately closed to content. The store is constructed once behind an injected factory, so no other context names the implementation — and `CollectionStore` is the seam a SQLite adapter would later slot into without touching a caller.
- **One contract, several implementations.** `CollectionStore` is the seam — the local database now, a Destination adapter later — with a factory as the only place naming a concrete one, exactly as `createMembershipStore` chooses Convex or the null object. A host with no database gets an inert null object rather than an error.

## Consequences
- Free folder-based retrieval without Premium, and without the account fragmentation the List-assignment side lives with.
- The saved-once invariant is structural: it is the database's key layout, not a rule callers must remember.
- Users own their data — it is local by default and exportable — and adding a Destination is additive rather than a migration.
- Destinations must be written to tolerate being behind, offline or wrong without ever corrupting the local record.

## Relationship to ADR-0005
ADR-0005 invariant 3 ("user's own session, own data") is amended in that ADR to cover durable capture of posts the user explicitly filed, and user-configured export of their own data to their own Destination. This ADR does not weaken any other ADR-0005 invariant: filing is an explicit user gesture, nothing is autonomous, and no third-party data is read.

## Flat-Folders amendment — 2026-08-01

**A Folder holds Saved Posts and never another Folder. The set of Folders is one flat, user-ordered list — there is no parent, no child, no path and no depth, anywhere in the system.** This is a decision, not an omission, and it is written down because the original decision above is silent on it: a reader who finds `sortIndex` and no parent field cannot tell whether flatness was chosen or merely not yet reached, and would add nesting believing they were completing the design rather than reversing it.

The reasoning is the same one that produced "saved once, by status id". Nesting buys retrieval power that **tags already buy** — #41 gives every Saved Post tags that cut across Folders, and a tag is strictly more expressive than a tree because a post can carry several while it can sit under only one parent. Nesting would also cost the invariants this ADR spends its whole length establishing: a tree makes "how many posts are in this Folder" ambiguous (own rows, or the subtree's?), makes the delete dispositions recursive and therefore genuinely dangerous, gives the picker's flat fuzzy-ranked list a second axis it has no way to render, and gives every Destination adapter an ordering constraint — a parent row must land before its children — that the queue's whole-row, coalescing, idempotent-by-post-identity design does not have and should not grow. The Folder Picker's value is that one keystroke and a few characters reach any Folder; a hierarchy is precisely the thing that makes a name insufficient to locate a Folder.

**The enforcement seam is the one that already exists, and it is a single seam.** `KeysAre<Folder, …>` in the folders package's account-freedom suite pins the `Folder` key set to an exact literal list as a *compile-time* assertion, so a `parentFolderId`, `parentId`, `path`, `depth` or `children` field on `Folder` — under any name — already fails `bun run typecheck` rather than a test. Because the domain type cannot express a parent, no surface downstream of it can render a tree, and no Destination table can carry one; that is why one seam suffices and no per-surface guard is added. What this amendment changes is only that the pin now has a recorded reason: widening that literal list is a reversal of this ADR and requires a superseding one, not a test edit.

Out of scope, and deliberately still open: tags as the cross-cutting axis (specified in #41), and saved *searches* or *smart Folders* — a rule-defined view over Saved Posts is not a Folder and would be its own decision, unaffected by this amendment.
