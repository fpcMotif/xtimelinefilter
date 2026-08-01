# Live verification — Folder save gestures (Alt+B / Alt+Shift+B)

Ticket: #81 · Parent: #79

Unit tests pin controller target resolution, outermost climb, no-target nudge,
already-there (no no-op Undo), j/k non-binding, and article-bound per-post Save.
This checklist is the live proof that a **rebuilt, reloaded** extension actually
behaves the same on Home and status/thread pages. Stale `dist` has already caused
false failures — always rebuild and reload first.

## Preconditions

1. `bun run build` (or the project’s usual production build) succeeds.
2. Chrome → `chrome://extensions` → Lasso → **Reload** the service worker / extension.
3. Open a signed-in x.com tab (Home and at least one status/thread URL).
4. Optional: DevTools → Application → IndexedDB → Lasso collections DB, to confirm writes.

## Known traps (not Lasso bugs)

- **Compose / search / contenteditable focus** steals bare keys and can make j/k feel dead. Click the timeline or press Escape until focus leaves the composer.
- **Status main tweet** often has `tabindex="-1"`; X’s j/k cursor prefers replies. Hover the post or use the per-post **Save** control on the avatar overlay.
- **CDP / synthetic Alt** key events are flaky vs real OS keydowns. Prefer a real keyboard or the on-page Save control for proof.
- **Another extension** may own Alt+hover media download; Lasso only claims documented Alt *keydown* chords (#80).

## Checklist

### Build / reload

- [ ] Build finished with no errors after the change under test.
- [ ] Extension reloaded on `chrome://extensions` (not an old SW).
- [ ] Content script present on the x.com tab (Lasso UI or `?` shortcuts sheet opens).

### Home

- [ ] With timeline focused (not compose), **j** / **k** move X’s native focus (Lasso does not intercept).
- [ ] Hover a post → **Alt+Shift+B** → toast names the default Folder; post is filed (picker holding mark or IndexedDB membership).
- [ ] Hover another post → **Alt+B** → Folder Picker opens for that post; choose a Folder → saved toast; reopen picker shows holding.
- [ ] **Alt+B** / **Alt+Shift+B** with no hover and no j/k focus → nudge: hover or press j (not silence).
- [ ] Save the same post again into a Folder that already holds it → already-there copy; Undo from that gesture is not armed as a no-op.

### Status / thread (“ins”)

- [ ] Open a status URL with replies.
- [ ] Hover the main post or a reply → **Alt+Shift+B** or **Alt+B** files that post (outermost host if the pointer is in a quote).
- [ ] If j/k will not land on the main tweet: use hover or the per-post **Save post to a Folder** control → picker opens and save writes.
- [ ] Filter keys are out of scope here; only confirm Folder gestures still work when filter is inert on the thread.

### Coexistence smoke (with #80)

- [ ] Hold **Alt** and hover media without pressing B/L/N → Lasso does not open UI or toast from Alt alone.
- [ ] **Alt+B** still opens the Folder Picker on keydown.

### Options loop (optional if #82 not done)

- [ ] After a successful save, Options → Manage Folders still shows an increased count (contents browser is #82/#83).

## Pass bar

All Home and status/thread boxes checked after a fresh build+reload. Do not mark #81 done on unit green alone if live reload was skipped.
