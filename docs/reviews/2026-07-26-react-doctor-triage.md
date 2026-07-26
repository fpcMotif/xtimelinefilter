# React Doctor triage — 2026-07-26

Baseline: `6bfc61d`. Command: `bunx react-doctor@latest . --verbose`.
React Doctor v0.9.1 reported 300 warnings: 277 bugs, 17 performance,
2 accessibility, and 4 maintainability.

## Result

| Rule | Count | Triage | Decision |
| --- | ---: | --- | --- |
| `no-unknown-property` | 255 | False positive, high confidence | This is Preact. Its JSX accepts raw `class`, lowercase DOM props, and kebab-case SVG attributes. |
| `style-prop-object` | 16 | False positive, high confidence | All hits are design-card fixtures. Preact's `style` type accepts strings. |
| `async-await-in-loop` | 5 | 2 false positives; 3 need design | Caret polling must wait in order. GraphQL scraping stops after the first sufficient bundle. Convex writes may carry audit, duplicate-input, or ordering semantics; do not parallelize blindly. |
| `js-set-map-lookups` | 4 | True, high confidence | Repeated membership checks. Convert to sets where it keeps the ordered rule behavior. |
| `js-combine-iterations` | 4 | True, low impact | Arrays are small or the separate passes express separate outputs. Defer until profiling or nearby work justifies denser loops. |
| `js-cache-property-access` | 3 | 2 true; 1 false positive | Cache stable IDs used repeatedly inside a loop. The `row.list.id` hits occur in separate array callbacks, so one shared read would not help. |
| `no-reset-all-state-on-prop-change` | 1 | True, high confidence | The palette paints old query/highlight state before its open effect resets them. Remount open content instead. |
| `no-adjust-state-on-prop-change` | 2 | True, high confidence | Same palette lifecycle root cause. |
| `no-effect-chain` | 1 | True, high confidence | Same palette lifecycle root cause. |
| `prefer-html-dialog` | 2 | False positive, high confidence | These are anchored, non-modal popovers. They already expose dialog semantics. Native modal behavior would change positioning and focus. |
| `unused-dependency` | 1 | True, high confidence | `@preact/signals` is unused. The app imports `@preact/signals-core`. |
| `unused-dev-dependency` | 2 | 1 true; 1 false positive | `@edge-runtime/vm` is unused. `dependency-cruiser` powers `lint:boundaries`. |
| `no-non-null-assertion-on-maybe-undefined-result` | 1 | False positive, high confidence | `CRITERIA_GROUPS` iterates the same keys inserted into `byGroup`; each lookup exists by construction. |
| `async-defer-await` | 1 | False positive, high confidence | The awaited owner upsert is a required side effect even when member identity is absent. |
| `no-giant-component` | 1 | True, medium confidence | `OptionsApp` needs an architecture-sized split, not incidental movement in this cleanup. |
| `prefer-useReducer` | 1 | True, medium confidence | Related options state could gain explicit transitions. Defer with the component split. |

Totals: 279 false positives, 18 confirmed, 3 needing design.

## Fix stack

1. Remove the two proven-unused packages.
2. Remount palette content on open; preserve focus and keyboard behavior.
3. Replace repeated lookups and cache stable loop IDs.

Each batch must pass focused tests, typecheck, lint, boundaries, formatting,
and a changed-scope React Doctor run before it lands here.

## Evidence

- Preact compiler selection: `tsconfig.json` uses `jsxImportSource: "preact"`;
  Vite uses `@preact/preset-vite`.
- Preact documents raw HTML/SVG attribute support:
  <https://preactjs.com/guide/v10/differences-to-react/#raw-html-attribute-property-names>.
- Installed Preact types define `class?: string` and
  `style?: string | CSSProperties`.
- `package.json` invokes `depcruise` in `lint:boundaries`.
