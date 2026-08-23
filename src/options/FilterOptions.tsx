import { useState } from "preact/hooks";

import { LINK_DEST_LABELS } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { LinkDest } from "@/core/filter-types";
import { Button, Input } from "@/ui/components";
import { useSignalValue } from "@/ui/use-signal-value";

const DEST_LABELS = LINK_DEST_LABELS;
const DESTS = Object.keys(DEST_LABELS) as LinkDest[];

const CHIP =
  "border-border bg-secondary flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-compact font-medium";
const SELECT =
  "border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2";

/** BCP-47 allowlist editor for the "only my languages" gate. */
export function MyLanguagesEditor({ store }: { store: FilterStore }) {
  const { myLanguages } = useSignalValue(store.state);
  const [draft, setDraft] = useState("");

  const add = () => {
    store.setMyLanguages([...myLanguages, draft.trim()]);
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
              class="text-faint hover:text-destructive transition-colors"
            >
              ✕
            </button>
          </span>
        ))}
        {myLanguages.length === 0 && (
          <span class="text-faint text-compact">No languages — gate shows everything.</span>
        )}
      </div>
      <div class="flex gap-2">
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
    <div class="flex flex-col gap-3">
      <ul class="flex flex-col gap-1">
        {linkRules.map((rule) => (
          <li
            key={`${rule.host}:${rule.dest}`}
            class="border-border flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm"
          >
            <span class="font-mono">{rule.host}</span>
            <span class="text-muted-foreground">→ {DEST_LABELS[rule.dest]}</span>
            <button
              type="button"
              aria-label={`Remove rule ${rule.host}`}
              onClick={() => store.setLinkRules(linkRules.filter((r) => r !== rule))}
              class="text-faint hover:text-destructive ml-auto transition-colors"
            >
              ✕
            </button>
          </li>
        ))}
        {linkRules.length === 0 && <li class="text-faint text-compact">No link rules yet.</li>}
      </ul>
      <div class="flex flex-wrap gap-2">
        <Input
          aria-label="Rule host"
          placeholder="e.g. lobste.rs"
          value={host}
          onInput={(e) => setHost((e.currentTarget as HTMLInputElement).value)}
          class="flex-1"
        />
        <select
          aria-label="Rule destination"
          value={dest}
          onChange={(e) => setDest((e.currentTarget as HTMLSelectElement).value as LinkDest)}
          class={SELECT}
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
