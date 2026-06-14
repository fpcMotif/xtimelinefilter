import { useState } from "preact/hooks";

import type { FilterStore } from "@/core/filter-store";
import type { LinkDest } from "@/core/filter-types";
import { useSignalValue } from "@/ui/use-signal-value";

const DEST_LABELS: Record<LinkDest, string> = {
  article: "Article/Blog",
  arxiv: "arXiv",
  hn: "Hacker News",
  reddit: "Reddit",
  youtube: "YouTube",
  github: "GitHub",
};
const DESTS = Object.keys(DEST_LABELS) as LinkDest[];

const CHIP = "border-line flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px]";
const INPUT = "border-line bg-surface rounded-lg border px-3 py-2 text-[15px]";
const BTN = "border-line hover:bg-elevated rounded-full border px-3 py-1.5 text-sm font-semibold";

/** BCP-47 allowlist editor for the "only my languages" gate. */
export function MyLanguagesEditor({ store }: { store: FilterStore }) {
  const { myLanguages } = useSignalValue(store.state);
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    store.setMyLanguages([...myLanguages, value]);
    setDraft("");
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-1.5">
        {myLanguages.map((lang) => (
          <span key={lang} class={CHIP}>
            {lang}
            <button
              type="button"
              aria-label={`Remove ${lang}`}
              onClick={() => store.setMyLanguages(myLanguages.filter((l) => l !== lang))}
              class="text-muted hover:text-ink"
            >
              ✕
            </button>
          </span>
        ))}
        {myLanguages.length === 0 && (
          <span class="text-muted text-[13px]">No languages — gate shows everything.</span>
        )}
      </div>
      <div class="flex gap-2">
        <input
          aria-label="Language to add (BCP-47)"
          placeholder="e.g. ja"
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          class={INPUT}
        />
        <button type="button" aria-label="Add language" onClick={add} class={BTN}>
          Add
        </button>
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
    const h = host.trim().toLowerCase();
    if (!h || !DESTS.includes(dest)) return;
    store.setLinkRules([...linkRules, { host: h, dest }]);
    setHost("");
    setDest("article");
  };

  return (
    <div class="flex flex-col gap-3">
      <ul class="flex flex-col gap-1">
        {linkRules.map((rule) => (
          <li key={`${rule.host}:${rule.dest}`} class="flex items-center gap-2 text-[14px]">
            <span class="font-mono">{rule.host}</span>
            <span class="text-muted">→ {DEST_LABELS[rule.dest]}</span>
            <button
              type="button"
              aria-label={`Remove rule ${rule.host}`}
              onClick={() => store.setLinkRules(linkRules.filter((r) => r !== rule))}
              class="text-muted hover:text-ink ml-auto"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div class="flex gap-2">
        <input
          aria-label="Rule host"
          placeholder="e.g. lobste.rs"
          value={host}
          onInput={(e) => setHost((e.currentTarget as HTMLInputElement).value)}
          class={`${INPUT} flex-1`}
        />
        <select
          aria-label="Rule destination"
          value={dest}
          onChange={(e) => setDest((e.currentTarget as HTMLSelectElement).value as LinkDest)}
          class={INPUT}
        >
          {DESTS.map((d) => (
            <option key={d} value={d}>
              {DEST_LABELS[d]}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Add rule" onClick={add} class={BTN}>
          Add rule
        </button>
      </div>
    </div>
  );
}
