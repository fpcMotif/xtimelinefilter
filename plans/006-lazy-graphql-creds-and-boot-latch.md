# Plan 006: Lazy GraphQL credentials, unbrickable boot, and a real `getLists`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7ce587e..HEAD -- src/core/x-client/graphql-api.ts src/content/main.tsx tests/core/x-client/graphql-api.test.ts tests/core/x-client/contract.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7ce587e`, 2026-07-17

## Why this matters

Three defects compound into one user-facing trap:

1. `GraphqlXListApi` captures `Credentials` at construction, while the REST backend deliberately re-reads them per call ("constructing the backend never throws — ct0 may not be readable at startup / when logged out", `src/core/x-client/rest-api.ts:96-97`). A user who opted into GraphQL and hits a logged-out or cookie-cleared moment gets a constructor that throws — or, worse, stale credentials for the session's lifetime after a ct0 rotation.
2. That constructor throw happens inside `start()`, which has already latched `started = true`. The tab is now permanently inert: no UI, no error, the popup status listener answers "awake" so the popup cheerfully reports **"Active on x.com"**, and even the wake message can't recover (early return) until a full page reload. Reports-success-while-broken at the popup level.
3. `GraphqlXListApi.getLists()` is a permanent `throw` behind the shared `XListApi` interface — a landmine for any consumer that treats backends interchangeably (the interface seam is the point of the strategy pattern).

After this plan: GraphQL creds are read lazily like REST, a failed boot leaves the tab able to report and retry honestly, and `getLists` works via the same v1.1 provider every other consumer uses.

## Current state

- `src/core/x-client/graphql-api.ts` — the opt-in backend; eager creds + throwing `getLists`.
- `src/content/main.tsx` — boot sequence; latches `started` too early; constructs the backend with eager `auth.credentials()`.
- `src/core/x-client/rest-api.ts` — the lazy-creds exemplar.
- `src/core/x-client/lists-provider.ts` — `fetchOwnedLists(deps)`; the one-line `getLists` implementation.
- `tests/core/x-client/graphql-api.test.ts` — constructs `new GraphqlXListApi(creds, …)` directly (call sites to update).
- `tests/core/x-client/contract.test.ts` — same direct construction at :26-38.

Eager creds, `src/core/x-client/graphql-api.ts:21-25`:

```ts
export class GraphqlXListApi implements XListApi {
  constructor(
    private readonly creds: Credentials,
    private readonly deps: GraphqlDeps,
  ) {}
```

The throwing `getLists`, `src/core/x-client/graphql-api.ts:67-71`:

```ts
  async getLists(): Promise<XList[]> {
    // TODO(next TDD cycle): implement via v1.1 lists/ownerships (simpler/stabler
    // than walking ListsManagementPageTimeline GraphQL). Tracked in blueprint §9.
    throw new XApiError("unknown", "GraphqlXListApi.getLists not implemented yet");
  }
```

The premature latch and eager construction, `src/content/main.tsx:91-93` and :106-111:

```ts
async function start(settings: LassoSettings, activatedByUser: boolean): Promise<void> {
  if (started) return;
  started = true;
```

```ts
  const backend = createXListApi(settings.backend, {
    rest: () => new RestXListApi(pageFetch, () => auth.credentials()),
    dom: () => new DomXListApi(createDomPageDriver()),
    graphql: () =>
      new GraphqlXListApi(auth.credentials(), { fetch: pageFetch, config: DEFAULT_GRAPHQL_CONFIG }),
  });
```

Status reporting trusts the latch, `src/content/main.tsx:263-271` (popup asks; `awake: started`), and the activate path swallows failures: `if (msg?.type === "lasso-activate") void start(settings, true);` (:269).

The lazy exemplar, `src/core/x-client/rest-api.ts:98-105`:

```ts
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly getCreds: () => Credentials,
  ) {}

  private deps(): RestDeps {
    return { fetch: this.fetchImpl, creds: this.getCreds() };
  }
```

`lists-provider.ts:32` signature: `fetchOwnedLists(deps: ListsProviderDeps): Promise<XList[]>` where `ListsProviderDeps = { fetch: typeof fetch; creds: Credentials }` (:3-6).

Conventions: backends implement `XListApi` (`src/core/x-client/types.ts`); tests construct backends with stub `fetch` functions returning `new Response(JSON.stringify(...))` (see `tests/core/x-client/contract.test.ts:12-17`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Lint      | `bun run lint`                   | exit 0              |
| Format    | `bun run format:check`           | exit 0              |
| All tests | `bun run test`                   | all pass            |
| Focused   | `bunx vitest run tests/core/x-client/` | all pass        |

## Scope

**In scope** (the only files you should modify):
- `src/core/x-client/graphql-api.ts`
- `src/content/main.tsx`
- `tests/core/x-client/graphql-api.test.ts`
- `tests/core/x-client/contract.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/core/x-client/auth.ts` — `createDocumentAuth` already throws a clear `XApiError("auth")` when ct0 is missing; that behavior is correct and reused.
- `src/popup/*` — the popup honestly renders what the content script reports; the fix is making the report truthful.
- The GraphQL sniffer / queryId refresh (ADR-0004) — a separate decision finding; do not wire it here.
- `src/core/x-client/factory.ts` — the lazy-builder seam already does its job.

## Git workflow

- Branch: `advisor/006-graphql-lazy-creds-boot`
- Up to two commits (backend laziness + getLists; boot latch); message style e.g. `fix: read GraphQL credentials lazily and implement getLists via v1.1` / `fix: latch content-script boot only after successful start`.
- Do NOT push, open a PR, or commit at all unless the operator instructed it — otherwise leave the changes in the working tree.

## Steps

### Step 1: Make GraphQL credentials lazy and implement `getLists`

In `src/core/x-client/graphql-api.ts`:

1. Change the constructor to mirror REST:

```ts
export class GraphqlXListApi {
  constructor(
    private readonly getCreds: () => Credentials,
    private readonly deps: GraphqlDeps,
  ) {}
```

(`implements XListApi` stays.)

2. Update `authHeaders()` (:92-99) to read through the thunk: `const creds = this.getCreds();` at the top, then use `creds.bearer` / `creds.csrf`.
3. Implement `getLists` via the v1.1 provider, replacing the throw (keep a short comment noting this satisfies the interface via the stable endpoint, per the TODO's own guidance):

```ts
  getLists(): Promise<XList[]> {
    return fetchOwnedLists({ fetch: this.deps.fetch, creds: this.getCreds() });
  }
```

Add `import { fetchOwnedLists } from "./lists-provider";`.

**Verify**: `bun run typecheck` → fails only at construction call sites (expected; fixed next step).

### Step 2: Update construction call sites

- `src/content/main.tsx` (:109-110): `graphql: () => new GraphqlXListApi(() => auth.credentials(), { fetch: pageFetch, config: DEFAULT_GRAPHQL_CONFIG }),`
- `tests/core/x-client/graphql-api.test.ts`: every `new GraphqlXListApi(creds, …)` → `new GraphqlXListApi(() => creds, …)`.
- `tests/core/x-client/contract.test.ts` (:26-38): same wrapping in `gqlFresh`/`gqlMember`.

**Verify**: `bun run typecheck` → exit 0. `bunx vitest run tests/core/x-client/` → all pass.

### Step 3: Add backend regression tests

In `tests/core/x-client/graphql-api.test.ts` (model after its existing fetch-stub tests):

- `it("reads credentials lazily per call")` — construct with a `getCreds` spy that throws on first call and succeeds on second; assert the first `addMember` rejects with the auth error and, after flipping the stub, a retry succeeds. The load-bearing assertion: constructing the API with a throwing `getCreds` does NOT throw.
- `it("getLists returns the user's owned lists via v1.1")` — stub `fetch` returning `new Response(JSON.stringify({ lists: [{ id_str: "L1", name: "Research" }] }), { status: 200, headers: { "content-type": "application/json" } })`; assert the resolved value `[{ id: "L1", name: "Research" }]` (match object — `memberCount`/`isPrivate` may be absent) and that the request URL contains `lists/ownerships.json`.

**Verify**: `bunx vitest run tests/core/x-client/graphql-api.test.ts` → all pass, including the 2 new tests.

### Step 4: Latch boot only after success

In `src/content/main.tsx`, rework the boot guard (:89-93) so failure is recoverable and status truthful:

```ts
let started = false;
let booting = false;

async function start(settings: LassoSettings, activatedByUser: boolean): Promise<void> {
  if (started || booting) return;
  booting = true;
  try {
    await boot(settings, activatedByUser);
    started = true; // latch only after a successful boot — a failure must be retryable
  } finally {
    booting = false;
  }
}
```

Rename the existing `start` body (currently :91-254) to `boot(settings, activatedByUser)`, keeping its contents unchanged except removing the `if (started) return; started = true;` prologue (now handled by the wrapper).

Then make the activate path log failures instead of swallowing them (:269): `if (msg?.type === "lasso-activate") void start(settings, true).catch((e) => console.error("[Lasso] start failed", e));` — and apply the same `.catch` to the auto path (:277): `await start(settings, false).catch((e) => console.error("[Lasso] start failed", e));` (or wrap in try/catch; the outermost `main().catch` at :285 already logs init failures, but with the latch moved, `start` rejections must not escape as unhandled rejections on the `void` path).

**Verify**: `bun run typecheck` → exit 0. `bun run lint` → exit 0.

### Step 5: Full gate

**Verify**: `bun run typecheck && bun run lint && bun run format:check && bun run test` → all exit 0.

## Test plan

- GraphQL backend: lazy-creds and getLists tests (Step 3). Model after the file's existing fetch-stub tests and `tests/core/x-client/contract.test.ts:12-17` for response stubs.
- Boot latch: `src/content/main.tsx` has no unit tests (known gap, tracked separately) — verification here is typecheck + e2e (`bun run build && bun run e2e` must stay green; the harness drives the auto path).
- Contract test (`tests/core/x-client/contract.test.ts`) must pass with the wrapped constructors — it is the cross-backend behavioral pin.
- Verification: `bunx vitest run tests/core/x-client/` → all pass, including 2 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` and `bun run format:check` exit 0
- [ ] `bun run test` exits 0; the two new graphql-api tests exist and pass
- [ ] `grep -n "auth.credentials(), {" src/content/main.tsx` returns no matches (no eager creds at construction)
- [ ] `grep -n "not implemented yet" src/core/x-client/` returns no matches
- [ ] `bun run build && bun run e2e` passes
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" no longer match (drift) — particularly the `start()` prologue in `main.tsx`.
- `lists-provider.ts` exports a different signature than `fetchOwnedLists(deps: { fetch, creds })`.
- Existing graphql-api tests assert eager-credential behavior (e.g. constructor throwing) — that would mean the old contract was pinned deliberately; report before re-pinning.
- The e2e suite fails after the boot restructure (the harness depends on boot side effects; report what changed).

## Maintenance notes

- With `started` latched post-boot, the popup's "Active on x.com" becomes truthful; a failed boot now answers "asleep" and the wake click retries. Consider surfacing boot failures as a toast in a follow-up (out of scope here).
- In PR review, scrutinize: (a) `booting` prevents concurrent boots without latching; (b) no path sets `started` other than post-success; (c) `authHeaders` is the ONLY creds consumer in graphql-api (no lingering `this.creds` references).
- Follow-up deliberately deferred: wiring the runtime GraphQL-config sniffer (ADR-0004) — a product decision with its own review surface.
- After this lands, all three backends read credentials lazily; keep any future backend on the same `() => Credentials` pattern.
