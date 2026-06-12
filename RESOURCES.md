# Resources

## Local Source Of Truth

- `src/core/x-client/caret-actions.ts` — caret menu driver and accepted-click checks.
- `src/content/main-world.ts` — page-world activation bridge.
- `src/manifest.config.ts` — confirms the bridge is loaded with `world: "MAIN"`.
- `tests/core/x-client/caret-actions.test.ts` — regression tests for ignored clicks, stale menus, and feedback panels.
- `e2e/content.spec.ts` — real built-bundle harness for the Alt+N not-interested flow.
- `dist/manifest.json` after `bun run build` — final artifact Chrome actually loads.

## Commands

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run build`
- `bun run e2e`

