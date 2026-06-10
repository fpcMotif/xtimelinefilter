# Lasso — Vim-style keyboard layer

> Date: 2026-06-09 · Grounded in `docs/research/07–10` (X native shortcuts, Vim-for-Twitter tools, caret-menu DOM, content keyboard practices), adversarially verified. Activation scheme: **Alt+key** (owner's choice).

## Principle: reuse X's native cursor
`j`/`k` already move real DOM focus onto `article[data-testid="tweet"][tabindex="0"]` (highlight = the browser `:focus-visible` ring). Lasso **never intercepts `j`/`k`** — it only *reads* the focused tweet via `getFocusedTweet()`:
`[aria-activedescendant]` → `getElementById` → `closest(article)`, then `document.activeElement.closest(article)`, then `article:focus-within`. Never cached (the timeline is virtualized); selection is keyed off the parsed status-id so it survives row recycling.

## Keymap (default — all rebindable)
| Combo | Command | Mechanism |
|---|---|---|
| `j` / `k` | native next/prev | passthrough (never intercepted) |
| `x` | toggle Lasso selection on focused tweet | `selection.toggle(extractAuthor(focused))` |
| `s` | toggle multi-select mode | `selection.setSelectMode` |
| `Alt+m` | **mute** focused author | caret → Mute row → confirm-if-present |
| `Alt+n` | **not interested** in focused post | caret → "Not interested" row (no confirm) |
| `Alt+l` | add focused author **to a List** | select author + open the picker |
| `Alt+b` | block (off by default — destructive) | caret → Block → **always** confirm |
| `?` / `Esc` | passthrough | never intercepted |

`Alt+key` is collision-free: every X native shortcut is a bare key (`m`=DM, `l`=like, `n`=new post, `b`=bookmark, `t`=repost, `r`=reply, `/`=search; `g` is a go-to prefix). The capture-phase dispatcher only `preventDefault`s keys Lasso owns, and ignores everything while typing in inputs/contenteditable.

## Action driver (caret menu)
`createCaretActions` clicks the focused tweet's `[data-testid="caret"]`, waits for the menu (`[data-testid="Dropdown"], [role="menu"]` — portalled to `#layers`), then selects the row by stability tier: `data-testid` / Mute icon-path `M18 6.59V1.2` → localized text (`/^(un)?mute/i`, `/not interested/i`, `[data-testid="block"]`). Confirmation handling is per-action: Block **always** confirms (`[data-testid="confirmationSheetConfirm"]`), Mute confirms **if present**, Not-interested **never**. Labels confirmed from the live screenshot ("Mute", "Not interested in this post", "Add/remove from Lists", "Block").

```mermaid
sequenceDiagram
    actor U as You
    participant KL as KeyboardLayer (capture)
    participant DOM as Focused article
    participant L as #layers Dropdown
    U->>DOM: j / k (native X cursor — never intercepted)
    U->>KL: Alt+m
    KL->>KL: ignore if typing; match owned binding; preventDefault
    KL->>DOM: getFocusedTweet() via aria-activedescendant
    KL->>DOM: click [data-testid="caret"]
    DOM->>L: X mounts menu in #layers
    KL->>L: wait Dropdown → row: svg path[d^="M18 6.59V1.2"] else /^mute/i
    KL->>L: muteRow.click()
    KL->>L: confirmIfPresent [data-testid="confirmationSheetConfirm"] (1.5s)
    L-->>U: author muted
```

## Modules
- `content/get-focused-tweet.ts` — focus reader (tested).
- `content/keyboard.ts` — `canonicalCombo`/`eventToCombo`/`installKeyboardLayer` + `DEFAULT_KEYMAP` (tested).
- `core/x-client/caret-actions.ts` — `createCaretActions` mute/not-interested/block (fixture-tested).
- `content/main.tsx` — wires keymap → `runCommand` over the focused tweet; `Alt+l` bumps `openPickerTick` → `App` opens the picker.

## Open / live-verify
- The `Dropdown` testid vs `role="menu"` (we wait for either) and whether Mute shows a confirm sheet — confirm on the live build.
- `aria-activedescendant` placement on the current build (fallbacks cover it).
- `Alt+l` add-to-list currently selects the focused author + opens the picker for the whole selection; could be scoped to just that author if preferred.
