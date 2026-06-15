---
name: product-documentation
description: Create or update screenshot-backed, user-facing product documentation from the current app behavior. Use when asked to document product features, update a user guide from the current commit, capture app screenshots with browser/CDP/simulator evidence, or maintain an ongoing documentation record for future feature updates.
---

# Product Documentation

Use this skill to turn the current product into a concise user guide backed by real app inspection and screenshots.

## Workflow

1. Confirm the product root and current commit.
   - Run `git status --short --branch` and `git log -1 --oneline`.
   - Read existing product docs before writing new copy.
   - If the provided cwd is empty or not a repo, locate the real project before proceeding.

2. Map the user-visible surfaces.
   - Inspect routes, extension pages, components, tests, fixtures, and existing docs.
   - List major pages, buttons, entry points, keyboard shortcuts, state changes, and post-click outcomes.
   - Separate shipped behavior from planned or aspirational behavior.

3. Run the app or a faithful simulator.
   - Prefer the real local runtime.
   - For browser extensions, cover popup, options/settings, content script UI, install/welcome states, and any simulator harness used by tests.
   - Build first when the app serves built assets or extension bundles.

4. Capture screenshot evidence with browser debugging.
   - Use CDP, browser-harness, Playwright-over-CDP, or a direct CDP WebSocket client.
   - Capture key states, not every microstate.
   - Save screenshots in a stable docs directory such as `docs/product-screenshots/`.
   - Use descriptive numeric names: `01-area-state.png`, `02-area-action-result.png`.
   - Verify screenshots are nonblank and readable before referencing them.

5. Write for regular users.
   - Explain what the feature helps them do and why it is useful.
   - For each page or major surface, itemize entry points, buttons, operations, and post-click behavior.
   - Use exact UI labels when helpful.
   - Avoid implementation details, internal APIs, source filenames, and test mechanics in user-facing sections.
   - Mention limitations only as user-visible states or honest notes.

6. Keep the document extensible.
   - Add a screenshot record table.
   - Include a "Last updated" date and current commit.
   - Add an ongoing documentation notes section with the update convention.
   - Prefer updating the living guide over creating one-off explanations.

7. Verify before finishing.
   - Run the relevant build and documentation checks.
   - Run tests when practical; if a required browser binary or external account is unavailable, report the exact blocker.
   - Validate any skill changes with the skill validator.

## Suggested Outputs

- User guide: `docs/product-documentation.md`
- Screenshots: `docs/product-screenshots/*.png`
- Reusable project skill: `.agents/skills/product-documentation/SKILL.md`

## Chrome Extension Checklist

Cover these surfaces when present:

- Install or welcome page.
- In-page content UI.
- Toolbar popup.
- Options/settings page.
- Keyboard shortcut sheet.
- Success, failure, retry, empty, loading, and permission/account states.
- Badge or asleep/awake state when exposed to users.

## Screenshot Run Notes

If the normal browser-harness profile is blocked by a one-time Chrome Inspect permission prompt, use an isolated Chrome profile with a remote debugging port and connect through CDP. Do not require the user's regular browser profile for documentation screenshots unless the product requires real account state.

For simulators, make the simulator faithful enough to exercise the real built UI bundle. Document that screenshots came from a simulator when live account data was not required.

