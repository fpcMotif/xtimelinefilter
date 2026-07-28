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
- **One contract, several implementations.** `CollectionStore` is the seam — the local database now, a Destination adapter later — with a factory as the only place naming a concrete one, exactly as `createMembershipStore` chooses Convex or the null object. A host with no database gets an inert null object rather than an error.

## Consequences
- Free folder-based retrieval without Premium, and without the account fragmentation the List-assignment side lives with.
- The saved-once invariant is structural: it is the database's key layout, not a rule callers must remember.
- Users own their data — it is local by default and exportable — and adding a Destination is additive rather than a migration.
- Destinations must be written to tolerate being behind, offline or wrong without ever corrupting the local record.

## Relationship to ADR-0005
ADR-0005 invariant 3 ("user's own session, own data") is amended in that ADR to cover durable capture of posts the user explicitly filed, and user-configured export of their own data to their own Destination. This ADR does not weaken any other ADR-0005 invariant: filing is an explicit user gesture, nothing is autonomous, and no third-party data is read.
