# Performance & Migration Log: Tailwind CSS v4 → StyleX

## 1. Executive Summary

- Successfully migrated styling from Tailwind CSS v4 to StyleX.
- Removed dependencies: `tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`, `clsx`, `class-variance-authority`.
- All CSS preflight, resets, tokens, and contrast constraints preserved under `@layer theme, base, components, utilities, stylex`.
- Injected StyleX atomic CSS rules into both document stylesheets (popup, options) and Shadow DOM sheets (`mount.tsx`).
- 100% unit and integration test pass rate (134 test files, 2122 tests).
- 0 lint or dependency boundary violations.

## 2. Bundle Size Metrics

| Asset | Baseline (Tailwind v4) | Migrated (StyleX) | Delta |
| :--- | :--- | :--- | :--- |
| **CSS Bundle (Raw)** | 41.71 kB | 11.35 kB | **-30.36 kB (-72.8%)** |
| **CSS Bundle (Gzip)** | 8.01 kB | 3.38 kB | **-4.63 kB (-57.8%)** |
| **Content Script Chunk (toast-store)** | 35.96 kB (un-injected) | 43.90 kB (with all StyleX rules) | +7.94 kB (self-contained Shadow DOM) |

## 3. Style Invariant Verification

- **Theme Contrast**: Passed WCAG AA contrast floor for `--faint` across all surfaces in both light and dark modes (`tests/ui/theme-contrast.test.ts`).
- **Component Tests**: Passed all 34 UI component interaction and accessibility tests (`tests/ui/components.test.tsx`).
- **Full Test Suite**: Passed all 134 test files and 2,122 tests with `vitest run`.
- **Typecheck**: Clean pass with zero errors across main, Convex, and e2e projects (`bun run typecheck`).
- **Formatting**: 100% clean check across 354 files (`oxfmt --check`).
