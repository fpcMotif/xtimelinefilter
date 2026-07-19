# Owner-aware Picker deepening

Status: approved by the autonomous architecture-loop directive · 2026-07-18  
Domain source: [`docs/CONTEXT.md`](../../CONTEXT.md)  
Decision source: [ADR-0009](../../adr/0009-convex-membership-mirror.md)

## Problem

The current Picker is single-Owner. `ListCache` and `ListUsage` use global keys. The Mirror's catalog and membership reads have no production caller. `ListPicker` passes a raw `XList` into assignment, so rendering can bypass Owner policy.

This violates ADR-0009: X is authoritative; only the active Owner may write; foreign Owners remain read-only; Mirror failure never affects X.

## Decision

Deepen `PickerController` behind three entry points:

```ts
interface PickerController {
  readonly view: ReadonlySignal<PickerView>;
  open(authors: readonly TweetAuthor[]): Promise<void>;
  act(intent: PickerIntent): PickerEffect;
}
```

- `view` is one coherent render snapshot.
- `view.authors` is an immutable Selection captured by `open`; labels, counts, and a
  chosen effect use that same action target even if the live Selection changes.
- `open` owns cache-first loading, X refresh, Mirror projection, recents, membership marks, and stale-generation rejection.
- `act` is the only UI mutation path. A choose intent resolves an opaque row key and rechecks the active Owner.
- `PickerEffect` is `chosen | null`. Only the Controller handles a chosen effect.

The Picker owns choice policy. The Controller retains assignment, pacing, progress, feedback, undo, and Mirror audit writes. This preserves both modules' locality.

## Invariants

1. X is authoritative for the active Owner's List catalog and single-Author membership.
2. Mirror data is a cached hint. It never gates an X action.
3. Only the active Owner's Lists are writable. If Owner cannot be read, only the fresh current-session X catalog remains writable; it is never persisted or mirrored.
4. Foreign Owners' Lists are read-only and show a switch hint.
5. Owner-known row, cache, and usage keys include `Owner.userId` and `List.id`. Owner-unknown rows use a session-only sentinel key.
6. Owner is read on open and again on choose.
7. A foreign row cannot produce a chosen effect. A row from a superseded open no longer exists in current state and cannot be chosen.
8. Missing Owner keeps the pre-Mirror X flow usable, but disables Owner-qualified persistence and Mirror work.
9. Mirror reads, writes, subscriptions, and construction fail open.
10. Old async work cannot publish into a newer open.
11. Bulk Selection never claims a shared membership result.
12. `already-member` remains an idempotent X outcome, not a Picker gate.
13. Closing the Picker disposes its Mirror observation before the UI closes; a broken
    optional disposer is swallowed.

## Data flow

1. Capture the current Selection and Owner.
2. If Owner is known, read the Owner-qualified local cache and recents.
3. If Owner is known, subscribe to the Mirror catalog and, for one Author, cached membership.
4. Fetch the active Owner's Lists from X.
5. If Owner is known, replace only that Owner's cache.
6. For one Author, fetch active membership from X.
7. Reconcile fresh X answers to the Mirror, best effort.
8. Merge active X truth with foreign Mirror hints into one `PickerView`.
9. On choose, resolve the row and re-read Owner.
10. Emit `chosen` only when the row remains writable.

## Dependency strategy

- X reads: true external adapter. Tests use fakes.
- Mirror: remote-but-owned seam. Convex and Null are real adapters.
- Cache and usage: local-substitutable storage. Tests use memory storage.
- Projection, ranking, generation, and choice policy: in-process implementation.

Internal seams stay private. UI learns no storage, Mirror, X-read, or policy details.

## Failure contract

- X fails without cache: named Picker error.
- X refresh fails with cache: cached active rows stay ready.
- Active membership fails: mark unknown; choice remains available.
- Mirror fails: omit Mirror data; active X behavior stays identical.
- Cache, recents, or usage fails: degrade locally; never block X.
- Owner changes before choose: invalidate the stale generation, reopen the captured Selection, and do not assign.

## Interface alternatives rejected

### Assignment inside Picker

Smaller caller interface, worse locality. It moves pacing, progress, feedback, undo, and audit knowledge out of the Controller.

### Extensible action registry

Future-shaped. One action exists. The extra seam has one adapter and fails YAGNI.

### Separate setters and navigation methods

Shallow. Callers must coordinate independently timed state and policy operations.

## Test surface

Test through `view`, `open`, and `act`:

- Owner A/B cache and recents never cross.
- Active rows are writable; foreign rows are not.
- Direct foreign choose returns no effect.
- Owner changes between open and choose reopen the captured Selection and return no effect.
- Active X membership overrides conflicting Mirror data.
- Foreign membership stays cached and timestamped.
- No Mirror and throwing Mirror preserve active X behavior.
- Cache-first load survives refresh failure.
- Empty cache differs from unseen cache.
- Stale async generations cannot overwrite current view.
- Bulk skips per-Author membership.
- UI sends opaque row keys, never raw Lists.
- Controller assigns only a chosen effect.

Keep existing assignment tests for pacing, stop, feedback, undo, and Mirror audit.

## Verification

Run targeted Picker, Controller, cache, usage, MembershipStore, UI, Options, manifest, and Convex tests. Then run typecheck, lint, format, coverage, build, and Playwright. Loaded-extension and live-X proof remain separate external gates.
