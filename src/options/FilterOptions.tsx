import * as stylex from "@stylexjs/stylex";
import { useState } from "preact/hooks";

import { LINK_DEST_LABELS } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { LinkDest } from "@/core/filter-types";
import { Button, Input } from "@/ui/components";
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

const DEST_LABELS = LINK_DEST_LABELS;
const DESTS = Object.keys(DEST_LABELS) as LinkDest[];

const styles = stylex.create({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  chipList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
  },
  chip: {
    borderColor: tokens.border,
    backgroundColor: tokens.secondary,
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: tokens.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.625rem",
    paddingRight: "0.625rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textCompact,
    fontWeight: "500",
  },
  chipRemoveButton: {
    color: {
      default: tokens.faint,
      ":hover": tokens.destructive,
    },
    transitionProperty: "color",
    transitionDuration: "150ms",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    lineHeight: 1,
  },
  emptyText: {
    color: tokens.faint,
    fontSize: tokens.textCompact,
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
  },
  inputRowWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  ruleInput: {
    flex: 1,
  },
  ruleList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    listStyleType: "none",
    padding: 0,
    margin: 0,
  },
  ruleItem: {
    borderColor: tokens.border,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: tokens.radiusXl,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.875rem",
    paddingRight: "0.875rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    fontSize: tokens.textSm,
  },
  ruleHost: {
    fontFamily: tokens.fontMono,
  },
  ruleDest: {
    color: tokens.mutedForeground,
  },
  ruleRemoveButton: {
    color: {
      default: tokens.faint,
      ":hover": tokens.destructive,
    },
    marginLeft: "auto",
    transitionProperty: "color",
    transitionDuration: "150ms",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    lineHeight: 1,
  },
  select: {
    borderColor: tokens.input,
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    height: "2.25rem",
    borderRadius: tokens.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    fontSize: tokens.textSm,
    outline: "none",
    transitionProperty: "color, box-shadow, border-color",
    transitionDuration: "150ms",
    ":focus-visible": {
      borderColor: tokens.primary,
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.4)`,
    },
  },
});

/** BCP-47 allowlist editor for the "only my languages" gate. */
export function MyLanguagesEditor({ store }: { store: FilterStore }) {
  const { myLanguages } = useSignalValue(store.state);
  const [draft, setDraft] = useState("");

  const add = () => {
    store.setMyLanguages([...myLanguages, draft.trim()]);
    setDraft("");
  };

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.chipList)}>
        {myLanguages.map((lang) => (
          <span key={lang} {...stylex.props(styles.chip)}>
            {lang}
            <button
              type="button"
              aria-label={`Remove ${lang}`}
              onClick={() => store.setMyLanguages(myLanguages.filter((l) => l !== lang))}
              {...stylex.props(styles.chipRemoveButton)}
            >
              ✕
            </button>
          </span>
        ))}
        {myLanguages.length === 0 && (
          <span {...stylex.props(styles.emptyText)}>No languages — gate shows everything.</span>
        )}
      </div>
      <div {...stylex.props(styles.inputRow)}>
        <Input
          aria-label="Language to add (BCP-47)"
          placeholder="e.g. ja"
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <Button
          variant="secondary"
          aria-label="Add language"
          disabled={!draft.trim()}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/** Editor for user host → destination Link rules (win over the built-in defaults). */
export function LinkRulesEditor({ store }: { store: FilterStore }) {
  const { linkRules } = useSignalValue(store.state);
  const [host, setHost] = useState("");
  const [dest, setDest] = useState<LinkDest>("article");

  const add = () => {
    if (!DESTS.includes(dest)) return; // storage hygiene: the select can't be trusted forever
    store.setLinkRules([...linkRules, { host: host.trim().toLowerCase(), dest }]);
    setHost("");
    setDest("article");
  };

  return (
    <div {...stylex.props(styles.container)}>
      <ul {...stylex.props(styles.ruleList)}>
        {linkRules.map((rule) => (
          <li key={`${rule.host}:${rule.dest}`} {...stylex.props(styles.ruleItem)}>
            <span {...stylex.props(styles.ruleHost)}>{rule.host}</span>
            <span {...stylex.props(styles.ruleDest)}>→ {DEST_LABELS[rule.dest]}</span>
            <button
              type="button"
              aria-label={`Remove rule ${rule.host}`}
              onClick={() => store.setLinkRules(linkRules.filter((r) => r !== rule))}
              {...stylex.props(styles.ruleRemoveButton)}
            >
              ✕
            </button>
          </li>
        ))}
        {linkRules.length === 0 && <li {...stylex.props(styles.emptyText)}>No link rules yet.</li>}
      </ul>
      <div {...stylex.props(styles.inputRowWrap)}>
        <Input
          aria-label="Rule host"
          placeholder="e.g. lobste.rs"
          value={host}
          onInput={(e) => setHost((e.currentTarget as HTMLInputElement).value)}
          sx={styles.ruleInput}
        />
        <select
          aria-label="Rule destination"
          value={dest}
          onChange={(e) => setDest((e.currentTarget as HTMLSelectElement).value as LinkDest)}
          {...stylex.props(styles.select)}
        >
          {DESTS.map((d) => (
            <option key={d} value={d}>
              {DEST_LABELS[d]}
            </option>
          ))}
        </select>
        <Button variant="secondary" aria-label="Add rule" disabled={!host.trim()} onClick={add}>
          Add rule
        </Button>
      </div>
    </div>
  );
}
