# ADR-0014 — StyleX UI Styling and Tailwind CSS Rollback Contract

Status: Accepted · 2026-09-06

## Context

Lasso injects UI overlays directly into `x.com` pages inside open Shadow DOM roots (`host.style.all = 'initial'`), alongside standalone extension surfaces (Options workshop and Popup). Previously, the application utilized Tailwind CSS v4 (`@tailwindcss/vite`, `tailwindcss`, `tailwind-merge`, `clsx`, `class-variance-authority`).

While Tailwind provided rapid initial prototyping, production usage surfaced key constraints:
1. **Class Clobbering & Specificity Bugs**: In Preact, component prop spreading and legacy `class="..."` declarations on roots clobbered computed dynamic positions (such as the funnel pill positioning and modal backdrop overlays) due to Preact's prop assignment order.
2. **Runtime Bundle Overhead**: Runtime class resolution and string merging utilities (`tailwind-merge`, `clsx`, `cva`) required shipping dynamic class-resolution dictionaries to the browser, adding ~58 KB raw (~9 KB gzip) across extension bundles.
3. **Shadow DOM Adoption**: Vite's Tailwind integration required raw CSS string imports that did not provide compile-time verification of atomic selectors within Shadow DOM `adoptedStyleSheets`.

## Decision

Migrate all UI presentation across `src/ui/`, `src/options/`, `src/popup/`, and `src/content/` to **StyleX** (`@stylexjs/stylex` and `@stylexjs/unplugin`).

**Current Preference**: StyleX is the primary styling engine for Lasso.

Key implementation architecture:
- **Design Tokens**: Typed design tokens in `src/ui/tokens.stylex.ts` (`stylex.defineVars`) map 1:1 to semantic CSS custom properties declared in `src/ui/styles.css` (`--primary`, `--secondary`, `--card`, `--background`, `--radius`, etc.).
- **Breakpoints**: Media queries are defined in `src/ui/breakpoints.stylex.ts` (`stylex.defineConsts`) to prevent Babel from compiling media queries into CSS variables.
- **Shadow DOM Injection**: Build-time chunk injection via `__STYLEX_SHADOW_CSS_INJECT__` in `vite.config.ts` bundles all compiled StyleX rules directly into `adoptedStyleSheets` inside `src/ui/mount.tsx`.
- **Zero-Dependency Class Composer**: `src/lib/utils.ts` exports a lightweight zero-dependency `cn(...)` utility supporting strings, arrays, and conditional objects without shipping `tailwind-merge` or `clsx`.

## Future Rollback Contract (Tailwind CSS)

Should future constraints require rolling back to the Tailwind CSS choice, the codebase maintains explicit rollback mechanisms:

1. **VCS-Level Rollback (Clean Commit Chain)**:
   - The StyleX migration is preserved as an isolated commit on top of the clean Tailwind baseline bookmark (`baseline/tailwindcss` / `feat/migrate-tailwindcss-to-stylex`).
   - Reverting this single commit (`git revert` or `jj abandon`) immediately returns the entire repository to a green Tailwind CSS state without disrupting domain, routing, or feature commits.

2. **In-Code Rollback Procedure**:
   - **Dependencies**: Reinstall `@tailwindcss/vite`, `tailwindcss`, `tailwind-merge`, `clsx`, and `class-variance-authority`; remove `@stylexjs/stylex` and `@stylexjs/unplugin`.
   - **Build Configuration**: In `vite.config.ts` and `vitest.config.ts`, re-enable `@tailwindcss/vite` and remove `stylexVite`/`stylexRollup`.
   - **Stylesheet**: In `src/ui/styles.css`, restore `@import "tailwindcss";` and the `@theme inline { ... }` block referencing the semantic CSS variables.
   - **Component Backward Compatibility**: All component primitives (`Button`, `Badge`, `Card`, `Input`, `Switch`, etc.) retain `class` and `className` prop forwarding with `cn(...)`, ensuring external consumer call sites remain compatible.
