# Plan 000: Harden the verification harness

> **Provenance** — batch `review` · written by the 2026-07-17 adversarial review of plans 001-015, then rewritten against measurements at `6fafd6b`. It fixes the harness every plan trusts, not the code they change. Batch contract: [review/README.md](README.md). Root index: [plans/README.md](../README.md).

## Status

- **Priority**: P1
- **Effort**: S — one test budget, one new file, one plan's done criteria.
- **Risk**: LOW — no `src/` changes; the only test edit relaxes a timeout no assertion depends on.
- **Depends on**: none
- **Category**: DX/harness
- **Planned at**: commit `6fafd6b`, 2026-07-17

## Why

Every plan ends with the same instruction: run the gate, and if it is red you are not done. So anything that makes the gate lie costs an executor a false BLOCKED. Two things do.

**The suite is flaky: 3 of 9 full runs failed at `6fafd6b`, always the same test.** `tests/core/x-client/dom-page-driver.test.ts:224` gives the driver `timeoutMs: 100`, then inserts the menu from a `setTimeout(…, 5)`. Under vitest's parallel workers that 5 ms callback can slip past the 100 ms budget, and the test fails with `timed out waiting for [role="menu"]`. Nothing about the test's intent — "waits for asynchronously inserted menus and dialogs" — depends on the budget being tight. Roughly one executor in three ends BLOCKED on this today.

**The gate also flapped once for a second reason.** The review measured `oxfmt --check` failing on all 112 files at `7ce587e`; at `6fafd6b` it passes on the same 112, and nothing in between touched formatting. The repo sets `core.autocrlf=true` with no `.gitattributes`, so a checkout can materialize CRLF, fail `format:check` wholesale, and go green again once a tool rewrites the files as LF. It recurs on the next fresh clone.

Plan 010 is separately the one live plan whose done criteria cannot all hold at once.

## Steps

### Step 1: Stop the flaky test racing the scheduler

In `tests/core/x-client/dom-page-driver.test.ts:248`, raise the driver's budget so it cannot lose to worker contention:

```ts
const d = createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 2000 });
```

No coverage is lost: the timeout-rejection path is pinned by its own test at :204 (`timeoutMs: 5` → rejects `/timed out/`), and :220's menu is inserted synchronously so its budget never arms. :248 is the only test that must *win* a race.

**Verify**: `for i in $(seq 1 10); do bun run test >/dev/null 2>&1 || echo "FAIL $i"; done` → no output. (Before the fix this prints ~3 failures.)

### Step 2: Pin line endings

Create `.gitattributes` at the repo root with one line:

```
* text=auto eol=lf
```

Then renormalize the index: `git add --renormalize .`

**Verify**: `git status --short -- src tests` lists nothing but Step 1's test file. The tree is already LF, so renormalize must be a no-op; if it rewrites files, STOP.

### Step 3: Make 010's done criteria satisfiable

`plans/improve/010-selection-store-defined-merge.md` requires both "No files outside the in-scope list are modified (`git status --short`)" and a status-row update in `plans/improve/README.md`. The second falsifies the first, and both are ALL-must-hold boxes. Replace the scope box with one that names the doc file as expected:

> - [ ] `git status --short` lists only `src/core/selection-store.ts`, `tests/core/selection-store.test.ts`, and `plans/improve/README.md`

**Verify**: `! grep -q "No files outside the in-scope list are modified" plans/improve/010-selection-store-defined-merge.md`

## Done criteria

- [ ] Each step above passes its own **Verify** line
- [ ] `grep -q "eol=lf" .gitattributes`
- [ ] `git status --short` lists only `.gitattributes`, `tests/core/x-client/dom-page-driver.test.ts`, `plans/improve/010-selection-store-defined-merge.md`, and `plans/review/README.md`

## Deliberately not in this plan

- **001-009 carry the same scope-criterion defect as 010.** They are DONE; editing them changes nothing that will run again.
- **The `..HEAD` drift checks stay.** The review called them inert because "HEAD never moves". It moved — `7ce587e..HEAD` is 12 commits — so they fire, and an empty result is a correct "no drift, proceed". Diffing the working tree instead would conflate upstream drift with the executor's own edits. This correction supersedes the review.
- **The 100% coverage thresholds** (`vitest.config.ts:21`) are decorative: the gate's `bun run test` is `vitest run`, which never evaluates them; `bun run test:coverage` does and is red (~80%). Promoting it would block 010-015 over code they never wrote. Deferred — it needs a ratchet, not a one-line swap. See [improve/README.md](../improve/README.md#deferred-findings-vetted-not-planned-in-this-batch).
- **Auditing the suite for other tight real-timer budgets.** Only :248 was measured flaky. A sweep is worth doing; it is not worth blocking this plan.

## STOP conditions

- **Step 1's loop still fails** — the flake has a cause beyond the budget. Report the failing test and its output; do not raise the budget further.
- **Step 2's renormalize rewrites files** — the tree was not LF after all. Report the list; do not commit a mass line-ending change from inside this plan.
- **The gate is red before Step 1 in a way unrelated to `dom-page-driver.test.ts`** — pre-existing breakage, not yours. Report it; do not repair it here.
