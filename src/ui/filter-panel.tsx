import * as stylex from "@stylexjs/stylex";
import { useState } from "preact/hooks";

import type { FilterStore } from "@/core/filter-store";
import { Button, Input, PresetApplyPill, Switch } from "@/ui/components";
import { CriteriaMatrix } from "@/ui/criteria-matrix";
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

export interface FilterPanelProps {
  store: FilterStore;
  /** When provided, render the "N hidden · show all / hide all" toggle. Omit on surfaces with no live hidden count. */
  hiddenCount?: () => number;
  /**
   * Conduct in-page Filter *commands* (cycle a criterion, reveal/show-all) through
   * the controller's fail-open wall; preferences (master enable, languages,
   * saving presets) stay direct. Omit ⇒ commands run directly on the store.
   */
  conduct?: (run: (s: FilterStore) => void) => void;
}

const styles = stylex.create({
  card: {
    backgroundColor: tokens.card,
    color: tokens.cardForeground,
    borderColor: tokens.border,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    borderRadius: tokens.radiusXl,
    borderWidth: "1px",
    borderStyle: "solid",
    padding: "0.875rem",
    fontSize: tokens.textSm,
    boxSizing: "border-box",
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  switchLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: tokens.textXs,
    fontWeight: "500",
  },
  hiddenStatus: {
    color: tokens.mutedForeground,
    marginLeft: "auto",
    fontSize: tokens.textXs,
    fontVariantNumeric: "tabular-nums",
  },
  revealButton: {
    color: tokens.primary,
    marginLeft: "0.5rem",
    fontWeight: "600",
    textUnderlineOffset: "2px",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    ":hover": {
      textDecorationLine: "underline",
    },
  },
  presetsRow: {
    borderColor: tokens.border,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.375rem",
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    paddingTop: "0.75rem",
  },
  presetsLabel: {
    color: tokens.faint,
    width: "3rem",
    flexShrink: 0,
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  presetInput: {
    marginLeft: "auto",
    height: "1.75rem",
    width: "6rem",
    borderRadius: tokens.radiusMd,
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    fontSize: tokens.textXs,
  },
  saveButton: {
    height: "1.75rem",
    paddingLeft: "0.625rem",
    paddingRight: "0.625rem",
    fontSize: tokens.textXs,
  },
});

/**
 * The Filter's shared, placement-agnostic body for the in-page funnel pill: the
 * master toggle, the "only my languages" gate, an optional hidden-count line
 * with a persistent "show all" / "hide all" reveal toggle, the shared
 * <CriteriaMatrix> chips, and a presets row (apply is a command; save is a
 * preference — rename/delete live in Options). Positioning is the mount's job. No innerHTML of page data
 * (ADR-0003).
 */
export function FilterPanel({ store, hiddenCount, conduct }: FilterPanelProps) {
  // Commands route through the conductor's fail-open wall in-page; with no
  // conductor they run directly on the store.
  const cmd = conduct ?? ((run: (s: FilterStore) => void) => run(store));
  const state = useSignalValue(store.state);
  const revealed = useSignalValue(store.revealed);
  const [draftName, setDraftName] = useState("");
  const hidden = hiddenCount?.();

  function onSave() {
    const name = draftName.trim();
    if (!name) return;
    store.savePreset(name);
    setDraftName("");
  }

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.topRow)}>
        <span {...stylex.props(styles.switchLabel)}>
          <Switch
            label="Timeline filter enabled"
            checked={state.enabled}
            onChange={(on) => store.setEnabled(on)}
          />
          Filter
        </span>
        <span {...stylex.props(styles.switchLabel)}>
          <Switch
            label="Only my languages"
            checked={state.onlyMyLanguages}
            onChange={(on) => store.setOnlyMyLanguages(on)}
          />
          Languages
        </span>
        {hidden !== undefined && (
          <span {...stylex.props(styles.hiddenStatus)}>
            {revealed ? (
              <>
                showing all
                <button
                  type="button"
                  onClick={() => cmd((s) => s.setRevealed(false))}
                  {...stylex.props(styles.revealButton)}
                >
                  hide all
                </button>
              </>
            ) : (
              <>
                {hidden} hidden
                {state.enabled && (
                  <button
                    type="button"
                    onClick={() => cmd((s) => s.setRevealed(true))}
                    {...stylex.props(styles.revealButton)}
                  >
                    show all
                  </button>
                )}
              </>
            )}
          </span>
        )}
      </div>

      <CriteriaMatrix store={store} conduct={conduct} show={state.enabled} />

      <div {...stylex.props(styles.presetsRow)}>
        <span {...stylex.props(styles.presetsLabel)}>Presets</span>
        {state.presets.map((preset) => (
          <PresetApplyPill
            key={preset.id}
            preset={preset}
            onApply={(id) => cmd((s) => s.applyPreset(id))}
          />
        ))}
        <Input
          type="text"
          aria-label="Preset name"
          placeholder="Name…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          sx={styles.presetInput}
        />
        <Button size="sm" sx={styles.saveButton} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
