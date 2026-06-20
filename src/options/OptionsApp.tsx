import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, type KeyBinding } from "@/content/keyboard";
import { type Coach, createCoach } from "@/core/coach";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import {
  type BackendStrategy,
  createSettings,
  type LassoSettings,
  type SettingsStore,
  type StorageLike,
} from "@/core/settings";
import { clearLassoData, STORAGE_KEYS } from "@/core/storage-keys";
import { PRIVACY_LINE } from "@/core/strings";
import type { XList } from "@/core/x-client/types";
import { LinkRulesEditor, MyLanguagesEditor } from "@/options/FilterOptions";
import { PresetManager, SurfaceOptions } from "@/options/SurfaceOptions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Kbd,
  LassoMark,
  RadioCard,
  Switch,
} from "@/ui/components";
import { COMMAND_LABELS } from "@/ui/ShortcutsSheet";

/** Story beat 9: the promised backend disclosure, verbatim. */
export const ACTIVATION_COPY = {
  auto: "On every visit (default)",
  "on-demand": "Only when I click the toolbar icon",
} as const;

export const BACKEND_COPY: Record<BackendStrategy, string> = {
  dom: "Drive X's own menus — slow, but uses only what you could click yourself",
  rest: "X's public REST endpoints — fast, same calls X's site makes",
  graphql:
    "GraphQL — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately.",
};

export const DEFAULT_LIST_NONE = "None — always ask";
export const DEFAULT_LIST_HINT = "Alt+Shift+L adds straight to this List.";

const SELECT =
  "border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 w-full rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2";

const RAIL: ReadonlyArray<{ label: string; target: string }> = [
  { label: "General", target: "activation" },
  { label: "Connection", target: "connection" },
  { label: "Lists", target: "lists" },
  { label: "Shortcuts", target: "shortcuts" },
  { label: "Timeline filter", target: "filter" },
  { label: "Sync", target: "sync" },
  { label: "Privacy", target: "privacy" },
];

export interface OptionsAppProps {
  settings?: SettingsStore;
  coach?: Coach;
  local?: StorageLike;
  sync?: StorageLike;
  keymap?: KeyBinding[];
  platform?: Platform;
  filter?: FilterStore;
}

/**
 * The real options page (story beat 9): a two-pane settings app — a sticky nav
 * rail beside content cards. Every setting that once lived only in
 * chrome.storage gets a surface, the strongest trust facts move into
 * user-facing copy, and the data Lasso keeps is named and wipeable.
 */
export function OptionsApp({
  settings = createSettings(),
  coach = createCoach(),
  local = chrome.storage.local as unknown as StorageLike,
  sync = chrome.storage.sync as unknown as StorageLike,
  keymap = DEFAULT_KEYMAP,
  platform = detectPlatform(),
  filter = createFilterStore(),
}: OptionsAppProps) {
  const [current, setCurrent] = useState<LassoSettings | null>(null);
  const [lists, setLists] = useState<XList[]>([]);
  const [cleared, setCleared] = useState(false);
  const [replayed, setReplayed] = useState(false);

  useEffect(() => {
    void settings.get().then(setCurrent);
    void filter.load();
    void local.get(STORAGE_KEYS.lists).then((items) => {
      setLists((items[STORAGE_KEYS.lists] as XList[] | undefined) ?? []);
    });
  }, [settings, local, filter]);

  if (!current) return null;

  const patch = (p: Partial<LassoSettings>) => void settings.set(p).then(setCurrent);

  return (
    <div class="mx-auto flex w-full max-w-[920px] gap-8 px-6 py-10">
      <aside class="hidden w-[196px] shrink-0 md:block">
        <div class="sticky top-10 flex flex-col gap-1">
          <div class="mb-4 flex flex-col gap-1 px-3">
            <div class="flex items-center gap-2.5">
              <LassoMark size={22} class="text-primary" />
              <span class="text-[17px] font-bold tracking-tight">Lasso</span>
            </div>
            <span class="text-faint text-[12px] font-medium">Settings</span>
          </div>
          {RAIL.map((item, i) => (
            <RailItem key={item.target} label={item.label} target={item.target} active={i === 0} />
          ))}
          <div class="mt-4 px-3">
            <Badge variant="success">Local-first</Badge>
          </div>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col gap-5">
        <header class="flex flex-col gap-1">
          <h1 class="text-[24px] font-bold tracking-tight">Settings</h1>
          <p class="text-muted-foreground text-[14px]">How and when Lasso runs on x.com.</p>
        </header>

        <Section title="Activation" id="activation">
          <div class="flex flex-col gap-2">
            {(Object.keys(ACTIVATION_COPY) as Array<keyof typeof ACTIVATION_COPY>).map((value) => (
              <RadioCard
                key={value}
                name="activation"
                checked={current.activation === value}
                onSelect={() => patch({ activation: value })}
              >
                {ACTIVATION_COPY[value]}
              </RadioCard>
            ))}
          </div>
        </Section>

        <Section
          title="How Lasso talks to X"
          id="connection"
          helper="Pick the engine. Faster engines reach deeper into X's private surface."
        >
          <div class="flex flex-col gap-2">
            {(Object.keys(BACKEND_COPY) as BackendStrategy[]).map((value) => (
              <RadioCard
                key={value}
                name="backend"
                checked={current.backend === value}
                onSelect={() => patch({ backend: value })}
              >
                {BACKEND_COPY[value]}
              </RadioCard>
            ))}
          </div>
        </Section>

        <Section title="Default List" id="lists">
          <select
            aria-label="Default List"
            value={current.defaultListId ?? ""}
            onChange={(e) => {
              const id = (e.currentTarget as HTMLSelectElement).value;
              patch({ defaultListId: id === "" ? undefined : id });
            }}
            class={SELECT}
          >
            <option value="">{DEFAULT_LIST_NONE}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {current.defaultListId && (
            <p class="text-muted-foreground mt-2 text-[13px]">{DEFAULT_LIST_HINT}</p>
          )}
          {lists.length === 0 && (
            <p class="text-muted-foreground mt-2 text-[13px]">
              Open x.com once so Lasso can see your Lists.
            </p>
          )}
        </Section>

        <Section title="Keyboard shortcuts" id="shortcuts">
          <table class="w-full">
            <tbody>
              {keymap.map((binding) => (
                <tr key={binding.combo} class="border-border/60 border-b last:border-0">
                  <td class="py-2 text-[14px]">{COMMAND_LABELS[binding.command]}</td>
                  <td class="py-2 text-right">
                    {keycaps(binding.combo, platform).map((cap) => (
                      <Kbd key={cap} class="ml-1">
                        {cap}
                      </Kbd>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="text-faint mt-3 text-[13px]">Press ? on x.com anytime.</p>
        </Section>

        <Section
          title="Timeline filter"
          id="filter"
          helper="Narrow Home and List timelines by content. Open the funnel pill on x.com to set the on/off chips; these lists configure the language gate and how links are categorized."
        >
          <Sub heading="My languages">
            When “only my languages” is on, posts outside this allowlist are hidden.
          </Sub>
          <MyLanguagesEditor store={filter} />
          <Sub heading="Link rules" class="mt-5">
            Map a host to a category; your rules win over the built-ins. Anything unmatched is
            Article/Blog.
          </Sub>
          <LinkRulesEditor store={filter} />
          <Sub heading="Surfaces" class="mt-5">
            Turn each filter surface on or off, and set the shortcut that opens the command palette.
          </Sub>
          <SurfaceOptions settings={settings} />
          <Sub heading="Presets" class="mt-5">
            Rename or remove the filter selections you've saved.
          </Sub>
          <PresetManager store={filter} />
        </Section>

        <Section
          title="Sync across your accounts"
          id="sync"
          badge="Local-only"
          helper="Optional. Mirror List membership to your own Convex deployment for cross-account history and instant “already in” checks. Leave both blank to keep Lasso fully local."
        >
          <div class="flex flex-col gap-3 sm:flex-row">
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="text-faint text-[11px] font-semibold tracking-wide uppercase">
                Deployment URL
              </span>
              <Input
                type="url"
                aria-label="Convex deployment URL"
                placeholder="https://your-app.convex.cloud"
                defaultValue={current.convexUrl ?? ""}
                onChange={(e) =>
                  patch({
                    convexUrl: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                  })
                }
              />
            </div>
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="text-faint text-[11px] font-semibold tracking-wide uppercase">
                Device key
              </span>
              <Input
                type="password"
                aria-label="Convex device key"
                placeholder="matches LASSO_DEVICE_KEY"
                defaultValue={current.convexDeviceKey ?? ""}
                onChange={(e) =>
                  patch({
                    convexDeviceKey:
                      (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                  })
                }
              />
            </div>
          </div>
        </Section>

        <Section title="Accessibility" id="access">
          <div class="flex items-center justify-between gap-3 text-[15px]">
            Higher-contrast buttons
            <Switch
              label="Higher-contrast buttons"
              checked={current.highContrast}
              onChange={(on) => patch({ highContrast: on })}
            />
          </div>
          <p class="text-faint mt-1 text-[13px]">AA-safe deeper amber on the accent controls.</p>
        </Section>

        <Section title="Privacy & data" id="privacy">
          <p class="text-[14px]">{PRIVACY_LINE}</p>
          <div class="border-destructive/30 bg-destructive/5 mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <Button
              variant="destructive"
              size="pill"
              onClick={() =>
                void clearLassoData(local, sync).then(() => {
                  setCleared(true);
                  setLists([]);
                  void settings.get().then(setCurrent);
                })
              }
            >
              Clear Lasso data
            </Button>
            {cleared && <span class="text-muted-foreground text-[13px]">Cleared</span>}
            <Button
              variant="outline"
              size="pill"
              onClick={() => void coach.replayIntro().then(() => setReplayed(true))}
            >
              Replay intro
            </Button>
            {replayed && (
              <span class="text-muted-foreground text-[13px]">On your next visit to x.com</span>
            )}
          </div>
        </Section>
      </main>
    </div>
  );
}

function RailItem({ label, target, active }: { label: string; target: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() =>
        document.getElementById(target)?.scrollIntoView?.({ behavior: "smooth", block: "start" })
      }
      class={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
        active
          ? "bg-secondary text-foreground font-semibold"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span class={`h-1.5 w-1.5 rounded-full ${active ? "bg-primary" : "bg-faint"}`} />
      {label}
    </button>
  );
}

function Section({
  title,
  id,
  helper,
  badge,
  children,
}: {
  title: string;
  id?: string;
  helper?: string;
  badge?: string;
  children: ComponentChildren;
}) {
  return (
    <Card id={id} class="scroll-mt-10">
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {badge && <Badge variant="success">{badge}</Badge>}
        </div>
        {helper && <CardDescription>{helper}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Sub({
  heading,
  class: cls,
  children,
}: {
  heading: string;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <div class={`mb-2 ${cls ?? ""}`}>
      <h3 class="mb-1 text-[14px] font-semibold">{heading}</h3>
      <p class="text-muted-foreground text-[13px]">{children}</p>
    </div>
  );
}
