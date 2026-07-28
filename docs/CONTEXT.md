# CONTEXT — Lasso glossary

These terms define the product. Architecture lives in
[ARCHITECTURE.md](ARCHITECTURE.md). Decisions live in [adr/](adr/).

## List assignment

- **Tweet** — a post in the X timeline; in the DOM, `article[data-testid="tweet"]`. List assignment uses it only to identify its Author. Filtering treats the Tweet itself as the subject.
- **Author / Account** — the person who posted a Tweet. The List member, never the operator. `screenName` is the handle without `@`; `userId` is X's numeric `rest_id` when resolved.
- **Owner** — one of the user's X accounts. Read from `twid` when an action runs. It owns the target List and is distinct from the Author. Live Owner-switch proof is pending.
- **List** — an X collection of Accounts, owned by one Owner and identified by `listId`.
- **Selection** — Authors currently picked. `SelectionStore` deduplicates case-insensitive handles.
- **Select mode** — the mode that enables bulk selection.
- **Assign** — add selected Authors to a target List.
- **Mutation outcome** — add: `added` or idempotent `already-member`; remove: `removed` or idempotent `already-absent`. Both may also be `protected`, `rate-limited`, or `failed`.
- **Mutation strategy** — one `XListApi` implementation. REST is the default; DOM and GraphQL are alternatives. The shared seam mutates membership only.
- **List discovery** — loading the active Owner's Lists. It is separate from mutation strategy.
- **Page driver** — the DOM adapter's narrow interface to X menus and dialogs. Tests replace it with a fake.
- **Selectors table** — the central X DOM-hook map in `content/selectors.ts`.
- **GraphQL catalog** — one atomic descriptor for each operation: query ID, features, and field toggles. Compatible bundle metadata may replace the static fallback.
- **Credentials** — `{csrf, bearer}`. `csrf` comes from the readable `ct0` cookie; the web bearer is public. Lasso never reads HttpOnly `auth_token`. Chrome documents content requests as made for the page origin; live authenticated mutation proof is still pending.

## Mirror

- **Mirror** — an optional personal Convex record of X answers and Lasso actions. X remains the source of truth.
- **Membership store** — the Mirror seam. Convex and null adapters share it; absent Mirror settings select the null adapter.
- **Membership snapshot** — the Mirror's lazy record of whether an Account belongs to a List. Numeric user ID wins; one Tweet ID is the conservative fallback. Handles are display data, not keys.
- **Audit event** — one append-only add/remove attempt with Owner, List, Account, outcome, evidence, and time.
- **Evidence** — `server-response` lets a direct outcome update Mirror facts. DOM `ui-state` is audit-only: a checked row or closed dialog is not server truth.
- **Reconcile** — refresh the Mirror from X's current answer.
- **Cross-account catalog** — Lists known for several Owners. Only the active Owner's Lists are writable; others show cached membership as of last use.
- **Device key** — the secret that authorizes writes to the user's Mirror.

## Filter

- **Filter** — a local, display-only timeline narrowing feature. It never calls or acts on X and never carries List-assignment correctness.
- **Filter scope** — the set of timelines the Filter may run on: Home, List, Bookmark, and profile. `content/route.ts` rechecks scope after SPA navigation.
- **Resolved scope** — which of those timelines the user is on right now, identified: Home, one List, Bookmarks, or one profile. `content/route.ts` reads it from the path; what it means is domain, so the type lives in `core/`.
- **Bindable** — a Resolved scope that may carry its own Filter preference. Home, List, and profile are bindable; Bookmarks runs the Filter but is deliberately not bindable yet.
- **Preset** — a named snapshot of the active filter *selection*: tri-state criteria plus the language gate. Never link rules — applying a Preset leaves the user's host→destination mappings alone.
- **Binding** — the link from one bindable scope to one Preset. Arriving at that scope applies the Preset; it is a pointer, never a second copy of the criteria.
- **Binding key** — the stable string a Binding is stored under: `home`, `list:<listId>`, or `profile:<handle>` with the handle case-folded, so `@Jack` and `@jack` are one scope. A non-bindable scope has no key.
- **Facet** — a pure Tweet property: text, photo, video, quote, link destination, role, language, or liked state.
- **Family** — a related group of filter criteria.
- **Criterion** — one selectable Facet rule.
- **Filter mode** — `off`, `only`, or `hide`.
- **Filter projection** — the derived badge count and palette catalog in `core/filter-projection.ts`. Surfaces consume one policy.
- **Filter command** — a temporary, reversible in-page action. The controller conducts it behind a fail-open wall and may arm shared Undo.
- **Filter preference** — durable configuration: criteria, link rules, languages, presets, scope bindings, surfaces, compact mode, and the master toggle.
- **Hidden cell** — a filtered timeline cell collapsed to a reversible stub, never removed. Its overlay and pointer/keyboard targets are inert until shown.
- **Compact mode** — the opt-in mode that also hides the stub. It remains experimental pending live X verification.

## Folders

- **Folder** — a user-named collection of saved posts that Lasso owns. It has no Owner: the same Folders are present whichever X account is signed in, and they are readable and writable with no X session at all. Explicitly *not* an X Premium bookmark folder — Lasso never reads or writes X's own folder structure, and a Folder may hold a post whether or not X bookmarked it. Membership is many-to-many.
- **Saved Post** — one post the user kept, keyed by X status id and by nothing else. Filing it again, filing it into a second Folder, and bookmarking it from a second account all resolve to that one row, so a note written on it stays in one place. Carries the durable capture plus when Lasso first filed it, the user's note and tags, and zero or more bookmark-evidence rows — the one place an X account legitimately appears, as an attribute of an observation rather than part of a key.
- **Destination** — an optional, user-configured place Saved Posts are pushed to: their Convex deployment, a Notion database, an Airtable table. Off until configured, one-way, and never load-bearing — a failing Destination never blocks or alters a save.
- **Collection Store** — the Folders storage seam. One contract, several implementations — the local-first database, a null object, and one per Destination — chosen by a factory that is the only place naming a concrete one. No operation on it takes an account.

## Post capture

- **Durable capture** — what a Tweet *is* and what it *said*, read from its article in a form safe to write down and return to weeks later: status id, canonical permalink, author, text, media references, and posted-at. Keyed by the status id alone — it carries no X account, Owner or session, so the same post captures identically whichever account is signed in. Its author data is denormalized display data, never identity. A null status id means the post cannot be saved; the capture says so rather than inventing an id. Distinct from the per-cell recycle key the scanner uses.

## Browser data

- **Worker authority** — the service worker serializes durable semantic commands. Settings are local; Filter preferences are sync.
- **Sender capability** — the extension surface allowed to submit a command. Unknown senders are rejected.
- **Storage fanout** — ordered change delivery per storage area/key to extension pages and top-level content.
- **Observation token** — an epoch and sequence attached to an async cache read. A newer token wins.
- **Clear epoch** — Privacy clear rotates the observation epoch. Work started before clear cannot restore old cache data.
- **Direct adapter** — an injected or non-extension storage path. Production Settings and Filter use worker commands; direct adapters preserve testability without becoming browser authority.

## Interaction

- **Focused Tweet** — the Tweet selected by X's native `j`/`k` cursor. Lasso reads it but never moves it.
- **Combo** — a normalized keyboard binding.
- **Command** — an action invoked by a Combo or UI gesture.
- **Caret action** — a quick action driven through X's `...` menu, with bounded retry and cleanup.
- **Acceptance signal** — an observable X response proving X accepted an action. Dispatching an event is not proof.
- **Verified action** — act, wait for its acceptance signal, then fail honestly if it never arrives.
- **Feedback panel** — the replacement X renders after Not interested. Caret ownership, not `data-testid`, distinguishes it from a Tweet.
- **Main-world bridge** — the page-context click executor reached through a constrained `postMessage` handshake.
- **Action snapshot** — the backend captured at action start. Undo uses it and only reverses newly added Authors.

## Product surfaces

- **Controller** — the headless conductor for assignment, quick actions, Undo, and fail-open Filter commands. `main.tsx` only composes dependencies.
- **Coach** — worker-persisted onboarding and hints. Hints decay after seven days or five assigns; Replay intro resets them.
- **Toast store / Undo registry** — visible outcomes plus one last-wins, ten-second Undo.
- **Picker controller** — cache-first List loading with loading, error, empty, no-match, and ready states.
- **Canonical strings** — shared user-facing copy in `core/strings.ts`, pinned by tests.
