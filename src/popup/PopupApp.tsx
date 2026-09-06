import * as stylex from "@stylexjs/stylex";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { mirrorAgeLabel, type MirrorStatus } from "@/core/mirror-status";
import type { CollectionCounts } from "@/core/protocol/collections";
import { createSettings, type SettingsStore } from "@/core/settings";
import {
  folderCountLine,
  POPUP_ACTIVE,
  POPUP_ASLEEP,
  SAVED_EMPTY,
  savedPostsCountLine,
} from "@/core/strings";
import { Badge, Button, Card, LassoMark, PresetApplyPill, Switch } from "@/ui/components";
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

export type TabState = "active" | "asleep" | "off-x";

export interface PopupDeps {
  /** Resolve the active tab's Lasso state. */
  queryState(): Promise<TabState>;
  /** Wake a dormant tab (sends lasso-activate). */
  wake(): Promise<boolean | void>;
  openOptions(): void;
  /** Shared filter store, hydrated from storage.sync on mount; injectable for tests. */
  filter?: FilterStore;
  /** Settings store — owns the live high-contrast page attribute. */
  settings?: SettingsStore;
  /** Last Mirror write outcome (storage.local); absent/null ⇒ no Mirror row. */
  mirrorStatus?(): Promise<MirrorStatus | null>;
  /** Live Mirror status changes while the popup remains open. */
  subscribeMirrorStatus?(cb: (status: MirrorStatus | null) => void): () => void;
  /**
   * The popup's entire collections grant (ADR-0013): one account-free read of
   * how much the user has saved. Read once on mount — never subscribed —
   * absent/null ⇒ no Saved row.
   */
  savedSummary?(): Promise<CollectionCounts | null>;
  now?: () => number;
}

const STATUS: Record<TabState | "loading", { dot: string; label: string }> = {
  active: { dot: "bg-success", label: "Active" },
  asleep: { dot: "bg-primary", label: "Asleep" },
  "off-x": { dot: "bg-faint", label: "Off X" },
  loading: { dot: "bg-border", label: "…" },
};

/**
 * The toolbar popup: a compact *remote* (not the live filter console). The hero
 * row pairs the armed-criteria count with the master Filter switch — the number
 * and the control that governs it read as one unit. Below: the language gate,
 * one-tap preset apply (with a transient "Applied" acknowledgement), the
 * compact-hidden display switch, and a launcher into the full Options workshop.
 * The criteria chips themselves live where you can watch their effect: the
 * in-page funnel pill and the Options "Timeline filter" section.
 */

const styles = stylex.create({
  main: {
    color: tokens.foreground,
    display: "flex",
    width: "320px",
    flexDirection: "column",
    gap: "0.625rem",
    padding: "0.75rem",
    boxSizing: "border-box",
  },
  masterCard: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    padding: "0.875rem",
    boxShadow: tokens.shadowPop,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  brandMark: {
    color: tokens.primary,
  },
  brandTitle: {
    fontSize: "16px",
    fontWeight: "700",
    letterSpacing: "-0.025em",
    margin: 0,
  },
  statusBadge: {
    color: tokens.mutedForeground,
    paddingLeft: "0.625rem",
    paddingRight: "0.625rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
  },
  statusDot: {
    height: "0.375rem",
    width: "0.375rem",
    borderRadius: tokens.radiusFull,
    display: "inline-block",
  },
  dotGreen: {
    backgroundColor: tokens.success,
  },
  dotAmber: {
    backgroundColor: tokens.primary,
  },
  dotMuted: {
    backgroundColor: tokens.mutedForeground,
  },
  dotDestructive: {
    backgroundColor: tokens.destructive,
  },
  masterFilterLabel: {
    display: "flex",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  filterCountWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.375rem",
  },
  filterCountNumber: {
    fontSize: "26px",
    lineHeight: 1,
    fontWeight: "700",
    fontVariantNumeric: "tabular-nums",
    transitionProperty: "color",
    transitionDuration: "150ms",
  },
  filterCountFaint: {
    color: tokens.faint,
  },
  filterCountText: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
  },
  mirrorButton: {
    color: {
      default: tokens.faint,
      ":hover": tokens.foreground,
    },
    marginInline: "-0.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: tokens.radiusMd,
    paddingInline: "0.25rem",
    paddingBlock: "0.125rem",
    textAlign: "left",
    fontSize: tokens.textXs,
    transitionProperty: "color",
    transitionDuration: "150ms",
    outline: "none",
    border: "none",
    background: "none",
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: "0 0 0 2px oklch(from " + tokens.ring + " l c h / 0.55)",
    },
  },
  statusText: {
    color: tokens.faint,
    fontSize: tokens.textXs,
    margin: 0,
  },
  wFull: {
    width: "100%",
  },
  dividerCard: {
    gap: 0,
    padding: 0,
    overflow: "hidden",
  },
  presetsRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    paddingInline: "0.875rem",
    paddingBlock: "0.625rem",
    borderColor: tokens.border,
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  presetsLabel: {
    color: tokens.faint,
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  presetsApplied: {
    color: tokens.success,
    fontSize: tokens.text2xs,
    fontWeight: "500",
  },
  presetChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
  },
  bottomSettings: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    paddingInline: "0.125rem",
  },
  allSettingsButton: {
    width: "100%",
    ":hover": {
      borderColor: tokens.primary,
      color: tokens.primary,
    },
  },
  allSettingsHint: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
    textAlign: "center",
    margin: 0,
  },
  toggleRow: {
    display: "flex",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    paddingInline: "0.875rem",
    paddingBlock: "0.625rem",
    borderColor: tokens.border,
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  toggleLabelCol: {
    display: "flex",
    flexDirection: "column",
  },
  toggleLabelText: {
    fontSize: tokens.textCompact,
    fontWeight: "500",
  },
  toggleHintText: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
  },
  savedRow: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    paddingInline: "0.875rem",
    paddingBlock: "0.625rem",
    textAlign: "left",
    transitionProperty: "background-color",
    transitionDuration: "150ms",
    outline: "none",
    borderWidth: 0,
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: {
      default: "transparent",
      ":hover": "oklch(from " + tokens.secondary + " l c h / 0.5)",
    },
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: "0 0 0 2px oklch(from " + tokens.ring + " l c h / 0.55)",
    },
  },
  savedCountsCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  savedCountNumber: {
    fontSize: tokens.textCompact,
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },
});

export function PopupApp({
  queryState,
  wake,
  openOptions,
  filter: filterProp,
  settings: settingsProp,
  mirrorStatus,
  subscribeMirrorStatus,
  savedSummary,
  now,
}: PopupDeps) {
  // Create the stores ONCE per mount — never as a parameter default. A
  // `create*()` default re-runs every render and spins an infinite re-render
  // loop through useSignalValue + the effect deps (live-verified; pinned by
  // tests/regression/store-stability.test.tsx).
  const filter = useMemo(() => filterProp ?? createFilterStore(), [filterProp]);
  const settings = useMemo(() => settingsProp ?? createSettings(), [settingsProp]);
  const lifecycle = useRef(true);
  const [state, setState] = useState<TabState | null>(null);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const [mirrorConfigId, setMirrorConfigId] = useState<string | null>(null);
  const [savedCounts, setSavedCounts] = useState<CollectionCounts | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const filterState = useSignalValue(filter.state);

  useEffect(() => {
    lifecycle.current = true;
    return () => {
      lifecycle.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void queryState()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch(() => {
        // An injected reader can fail too. The popup must still settle.
        if (mounted) setState("off-x");
      });
    return () => {
      mounted = false;
    };
  }, [queryState]);

  useEffect(() => {
    void filter.load();
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const apply = (next: Awaited<ReturnType<SettingsStore["get"]>>) => {
      document.documentElement.toggleAttribute("data-hc", next.highContrast);
      setMirrorConfigId(
        next.convexUrl && next.convexDeviceKey && next.mirrorConfigId ? next.mirrorConfigId : null,
      );
    };
    const unsubscribe = settings.subscribe((next) => {
      revision += 1;
      if (mounted) apply(next);
    });

    // Subscribe before the read: an Options write that wins the race must not
    // be overwritten by the older snapshot.
    void settings
      .get()
      .then((next) => {
        if (mounted && revision === 0) apply(next);
      })
      .catch(() => {
        // Contrast is cosmetic. Leave the current document state on failure.
      });

    return () => {
      mounted = false;
      unsubscribe();
      document.documentElement.removeAttribute("data-hc");
    };
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeMirrorStatus?.((next) => {
        revision += 1;
        if (mounted) setMirror(next);
      });
    } catch {
      // Mirror status is cosmetic. An injected watcher may fail too.
    }
    try {
      void mirrorStatus?.()
        .then((next) => {
          if (mounted && revision === 0) setMirror(next);
        })
        .catch(() => {
          // Mirror status is observability only; leave its row absent on error.
        });
    } catch {
      // An injected reader can throw before returning its promise.
    }
    return () => {
      mounted = false;
      try {
        unsubscribe?.();
      } catch {
        // Ignore teardown races during extension reload.
      }
    };
  }, [mirrorStatus, subscribeMirrorStatus]);

  useEffect(() => {
    // One-shot on mount — no subscription, no storage watch. The timeline
    // cannot be touched while the popup has focus, so a second channel would
    // buy nothing (ADR-0013).
    let mounted = true;
    try {
      void savedSummary?.()
        .then((next) => {
          if (mounted) setSavedCounts(next);
        })
        .catch(() => {
          // Cosmetic — a rejecting reader just leaves the row absent.
        });
    } catch {
      // An injected reader can throw before returning its promise.
    }
    return () => {
      mounted = false;
    };
  }, [savedSummary]);

  useEffect(() => {
    if (!applied) return;
    const timer = setTimeout(() => setApplied(null), 1600);
    return () => clearTimeout(timer);
  }, [applied]);

  const status = STATUS[state ?? "loading"];
  // One shared core projection — the funnel-pill badge and this count once
  // diverged on a surviving "off" key.
  const armed = activeCriteriaCount(filterState);
  const enabled = filterState.enabled;
  const presetCount = filterState.presets.length;

  return (
    <main {...stylex.props(styles.main)}>
      <Card sx={styles.masterCard}>
        <div {...stylex.props(styles.headerRow)}>
          <div {...stylex.props(styles.brandRow)}>
            <LassoMark size={20} sx={styles.brandMark} />
            <h1 {...stylex.props(styles.brandTitle)}>Lasso</h1>
          </div>
          <Badge variant="secondary" sx={styles.statusBadge}>
            <span
              {...stylex.props(
                styles.statusDot,
                status.dot.includes("bg-success")
                  ? styles.dotGreen
                  : status.dot.includes("bg-primary")
                    ? styles.dotAmber
                    : styles.dotMuted,
              )}
            />
            {status.label}
          </Badge>
        </div>

        <label htmlFor="popup-master-filter" {...stylex.props(styles.masterFilterLabel)}>
          <span id="popup-filter-count" {...stylex.props(styles.filterCountWrap)}>
            <span {...stylex.props(styles.filterCountNumber, !enabled && styles.filterCountFaint)}>
              {armed}
            </span>
            <span {...stylex.props(styles.filterCountText)}>
              {enabled ? (armed === 1 ? "filter armed" : "filters armed") : "filter off"}
            </span>
          </span>
          <Switch
            id="popup-master-filter"
            label="Timeline filter"
            describedBy="popup-filter-count"
            checked={enabled}
            onChange={(on) => filter.setEnabled(on)}
          />
        </label>

        {mirrorConfigId && mirror?.configId === mirrorConfigId && (
          <button type="button" onClick={openOptions} {...stylex.props(styles.mirrorButton)}>
            <span
              {...stylex.props(
                styles.statusDot,
                mirror.ok ? styles.dotGreen : styles.dotDestructive,
              )}
            />
            {mirror.ok ? (
              `Last Mirror write succeeded ${mirrorAgeLabel(mirror.at, (now ?? Date.now)())}`
            ) : (
              <span {...stylex.props(styles.dotDestructive)}>
                Last Mirror write failed — open settings
              </span>
            )}
          </button>
        )}

        {state === "active" && <p {...stylex.props(styles.statusText)}>{POPUP_ACTIVE}</p>}
        {state === "asleep" && (
          <Button
            sx={styles.wFull}
            onClick={() =>
              void wake()
                .then((awake) => {
                  if (lifecycle.current) setState(awake === true ? "active" : "asleep");
                })
                .catch(() => {
                  if (lifecycle.current) setState("asleep");
                })
            }
          >
            {POPUP_ASLEEP}
          </Button>
        )}
        {state === "off-x" && (
          <p role="status" {...stylex.props(styles.statusText)}>
            Open x.com to use Lasso
          </p>
        )}
      </Card>

      <Card sx={styles.dividerCard}>
        <ToggleRow
          label="Only my languages"
          checked={filterState.onlyMyLanguages}
          onChange={(on) => filter.setOnlyMyLanguages(on)}
        />

        <div {...stylex.props(styles.presetsRow)}>
          <span {...stylex.props(styles.presetsLabel)}>Presets</span>
          {applied && (
            <span aria-live="polite" {...stylex.props(styles.presetsApplied)}>
              Applied · {applied}
            </span>
          )}
          {presetCount === 0 ? (
            <span {...stylex.props(styles.statusText)}>Save one from the funnel on x.com</span>
          ) : (
            <div {...stylex.props(styles.presetChips)}>
              {filterState.presets.map((preset) => (
                <PresetApplyPill
                  key={preset.id}
                  preset={preset}
                  onApply={(id) => {
                    filter.applyPreset(id);
                    setApplied(preset.name);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <ToggleRow
          label="Hide filtered posts"
          hint="Collapse filtered rows fully"
          checked={filterState.compactHidden}
          onChange={(on) => filter.setCompactHidden(on)}
        />

        {savedCounts && <SavedRow counts={savedCounts} onOpen={openOptions} />}
      </Card>

      <div {...stylex.props(styles.bottomSettings)}>
        <Button variant="outline" sx={styles.allSettingsButton} onClick={openOptions}>
          All settings
        </Button>
        <p {...stylex.props(styles.allSettingsHint)}>Press ? on x.com for every shortcut</p>
      </div>
    </main>
  );
}

/** A full-width popup row: label (and optional hint) left, switch right. The
    whole row is the <label>, so any tap toggles. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ComponentChildren;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = `popup-${label.toLowerCase().replaceAll(/\W+/g, "-")}`;
  return (
    <label htmlFor={id} {...stylex.props(styles.toggleRow)}>
      <span {...stylex.props(styles.toggleLabelCol)}>
        <span {...stylex.props(styles.toggleLabelText)}>{label}</span>
        {hint && <span {...stylex.props(styles.filterCountText)}>{hint}</span>}
      </span>
      <Switch id={id} label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

/**
 * The popup's entire collections grant, rendered (ADR-0013): an at-a-glance
 * count of how much the user has kept, with no sync line, no spinner and no
 * Retry — a local count that asked the user to retry would be a bug. Two
 * states only, both open Options: an empty pile, and the Saved-Post count with
 * the live Folder count as a secondary cue.
 */
function SavedRow({ counts, onOpen }: { counts: CollectionCounts; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} {...stylex.props(styles.savedRow)}>
      <span {...stylex.props(styles.toggleLabelText)}>Saved</span>
      {counts.savedPosts === 0 ? (
        <span {...stylex.props(styles.statusText)}>{SAVED_EMPTY}</span>
      ) : (
        <span {...stylex.props(styles.savedCountsCol)}>
          <span {...stylex.props(styles.savedCountNumber)}>
            {savedPostsCountLine(counts.savedPosts)}
          </span>
          <span {...stylex.props(styles.filterCountText)}>{folderCountLine(counts.folders)}</span>
        </span>
      )}
    </button>
  );
}
