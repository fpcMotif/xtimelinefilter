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
- **Filter scope** — Home, List, Bookmark, and profile timelines. `content/route.ts` rechecks scope after SPA navigation.
- **Facet** — a pure Tweet property: text, photo, video, quote, link destination, role, language, or liked state.
- **Family** — a related group of filter criteria.
- **Criterion** — one selectable Facet rule.
- **Filter mode** — `off`, `only`, or `hide`.
- **Filter projection** — the derived badge count and palette catalog in `core/filter-projection.ts`. Surfaces consume one policy.
- **Filter command** — a temporary, reversible in-page action. The controller conducts it behind a fail-open wall and may arm shared Undo.
- **Filter preference** — durable configuration: criteria, link rules, languages, presets, surfaces, compact mode, and the master toggle.
- **Hidden cell** — a filtered timeline cell collapsed to a reversible stub, never removed. Its overlay and pointer/keyboard targets are inert until shown.
- **Compact mode** — the opt-in mode that also hides the stub. It remains experimental pending live X verification.

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
