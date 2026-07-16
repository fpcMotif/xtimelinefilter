import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, type KeyBinding } from "@/content/keyboard";
import { type Coach, createCoach } from "@/core/coach";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import {
  type BackendStrategy,
  createSettings,
  type LassoSettings,
  type SettingsStore,
} from "@/core/settings";
import { localArea, syncArea, type StorageLike } from "@/core/storage-areas";
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
import { CriteriaMatrix } from "@/ui/criteria-matrix";
import { COMMAND_LABELS } from "@/ui/ShortcutsSheet";
import { useSignalValue } from "@/ui/use-signal-value";

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

export const CONVEX_URL_ERROR = "Enter a full URL starting with https://";

/**
 * A deployment URL ConvexHttpClient can construct without throwing. A scheme-less
 * or unparseable URL makes its constructor throw synchronously — validating here
 * stops a boot-bricking value from ever being persisted (H1; the factory's
 * fail-open guard is the load-bearing net, this is the visible-feedback channel).
 */
export function isValidConvexUrl(url: string): boolean {
  return (url.startsWith("https://") || url.startsWith("http://")) && URL.canParse(url);
}

const SELECT =
  "border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 w-full rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2";

const RAIL = [
  { label: "General", target: "activation" },
  { label: "Connection", target: "connection" },
  { label: "Lists", target: "lists" },
  { label: "Shortcuts", target: "shortcuts" },
  { label: "Timeline filter", target: "filter" },
  { label: "Surfaces", target: "surfaces" },
  { label: "Sync", target: "sync" },
  { label: "Accessibility", target: "access" },
  { label: "Privacy", target: "privacy" },
] as const;

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
  settings: settingsProp,
  coach: coachProp,
  local = localArea(),
  sync = syncArea(),
  keymap = DEFAULT_KEYMAP,
  platform = detectPlatform(),
  filter: filterProp,
}: OptionsAppProps) {
  // Create the stores ONCE per mount — never as parameter defaults. A
  // `createSettings()`/`createFilterStore()` default re-runs on every render,
  // yielding a fresh store (and signal) each time; fed into the useEffect deps
  // below and useSignalValue, each fresh reference triggers setCurrent/setValue
  // → re-render → new store → an infinite render loop that pegs the main thread
  // (live-verified: the prop-less entry mounts painted once, then froze, so
  // edits never persisted — "flips then reverts"). Tests inject stable stores,
  // so they never tripped it.
  const settings = useMemo(() => settingsProp ?? createSettings(), [settingsProp]);
  const coach = useMemo(() => coachProp ?? createCoach(), [coachProp]);
  const filter = useMemo(() => filterProp ?? createFilterStore(), [filterProp]);

  const [current, setCurrent] = useState<LassoSettings | null>(null);
  const [lists, setLists] = useState<XList[]>([]);
  const [cleared, setCleared] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [urlError, setUrlError] = useState(false);
  const [syncSaved, setSyncSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [activeRail, setActiveRail] = useState<string>(RAIL[0].target);
  const filterState = useSignalValue(filter.state);
  const loaded = current !== null;

  useEffect(() => {
    void settings.get().then(setCurrent);
    void filter.load();
    void local.get(STORAGE_KEYS.lists).then((items) => {
      setLists((items[STORAGE_KEYS.lists] as XList[] | undefined) ?? []);
    });
  }, [settings, local, filter]);

  // Rail scroll-spy: the highlight follows reading position, not just clicks.
  // happy-dom has no IntersectionObserver; the rail then stays click-driven.
  useEffect(() => {
    if (!loaded || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveRail(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const { target } of RAIL) io.observe(document.getElementById(target)!);
    return () => io.disconnect();
  }, [loaded]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-hc", Boolean(current?.highContrast));
  }, [current?.highContrast]);

  useEffect(() => {
    if (!syncSaved) return;
    const timer = setTimeout(() => setSyncSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [syncSaved]);

  if (!current) {
    return (
      <div data-loading="" class="mx-auto flex w-full max-w-[920px] gap-8 px-6 py-10">
        <aside class="hidden w-[196px] shrink-0 md:block">
          <div class="bg-secondary h-44 animate-pulse rounded-xl" />
        </aside>
        <main class="flex min-w-0 flex-1 flex-col gap-5">
          <div class="bg-secondary h-16 w-1/2 animate-pulse rounded-2xl" />
          <div class="bg-secondary h-48 animate-pulse rounded-2xl" />
          <div class="bg-secondary h-72 animate-pulse rounded-2xl" />
        </main>
      </div>
    );
  }

  const patch = (p: Partial<LassoSettings>) => void settings.set(p).then(setCurrent);
  const patchSync = (p: Partial<LassoSettings>) =>
    void settings.set(p).then((s) => {
      setCurrent(s);
      setSyncSaved(true);
    });

  return (
    <div class="mx-auto flex w-full max-w-[920px] gap-8 px-6 py-10">
      <aside class="hidden w-[196px] shrink-0 md:block">
        <div class="sticky top-10 flex flex-col gap-1">
          <div class="mb-4 flex flex-col gap-1 px-3">
            <div class="flex items-center gap-2.5">
              <LassoMark size={22} class="text-primary" />
              <span class="text-[17px] font-bold tracking-tight">Lasso</span>
            </div>
            <span class="text-faint text-xs font-medium">Settings</span>
          </div>
          {RAIL.map((item) => (
            <RailItem
              key={item.target}
              label={item.label}
              target={item.target}
              active={item.target === activeRail}
              onActivate={() => setActiveRail(item.target)}
            />
          ))}
          <div class="mt-4 px-3">
            <Badge variant="success">Local-first</Badge>
          </div>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col gap-5">
        <header class="flex flex-col gap-1">
          <h1 class="text-[24px] font-bold tracking-tight">Settings</h1>
          <p class="text-muted-foreground text-sm">How and when Lasso runs on x.com.</p>
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
            <p class="text-muted-foreground text-compact mt-2">{DEFAULT_LIST_HINT}</p>
          )}
          {lists.length === 0 && (
            <p class="text-muted-foreground text-compact mt-2">
              Open x.com once so Lasso can see your Lists.
            </p>
          )}
        </Section>

        <Section title="Keyboard shortcuts" id="shortcuts">
          <table class="w-full">
            <tbody>
              {keymap.map((binding) => (
                <tr key={binding.combo} class="border-border/60 border-b last:border-0">
                  <td class="py-2 text-sm">{COMMAND_LABELS[binding.command]}</td>
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
          <p class="text-faint text-compact mt-3">Press ? on x.com anytime.</p>
        </Section>

        <Section
          title="Timeline filter"
          id="filter"
          helper="Narrow Home and List timelines by content type. The chips, the language gate, and link categories all live here — and sync to the funnel pill on x.com and the toolbar popup."
        >
          <div class="text-md mb-4 flex items-center justify-between gap-3">
            Filter the timeline
            <Switch
              label="Filter the timeline"
              checked={filterState.enabled}
              onChange={(on) => filter.setEnabled(on)}
            />
          </div>

          <Sub heading="What to filter">
            Cycle each chip off → only → hide. “Only” keeps just those posts; “hide” drops them.
          </Sub>
          <div class="flex flex-col gap-3">
            <CriteriaMatrix store={filter} />
            {!filterState.enabled && (
              <p class="text-faint text-xs">
                The filter is off — these chips apply once you turn it on above.
              </p>
            )}
          </div>

          <Sub heading="My languages" class="mt-5">
            When “only my languages” is on, posts outside this allowlist are hidden.
          </Sub>
          <div class="mb-3 flex items-center justify-between gap-3 text-sm">
            Only my languages
            <Switch
              label="Only my languages"
              checked={filterState.onlyMyLanguages}
              onChange={(on) => filter.setOnlyMyLanguages(on)}
            />
          </div>
          <MyLanguagesEditor store={filter} />

          <Sub heading="Link rules" class="mt-5">
            Map a host to a category; your rules win over the built-ins. Anything unmatched is
            Article/Blog.
          </Sub>
          <LinkRulesEditor store={filter} />

          <Sub heading="Display" class="mt-5">
            How filtered posts leave the timeline.
          </Sub>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span>
              Hide filtered posts completely
              <span class="text-faint mt-0.5 block text-xs">
                Collapse rows to nothing — off keeps the slim placeholders.
              </span>
            </span>
            <Switch
              label="Hide filtered posts completely"
              checked={filterState.compactHidden}
              onChange={(on) => filter.setCompactHidden(on)}
            />
          </div>

          <Sub heading="Presets" class="mt-5">
            Save the current selection, then apply it from the popup or funnel pill. Rename or
            remove saved presets here.
          </Sub>
          <PresetManager store={filter} />
        </Section>

        <Section
          title="Surfaces"
          id="surfaces"
          helper="Where the filter shows up on x.com: the floating funnel pill, the command palette, and the palette's shortcut."
        >
          <SurfaceOptions settings={settings} />
        </Section>

        <Section
          title="Sync across your accounts"
          id="sync"
          badge="Local-only"
          helper="Optional. Mirror List membership to your own Convex deployment for cross-account history and instant “already in” checks. Leave both blank to keep Lasso fully local."
        >
          <div class="flex flex-col gap-3 sm:flex-row">
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="text-faint text-2xs font-semibold tracking-wide uppercase">
                Deployment URL
              </span>
              <Input
                type="url"
                aria-label="Convex deployment URL"
                aria-invalid={urlError}
                placeholder="https://your-app.convex.cloud"
                defaultValue={current.convexUrl ?? ""}
                onChange={(e) => {
                  const raw = (e.currentTarget as HTMLInputElement).value.trim();
                  if (raw === "") {
                    setUrlError(false);
                    patchSync({ convexUrl: undefined });
                    return;
                  }
                  if (!isValidConvexUrl(raw)) {
                    setUrlError(true); // surface the error; never persist a boot-bricking URL
                    return;
                  }
                  setUrlError(false);
                  patchSync({ convexUrl: raw });
                }}
              />
              {urlError && <span class="text-destructive text-xs">{CONVEX_URL_ERROR}</span>}
            </div>
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="text-faint text-2xs font-semibold tracking-wide uppercase">
                Device key
              </span>
              <Input
                type="password"
                aria-label="Convex device key"
                autocomplete="off"
                placeholder="matches LASSO_DEVICE_KEY"
                defaultValue={current.convexDeviceKey ?? ""}
                onChange={(e) =>
                  patchSync({
                    convexDeviceKey:
                      (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                  })
                }
              />
            </div>
          </div>
          {syncSaved && (
            <span aria-live="polite" class="text-success mt-2 block text-xs font-medium">
              Saved
            </span>
          )}
        </Section>

        <Section title="Accessibility" id="access">
          <div class="text-md flex items-center justify-between gap-3">
            Higher-contrast buttons
            <Switch
              label="Higher-contrast buttons"
              checked={current.highContrast}
              onChange={(on) => patch({ highContrast: on })}
            />
          </div>
          <p class="text-faint text-compact mt-1">AA-safe deeper amber on the accent controls.</p>
        </Section>

        <Section title="Privacy & data" id="privacy">
          <p class="text-sm">{PRIVACY_LINE}</p>
          <div class="border-destructive/30 bg-destructive/5 mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-4">
            {confirmClear ? (
              <>
                <span class="text-compact font-medium">
                  Clear settings, cached Lists, and coach state?
                </span>
                <Button
                  variant="destructive"
                  size="pill"
                  onClick={() =>
                    void clearLassoData(local, sync).then(() => {
                      setConfirmClear(false);
                      setCleared(true);
                      setLists([]);
                      void settings.get().then(setCurrent);
                    })
                  }
                >
                  Yes, clear it
                </Button>
                <Button variant="ghost" size="pill" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="destructive" size="pill" onClick={() => setConfirmClear(true)}>
                Clear Lasso data
              </Button>
            )}
            {cleared && !confirmClear && (
              <span class="text-muted-foreground text-compact">Cleared</span>
            )}
            <Button
              variant="outline"
              size="pill"
              onClick={() => void coach.replayIntro().then(() => setReplayed(true))}
            >
              Replay intro
            </Button>
            {replayed && (
              <span class="text-muted-foreground text-compact">On your next visit to x.com</span>
            )}
          </div>
        </Section>
      </main>
    </div>
  );
}

function RailItem({
  label,
  target,
  active,
  onActivate,
}: {
  label: string;
  target: string;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={() => {
        onActivate();
        document.getElementById(target)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }}
      class={`text-compact flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
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
      <h3 class="mb-1 text-sm font-semibold">{heading}</h3>
      <p class="text-muted-foreground text-compact">{children}</p>
    </div>
  );
}
