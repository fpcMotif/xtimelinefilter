# Folder Replica Sync — setup & troubleshooting (issue #86)

The Folders workshop syncs through your personal Convex deployment
(`folderReplica:push` / `folderReplica:pull`, gated by `LASSO_DEVICE_KEY`).
This runbook is the step-by-step for making it work and for diagnosing it
when it does not.

## Status as of 2026-08-02

Done for you:

- **Convex functions deployed** to the dev deployment (`bunx convex dev --once`).
  Verified against the live deployment: a wrong device key is rejected with
  `Unauthorized: invalid device key`; the real key returns a well-formed page
  (`{"changes":[],"cursor":0,"done":true}`).
- **Extension hardened** so a stalled Convex endpoint can no longer produce
  the misleading `Invalid collections response`: every Convex call now has a
  20 s bound (`boundedReplicaCalls` in `src/packages/folders/convex-replica.ts`)
  and times out into the honest `Offline` state, and `sync-now` runs outside
  the serialized storage queue so a slow sync never jams Folder reads.
- **All four P2 remediation items from the issue are implemented and
  deployed** (second `bunx convex dev --once` push):
  1. Pull pages never split an atomic Folder reorder group — the server
     extends a page to the group's end, so a mid-pull failure cannot leave a
     partially reordered cache.
  2. A duplicate live `(folderId, statusId)` membership from another
     installation is an idempotent no-op, not a false conflict.
  3. A conflicted reorder group containing a new Folder returns `revision: 0`
     for that Folder, and the local acknowledgement validator accepts zero on
     conflict results — the sync reports `conflict` instead of retrying
     forever as `failed`.
  4. Convex rejects Folder names beyond the local 100-code-point protocol
     limit, so a remote write can no longer poison `list-folders` validation.
- **Live verification passed**: the deployment rejects a 101-code-point Folder
  name, and the change stream already carries this installation's real
  Folders, Saved Posts, and memberships (48 entities at last check).

Left for you (below): reload the extension once, verify, add a second
installation, and — when you ship — deploy to production.

## 1. Reload the extension (required once, do this first)

Chrome MV3 service workers keep running the code they started with. A worker
from a build before `sync-now`/`replica-status` existed silently ignores those
messages, and the workshop then reports **`Invalid collections response`** —
this is the most likely cause of the failure you saw.

1. Open `chrome://extensions`.
2. Find **Lasso**, click the **Reload** (circular arrow) icon.
3. Reopen Options → Folders and press **Sync now**.

Any time you rebuild `dist/`, reload the extension the same way — rebuilding
alone does not restart the worker.

## 2. Verify sync on this installation

1. Options → **Deployment URL** and **Device key** are set (the Folder replica
   reuses the Mirror's configuration; both fields must be present).
2. Open the Folders workshop. The status panel should go
   `Syncing Folders…` → `Synced`.
3. The first sync uploads your existing local Folders and Saved Posts. Check
   the deployment side with:
   ```sh
   bunx convex data folderReplicaEntities --limit 5
   ```

## 3. Add a second Chrome installation (profile, browser, or machine)

1. Load the same build there (same `dist/` via Load unpacked, or the same
   packaged extension).
2. Options → enter the **same Deployment URL and Device key**.
3. Open the Folders workshop — it hydrates your Folders and Saved Posts from
   Convex automatically.
4. From then on: every save syncs automatically in the background, opening the
   workshop or a Folder refreshes, and **Sync now** forces convergence before
   you switch machines.

## 4. Production deployment (when you ship)

The push above targeted the **dev** deployment from `.env.local`. For
production:

```sh
bunx convex deploy                                  # push functions + schema to prod
bunx convex env set LASSO_DEVICE_KEY <key> --prod   # same key the extensions use
```

Then point the extension's **Deployment URL** at the prod deployment URL.

## 5. Troubleshooting

| Symptom in the workshop                                            | Cause                                                                                             | Fix                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Invalid collections response`                                     | Stale service worker (older build without the sync operations), or the worker was killed mid-sync | `chrome://extensions` → Reload Lasso. Keep a build with the 20 s call timeout (2026-08-02 or later)       |
| `Sync failed` + `Could not find function for 'folderReplica:push'` | Functions not deployed to the configured deployment                                               | `bunx convex dev` (leave running) or `bunx convex deploy`                                                 |
| `Sync failed` + `Unauthorized: invalid device key`                 | Device key in Options ≠ `LASSO_DEVICE_KEY` on the deployment                                      | Align them; check with `bunx convex env list`                                                             |
| `Offline`                                                          | Network down, endpoint unreachable, or a call exceeded 20 s                                       | Nothing to do — sync resumes on the next trigger; local saves keep working                                |
| `Sync conflicts`                                                   | A concurrent edit could not be merged safely                                                      | Accepted changes stay local; the newer remote state wins. Re-save locally if you want your version pushed |
| Workshop shows old data after switching deployments                | Status is tracked per configuration; a changed URL/key starts a fresh replica state               | Press **Sync now** once                                                                                   |

## 6. Boundaries to remember (from issue #86)

- The **device key is the only access boundary**: anyone who configures the
  same deployment URL + key reads and writes the same collection. It is a
  personal replica, not a multi-user login.
- **Privacy Clear** erases this installation's local replica, pending sync
  work, cursors, and configuration — it does **not** delete the Convex copy.
- The **Default Folder** stays installation-local on purpose; sync never
  changes where a one-keystroke save lands.
- Nothing in the replica is keyed by X account or Chrome profile, so account
  switching never fragments the collection.

## Code map

- `convex/folderReplica.ts` — push/pull functions + server-side merge rules
- `convex/folderReplicaValidators.ts`, `convex/schema.ts` — wire + table shapes
- `src/packages/folders/lib/replica-store.ts` — local outbox, cursors, merge
- `src/packages/folders/convex-replica.ts` — response validation + call timeout
- `src/packages/folders/replica-client.ts` — Convex HTTP client factory
- `src/background/data-lifecycle.ts` — sync scheduling/dedup in the worker
- `src/core/protocol/collections.ts` — `sync-now` / `replica-status` wire shape
