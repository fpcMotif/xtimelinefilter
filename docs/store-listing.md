# Chrome Web Store listing (story beat 1)

**Name:** Lasso — add people to your X Lists from the timeline

**Summary (132-char manifest description):**
Select posts as you scroll and file their authors into your X Lists — without leaving the feed. Keyboard-first.

**Full description:**
Select one or many posts as you scroll and file their authors into your X Lists — without leaving the feed. Keyboard-first. Lasso uses your browser's X session for X requests. Optional Mirror sync connects to your own Convex deployment only when you configure it.

**Icon:** `public/icons/lasso.svg` — one path: a lasso rope whose open loop closes into a check (the loop IS the check). Single-color glyph, 1.5px stroke on a 20px grid; rasterized to 16/32/48/128px via `bun run icons`. Reads at 16px in the toolbar and 128px on the store tile.

**Trust line (shown before Chrome's permission warning, repeated in-product):**
Lasso never sends your X session credentials to the Mirror. Mirror sync is off until you configure it.

Lasso observes top-level document changes only to clear stale toolbar badges. It does not store or send browsing history.

The listing describes only what ships — no promised-but-unbuilt hover quick action.
