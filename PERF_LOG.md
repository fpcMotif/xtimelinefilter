# Performance & Migration Log: Tailwind CSS v4 → StyleX

## 1. Executive Summary

- Successfully migrated styling from Tailwind CSS v4 to StyleX in dedicated workspace.
- Removed dependencies: `tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`, `clsx`, `class-variance-authority`.
- Added dependencies: `@stylexjs/stylex`, `@stylexjs/unplugin`.
- Preserved CSS preflight, resets, theme variables, and WCAG AA contrast constraints under `@layer theme, base, components, utilities, stylex;`.
- Injected StyleX atomic CSS rules into both document stylesheets (popup, options) and Shadow DOM sheets (`mount.tsx`).
- 100% unit and integration test pass rate (134 test files, 2,119 tests).
- 0 lint or dependency boundary violations.
- Clean typecheck across main, Convex, and e2e packages.

## 2. Bundle Size Metrics

| Asset | Baseline (Tailwind v4) | Migrated (StyleX) | Delta |
| :--- | :--- | :--- | :--- |
| **CSS Bundle (Raw)** | 42.08 kB | 11.35 kB | **-30.73 kB (-73.0%)** |
| **CSS Bundle (Gzip)** | 8.12 kB | 3.38 kB | **-4.74 kB (-58.4%)** |
| **Content Script Chunk (toast-store)** | 35.96 kB (un-injected) | 43.90 kB (with injected StyleX rules) | +7.94 kB (self-contained Shadow DOM) |

## 3. Style Invariant Verification

- **Theme Contrast**: Passed WCAG AA contrast floor for `--faint` across light and dark surfaces (`tests/ui/theme-contrast.test.ts`).
- **Component Tests**: Passed all UI component interaction and accessibility tests (`tests/ui/components.test.tsx`).
- **Full Test Suite**: Passed all 134 test files and 2,119 tests (`bun run test` via Vitest).
- **Typecheck**: Clean pass with 0 errors across main, Convex, and e2e projects (`bun run typecheck`).
- **Boundaries**: 0 violations across 356 modules (`bun run lint:boundaries`).
- **Formatting**: Clean check across 354 files (`bun run format:check`).
