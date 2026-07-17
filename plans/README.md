# Implementation plans

Three batches, each in its own folder so provenance stays legible: two written by skills, one by the review of those two. Every plan carries a Provenance line naming what wrote it and where it moved from.

| Batch | Written by | Plans | Status | Contract |
|-------|------------|-------|--------|----------|
| [`improve/`](improve/README.md) | `/improve` skill | 001-010 | 9 DONE · 1 TODO | [improve/README.md](improve/README.md) |
| [`improve-react/`](improve-react/README.md) | `/improve-react` skill | 011-015 | 5 TODO | [improve-react/README.md](improve-react/README.md) |
| [`review/`](review/README.md) | 2026-07-17 adversarial review | 000, 900 | 2 TODO | [review/README.md](review/README.md) |

Each batch README owns its execution order, dependency notes, scan results, and the findings it rejected or deferred. Nothing batch-specific lives in this file.

## Shared contract

- **Status values**: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line rationale — finding fixed independently or approach abandoned).
- **Status rows** live in the batch README, never here.
- **Verification gate**: `bun run typecheck && bun run lint && bun run format:check && bun run test` — all exit 0. CI runs this plus `bun run build` and `bun run e2e`. If the gate is red *before* you change anything, that is pre-existing breakage: STOP and report it, don't repair it inside a plan.
- **The gate is currently unreliable.** Measured at `6fafd6b`: typecheck, lint and format:check pass, but the suite is flaky — 3 of 9 full runs failed on one timing-sensitive test. Roughly one executor in three ends BLOCKED through no fault of their own. **Land [000](review/000-harden-the-verification-harness.md) first**; it is the only plan that fixes this, and until it does, re-run the suite before believing a red gate.

## Number allocation

Plan numbers are global, so a second pass by either skill must not reuse one. Reserved:

| Range | Owner |
|-------|-------|
| 001-010 | `improve/` — closed |
| 011-015 | `improve-react/` — **its next pass takes 016+** |
| 000, 900+ | `review/` — 000 is the harness; 900+ are fixes to already-landed plans |

**If you just ran a skill again**, its output lands flat in `plans/` and it will have rewritten this file — skills don't know about the folders. Move the new plans into their batch folder, stamp each with a Provenance line naming the skill and the commit, restore this index, and fold any new deferred findings into the batch README. Check the new plans against the batch's existing ones first: a re-run re-audits the same code and will re-derive findings already planned here.

## Cross-batch dependency

- **012 after 010** — both edit `src/core/selection-store.ts`, and [012](improve-react/012-scope-selection-subscriptions.md)'s size-neutral-merge test is what makes [010](improve/010-selection-store-defined-merge.md)'s fix user-visible. 010's executor reads 012's Problem section first. This is the only edge between the batches.
