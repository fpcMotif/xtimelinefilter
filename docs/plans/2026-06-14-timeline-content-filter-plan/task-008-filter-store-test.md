# Task 008 — Filter store (test / Red)

- **type:** test
- **depends-on:** ["001"]
- **files:** `tests/core/filter-store.test.ts` (new)

## Contract under test

```ts
// src/core/filter-store.ts (impl in task 009)
import type { FilterState, FilterMode, CriterionId } from "@/core/filter-types";
export interface FilterStore {
  state: /* reactive */ FilterState;          // signals-based, mirrors createSettings
  cycle(id: CriterionId): void;               // off → only → hide → off
  setOnlyMyLanguages(on: boolean): void;
  setMyLanguages(langs: string[]): void;
  setLinkRules(rules: FilterState["linkRules"]): void;
  setEnabled(on: boolean): void;
  load(): Promise<void>;                       // hydrate from storage.sync
}
export function createFilterStore(deps?: { storage?: chrome.storage.StorageArea; navLanguages?: string[] }): FilterStore;
```

## BDD Scenario

```gherkin
Scenario: Tri-state cycle
  Given a fresh store and criterion "kind:video" at "off"
  When cycle("kind:video") is called three times
  Then the mode goes "only", then "hide", then back to "off"

Scenario: storage.sync round-trip
  Given a store with onlyMyLanguages true, myLanguages ["ja"], a user linkRule, and a hide criterion
  When the state is persisted and a new store loads from the same fake storage
  Then the loaded FilterState equals the saved one

Scenario: Default is a no-op with seeded languages
  Given a fresh store (no persisted state) with navLanguages ["ja-JP","en-US"]
  Then enabled is true, criteria is empty, onlyMyLanguages is false,
       and myLanguages is seeded (["ja","en"]) from navLanguages

Scenario: storage failure falls back, never throws
  Given a fake storage whose get/set reject
  When load() runs
  Then it resolves to safe defaults and does not throw
```

## Steps

1. Use a **fake `storage.sync`** (in-memory test double) — no real chrome API (external-dependency isolation).
2. Write failing tests for cycle, round-trip, default seeding, and storage-failure fallback.

## Verification

- `bunx vitest run tests/core/filter-store.test.ts` runs and **fails** (Red).
