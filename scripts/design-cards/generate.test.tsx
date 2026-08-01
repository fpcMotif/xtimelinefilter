/**
 * Design-card generator — renders the REAL Lariat components (with seeded real
 * stores) under the repo's own vitest/happy-dom pipeline and writes one
 * self-contained HTML card per component into scripts/design-cards/out/, each
 * showing a light and a dark pane built from the real compiled Tailwind CSS.
 * The cards are the review surface for the claude.ai/design "Lasso — Lariat
 * Design System" project; regenerate after any styling change:
 *
 *   bun run build && bunx vitest run -c scripts/design-cards/vitest.config.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render, waitFor } from "@testing-library/preact";
import type { VNode } from "preact";
import { describe, expect, it } from "vitest";

import { DEFAULT_KEYMAP } from "@/content/keyboard";
import { createCoach } from "@/core/coach";
import { CRITERIA_GROUPS } from "@/core/filter-criteria";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import { createSettings, type StorageLike } from "@/core/settings";
import type { ActiveToast } from "@/core/toast-store";
import { OptionsApp } from "@/options/OptionsApp";
import { XApiError, type XList } from "@/packages/x-client/types";
import { PopupApp } from "@/popup/PopupApp";
import { ActionBar } from "@/ui/ActionBar";
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
  PresetApplyPill,
  RadioCard,
  Switch,
} from "@/ui/components";
import { CriteriaMatrix } from "@/ui/criteria-matrix";
import { FilterPalette } from "@/ui/filter-palette";
import { FilterPanel } from "@/ui/filter-panel";
import { FunnelPill } from "@/ui/funnel-pill";
import { ListPicker } from "@/ui/ListPicker";
import { ShortcutsSheet } from "@/ui/ShortcutsSheet";
import { ToastView } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";
import { WelcomeCard } from "@/ui/WelcomeCard";

const ROOT = join(__dirname, "../..");
const OUT = join(__dirname, "out");

/* ── fixtures ────────────────────────────────────────────────────────────── */

function fakeStorage(): StorageLike {
  const items: Record<string, unknown> = {};
  return {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: items[keys] };
      return { ...items };
    },
    async set(next) {
      Object.assign(items, next);
    },
  };
}

const LISTS: XList[] = [
  { id: "1", name: "Builders", memberCount: 48 },
  { id: "2", name: "ML papers", memberCount: 121 },
  { id: "3", name: "Friends irl", memberCount: 17 },
] as XList[];

function fakeCache(opts: { cached?: XList[] | null; fresh?: () => Promise<XList[]> }): ListCache {
  const fresh = opts.fresh ?? (async () => opts.cached ?? []);
  return {
    async lists({ force = false }: { force?: boolean } = {}) {
      if (force) return fresh();
      if (opts.cached?.length) return opts.cached;
      return fresh();
    },
    async search() {
      return [];
    },
  } as unknown as ListCache;
}

function seededFilter(): FilterStore {
  const store = createFilterStore({ storage: fakeStorage() });
  const ids = CRITERIA_GROUPS.flatMap((g) => g.criteria.map((c) => c.id));
  if (ids[0]) store.cycle(ids[0]); // only
  if (ids[1]) {
    store.cycle(ids[1]);
    store.cycle(ids[1]); // hide
  }
  store.savePreset("Reading");
  store.savePreset("Video night");
  return store;
}

const AUTHORS = [
  { screenName: "jane", displayName: "Jane Doe" },
  { screenName: "sam_builds", displayName: "Sam" },
  { screenName: "moss", displayName: "Moss" },
];

const noop = () => {};

const rootDecls = (text: string): string[] =>
  [...text.matchAll(/:root(?:\s*,\s*:host)?\{([^{}]*)\}/g)].map((match) => match[1] ?? "");

/* ── card shell ──────────────────────────────────────────────────────────── */

function loadCss(): { css: string; paneCss: string } {
  const assets = join(ROOT, "dist/assets");
  const file = readdirSync(assets).find((f) => f.startsWith("styles-") && f.endsWith(".css"));
  if (!file) throw new Error("run `bun run build` first — no dist/assets/styles-*.css");
  const css = readFileSync(join(assets, file), "utf8");

  const darkInner: string[] = [];
  const marker = "@media (prefers-color-scheme:dark)";
  let withoutDark = "";
  let cursor = 0;
  let i = css.indexOf(marker);
  while (i !== -1) {
    const open = css.indexOf("{", i);
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    darkInner.push(css.slice(open + 1, j - 1));
    withoutDark += css.slice(cursor, i);
    cursor = j;
    i = css.indexOf(marker, j);
  }
  withoutDark += css.slice(cursor);

  const paneCss =
    rootDecls(withoutDark)
      .map((d) => `[data-ds-theme="light"]{${d}}`)
      .join("\n") +
    "\n" +
    darkInner
      .flatMap(rootDecls)
      .map((d) => `[data-ds-theme="dark"]{${d}}`)
      .join("\n");
  return { css, paneCss };
}

interface CardOpts {
  group: string;
  name: string;
  file: string;
  body: string;
  legacy?: boolean;
  wide?: boolean;
  minHeight?: number;
}

function writeCard(shared: { css: string; paneCss: string }, opts: CardOpts): void {
  const flag = opts.legacy
    ? `<span class="legacy-flag">legacy tokens — migration pending review</span>`
    : "";
  // Radio groups are document-wide per `name`: namespace the dark pane's names
  // so a checked radio in one pane is not stolen by its twin in the other.
  const pane = (theme: string) =>
    `<div class="pane" data-ds-theme="${theme}" style="--pane-min:${opts.minHeight ?? 220}px">` +
    `<p class="pane-label">${theme}${flag ? " " : ""}</p>${flag}` +
    `${theme === "dark" ? opts.body.replaceAll('name="', 'name="dark-') : opts.body}</div>`;
  const html = `<!-- @dsCard group="${opts.group}" name="${opts.name}" -->
<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.name} — Lasso Lariat</title>
<style>${shared.css}</style>
<style>
*{box-sizing:border-box}
body{margin:0;display:grid;grid-template-columns:${opts.wide ? "1fr" : "1fr 1fr"};min-height:100vh;background:transparent}
.pane{position:relative;overflow:hidden;transform:translateZ(0);padding:20px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;min-height:var(--pane-min)}
[data-ds-theme="dark"]{color-scheme:dark}
[data-ds-theme="light"]{color-scheme:light}
.pane-label{display:inline-block;font:600 10px/1 var(--font-sans);letter-spacing:.1em;text-transform:uppercase;opacity:.45;margin:0 0 14px}
.legacy-flag{display:inline-block;margin:0 0 12px 10px;font:600 9px/1 var(--font-sans);letter-spacing:.06em;color:var(--primary);border:1px solid var(--primary);border-radius:999px;padding:4px 8px;text-transform:uppercase;vertical-align:top}
${shared.paneCss}
</style></head>
<body>${pane("light")}${pane("dark")}</body></html>
`;
  writeFileSync(join(OUT, opts.file), html);
}

/** Preact sets checked/value as DOM *properties*; innerHTML serialization drops
    them, so mirror them onto attributes before snapshotting. */
function freezeFormState(container: HTMLElement): void {
  for (const input of container.querySelectorAll("input")) {
    if (input.checked) input.setAttribute("checked", "");
    else input.removeAttribute("checked");
    if (input.value) input.setAttribute("value", input.value);
  }
}

async function snap(vnode: VNode, ready?: (r: ReturnType<typeof render>) => unknown) {
  const r = render(vnode);
  if (ready) await waitFor(() => ready(r));
  freezeFormState(r.container);
  const html = r.container.innerHTML;
  r.unmount();
  return html;
}

const section = (label: string, inner: string) =>
  `<div style="margin-bottom:18px"><p style="font:600 10px/1 var(--font-sans);letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin:0 0 8px">${label}</p>${inner}</div>`;

/* ── the generator ───────────────────────────────────────────────────────── */

describe("design-card generator", () => {
  /* oxlint-disable react/style-prop-object -- This card-rendering fixture deliberately serializes inline CSS strings. */
  it("writes the Lariat card bundle", async () => {
    mkdirSync(OUT, { recursive: true });
    const shared = loadCss();
    const failures: string[] = [];
    const made: string[] = [];

    async function card(opts: Omit<CardOpts, "body">, make: () => Promise<string> | string) {
      try {
        writeCard(shared, { ...opts, body: await make() });
        made.push(opts.file);
      } catch (err) {
        failures.push(`${opts.file}: ${String(err)}`);
      }
    }

    /* Foundations */
    await card(
      {
        group: "Foundations",
        name: "Color tokens",
        file: "foundations-colors.html",
        minHeight: 360,
      },
      () => {
        const tokens = [
          "background",
          "foreground",
          "card",
          "popover",
          "primary",
          "primary-foreground",
          "secondary",
          "muted-foreground",
          "faint",
          "destructive",
          "success",
          "border",
          "input",
          "ring",
        ];
        const sw = tokens
          .map(
            (t) =>
              `<div style="display:flex;flex-direction:column;gap:4px"><div style="height:40px;border-radius:10px;border:1px solid var(--border);background:var(--${t})"></div><span style="font:500 10px/1.3 var(--font-sans);opacity:.7">--${t}</span></div>`,
          )
          .join("");
        const type = [
          ["text-2xs", "11px"],
          ["text-xs", "12px"],
          ["text-compact", "13px"],
          ["text-sm", "14px"],
          ["text-md", "15px"],
        ]
          .map(
            ([n, px]) =>
              `<p style="margin:2px 0;font-size:${px};font-family:var(--font-sans)">${n} · ${px} — Add three people to Builders</p>`,
          )
          .join("");
        const shadows = `<div style="display:flex;gap:16px"><div style="width:120px;height:56px;border-radius:14px;background:var(--card);box-shadow:var(--shadow-elevated)"></div><div style="width:120px;height:56px;border-radius:14px;background:var(--card);box-shadow:var(--shadow-pop)"></div></div>`;
        return (
          section(
            "Palette",
            `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:10px">${sw}</div>`,
          ) +
          section("Type scale", type) +
          section("Elevation — shadow-elevated · shadow-pop", shadows)
        );
      },
    );

    /* Primitives */
    await card(
      { group: "Primitives", name: "Button", file: "primitives-button.html", minHeight: 300 },
      async () => {
        const variants = [
          "default",
          "secondary",
          "outline",
          "ghost",
          "destructive",
          "link",
        ] as const;
        const rows = await Promise.all(
          variants.map(async (v) =>
            section(
              v,
              await snap(
                <div style="display:flex;gap:10px;align-items:center">
                  <Button variant={v}>Add to List</Button>
                  <Button variant={v} size="sm">
                    Small
                  </Button>
                  <Button variant={v} size="pill">
                    Pill
                  </Button>
                  <Button variant={v} disabled>
                    Disabled
                  </Button>
                </div>,
              ),
            ),
          ),
        );
        return rows.join("");
      },
    );

    await card({ group: "Primitives", name: "Badge", file: "primitives-badge.html" }, () =>
      snap(
        <div style="display:flex;gap:10px;align-items:center">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Local-first</Badge>
        </div>,
      ),
    );

    await card(
      { group: "Primitives", name: "Card", file: "primitives-card.html", minHeight: 260 },
      () =>
        snap(
          <Card style="max-width:420px">
            <CardHeader>
              <CardTitle>Timeline filter</CardTitle>
              <CardDescription>Narrow Home and List timelines by content type.</CardDescription>
            </CardHeader>
            <CardContent>
              <p class="text-sm">Card body content sits here.</p>
            </CardContent>
          </Card>,
        ),
    );

    await card({ group: "Primitives", name: "Input", file: "primitives-input.html" }, async () => {
      const normal = await snap(
        <div style="max-width:340px;display:flex;flex-direction:column;gap:10px">
          <Input placeholder="https://your-app.convex.cloud" />
          <Input defaultValue="https://silent-crab-355.convex.cloud" />
        </div>,
      );
      const invalid = await snap(
        <div style="max-width:340px">
          <Input aria-invalid defaultValue="not-a-url" />
        </div>,
      );
      return section("Default · filled", normal) + section("aria-invalid", invalid);
    });

    await card({ group: "Primitives", name: "Kbd", file: "primitives-kbd.html" }, () =>
      snap(
        <div style="display:flex;gap:6px;align-items:center">
          <Kbd>⌥</Kbd>
          <Kbd>L</Kbd>
          <span class="text-compact" style="opacity:.6">
            adds straight to the default List
          </span>
        </div>,
      ),
    );

    await card({ group: "Primitives", name: "LassoMark", file: "primitives-lasso-mark.html" }, () =>
      snap(
        <div style="display:flex;gap:16px;align-items:end" class="text-primary">
          <LassoMark size={16} />
          <LassoMark size={24} />
          <LassoMark size={40} />
          <LassoMark size={64} />
        </div>,
      ),
    );

    await card({ group: "Primitives", name: "Switch", file: "primitives-switch.html" }, () =>
      snap(
        <div style="display:flex;gap:16px;align-items:center">
          <Switch label="Off" checked={false} onChange={noop} />
          <Switch label="On" checked onChange={noop} />
        </div>,
      ),
    );

    await card(
      {
        group: "Primitives",
        name: "RadioCard",
        file: "primitives-radio-card.html",
        minHeight: 240,
      },
      () =>
        snap(
          <div style="max-width:420px;display:flex;flex-direction:column;gap:8px">
            <RadioCard name="demo" checked onSelect={noop}>
              On every visit (default)
            </RadioCard>
            <RadioCard name="demo" checked={false} onSelect={noop}>
              Only when I click the toolbar icon
            </RadioCard>
          </div>,
        ),
    );

    await card(
      { group: "Primitives", name: "PresetApplyPill", file: "primitives-preset-pill.html" },
      () => {
        const store = seededFilter();
        return snap(
          <div style="display:flex;gap:8px">
            {store.state.value.presets.map((p) => (
              <PresetApplyPill key={p.id} preset={p} onApply={noop} />
            ))}
          </div>,
        );
      },
    );

    /* Filter surfaces */
    await card(
      {
        group: "Filter surfaces",
        name: "CriteriaMatrix",
        file: "filter-criteria-matrix.html",
        minHeight: 260,
      },
      () =>
        snap(
          <div style="max-width:420px;display:flex;flex-direction:column;gap:12px">
            <CriteriaMatrix store={seededFilter()} />
          </div>,
        ),
    );

    await card(
      { group: "Filter surfaces", name: "FilterPanel", file: "filter-panel.html", minHeight: 420 },
      () =>
        snap(
          <div style="max-width:320px" class="bg-card shadow-elevated overflow-hidden rounded-2xl">
            <FilterPanel store={seededFilter()} hiddenCount={() => 7} />
          </div>,
        ),
    );

    await card(
      {
        group: "Filter surfaces",
        name: "FunnelPill — closed + open",
        file: "filter-funnel-pill.html",
        minHeight: 520,
      },
      async () => {
        // The pill is controlled: `open` comes from the parent, so both states
        // are rendered by prop rather than by clicking it into one.
        const closed = await snap(
          <FunnelPill
            store={seededFilter()}
            hiddenCount={() => 7}
            position={{ x: 16, y: 16 }}
            onPositionChange={noop}
            open={false}
            onOpenChange={noop}
          />,
        );
        const r = render(
          <FunnelPill
            store={seededFilter()}
            hiddenCount={() => 7}
            position={{ x: 16, y: 90 }}
            onPositionChange={noop}
            open
            onOpenChange={noop}
          />,
        );
        await waitFor(() => r.getByRole("dialog"));
        freezeFormState(r.container);
        const open = r.container.innerHTML;
        r.unmount();
        return (
          section(
            "Closed (badge = armed count)",
            `<div style="position:relative;height:70px">${closed}</div>`,
          ) + section("Open", `<div style="position:relative;height:420px">${open}</div>`)
        );
      },
    );

    await card(
      {
        group: "Filter surfaces",
        name: "FilterPalette",
        file: "filter-palette.html",
        minHeight: 420,
      },
      () => snap(<FilterPalette store={seededFilter()} open onClose={noop} />),
    );

    /* List-assign surfaces */
    await card(
      {
        group: "List-assign surfaces",
        name: "Toast",
        file: "assign-toast.html",
        minHeight: 260,
      },
      async () => {
        const t = (toast: ActiveToast) =>
          snap(<ToastView toast={toast} onAct={noop} onDismiss={noop} />);
        const success = await t({
          id: 1,
          kind: "success",
          title: "Added 3 people to Builders",
        } as unknown as ActiveToast);
        const info = await t({
          id: 2,
          kind: "info",
          title: "Nothing to undo",
        } as unknown as ActiveToast);
        const danger = await t({
          id: 3,
          kind: "danger",
          title: "Rate limited by X",
          line: "Stopped after 2 of 5. Try again in a few minutes.",
        } as unknown as ActiveToast);
        return (
          section("success", success) + section("info", info) + section("danger (persists)", danger)
        );
      },
    );

    await card(
      {
        group: "List-assign surfaces",
        name: "ListPicker — 4 of 5 states",
        file: "assign-list-picker.html",
        wide: true,
        minHeight: 460,
      },
      async () => {
        const ready = createPickerController({
          cache: fakeCache({ cached: LISTS }),
          currentOwner: () => null,
        });
        await ready.open(AUTHORS.slice(0, 2));
        const loading = createPickerController({
          cache: fakeCache({ cached: null, fresh: () => new Promise<XList[]>(() => {}) }),
          currentOwner: () => null,
        });
        void loading.open(AUTHORS.slice(0, 1));
        const empty = createPickerController({
          cache: fakeCache({ cached: null }),
          currentOwner: () => null,
        });
        await empty.open(AUTHORS.slice(0, 1));
        const error = createPickerController({
          cache: fakeCache({
            cached: null,
            fresh: async () => {
              throw new XApiError("auth", "401");
            },
          }),
          currentOwner: () => null,
        });
        await error.open(AUTHORS.slice(0, 1));

        const shot = (picker: ReturnType<typeof createPickerController>, header: string) =>
          snap(
            <div style="position:relative;height:380px">
              <ListPicker
                picker={picker}
                header={header}
                selectedCount={2}
                onPick={noop}
                onCancel={noop}
                onCreateList={noop}
              />
            </div>,
          );
        const grid = [
          section("ready", await shot(ready, "Add 2 people to a List")),
          section("loading", await shot(loading, "Add @jane to a List")),
          section("empty", await shot(empty, "Add @jane to a List")),
          section("error", await shot(error, "Add @jane to a List")),
        ].join("");
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${grid}</div>`;
      },
    );

    await card(
      {
        group: "List-assign surfaces",
        name: "ActionBar",
        file: "assign-action-bar.html",
        minHeight: 340,
      },
      async () => {
        const base = {
          onAssign: noop,
          onClear: noop,
          onDone: noop,
          onStop: noop,
          onRemove: noop,
          onToggleReview: noop,
        };
        const selection = await snap(
          <div style="position:relative;height:120px">
            <ActionBar
              authors={AUTHORS}
              selectMode
              running={null}
              reviewOpen={false}
              hintKeycaps={["⌥", "L"]}
              {...base}
            />
          </div>,
        );
        const running = await snap(
          <div style="position:relative;height:120px">
            <ActionBar
              authors={AUTHORS}
              selectMode={false}
              running={{ current: 2, total: 5, listName: "Builders" }}
              reviewOpen={false}
              hintKeycaps={null}
              {...base}
            />
          </div>,
        );
        return (
          section("Selection + onboarding hint", selection) + section("Run in flight", running)
        );
      },
    );

    await card(
      {
        group: "List-assign surfaces",
        name: "TweetOverlay",
        file: "assign-tweet-overlay.html",
      },
      async () => {
        const ghost = await snap(<TweetOverlay selected={false} visible onToggle={noop} />);
        const selected = await snap(<TweetOverlay selected visible onToggle={noop} />);
        const tip = await snap(
          <TweetOverlay selected visible onToggle={noop} tooltip="In Builders since June" />,
        );
        return `<div style="display:flex;gap:40px;padding:12px">${section("hover ghost", ghost)}${section("selected", selected)}${section("tooltip", tip)}</div>`;
      },
    );

    await card(
      {
        group: "List-assign surfaces",
        name: "WelcomeCard",
        file: "assign-welcome-card.html",
        minHeight: 460,
      },
      () => snap(<WelcomeCard onTrySelectMode={noop} onSkip={noop} />),
    );

    await card(
      {
        group: "List-assign surfaces",
        name: "ShortcutsSheet",
        file: "assign-shortcuts-sheet.html",
        minHeight: 560,
      },
      () => snap(<ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="mac" onClose={noop} />),
    );

    /* Extension pages */
    await card(
      {
        group: "Extension pages",
        name: "Popup — compact remote",
        file: "page-popup.html",
        minHeight: 480,
      },
      () =>
        snap(
          <div style="max-width:320px" class="bg-background border-border rounded-xl border">
            <PopupApp
              queryState={async () => "active"}
              wake={async () => {}}
              openOptions={noop}
              filter={seededFilter()}
              settings={createSettings(fakeStorage())}
              mirrorStatus={async () => ({ ok: true, at: Date.now() - 3 * 60_000 })}
            />
          </div>,
          (r) => r.getByText("Active"),
        ),
    );

    /* ── proposed: popup Saved row (spec #41, ticket #74) ─────────────────
       A DESIGN MOCKUP, not a shipping component — ticket #74 requires this
       reviewed before the row's code lands. Composed from the real Switch
       primitive and the exact row classes the implementation will use, next to
       the popup's real "Only my languages" / "Hide filtered posts" rows so the
       reviewer sees it in place rather than in isolation. */
    await card(
      {
        group: "Extension pages",
        name: "Popup — Saved row (proposed, ticket #74)",
        file: "page-popup-saved-row.html",
        minHeight: 340,
      },
      async () => {
        const toggleRow = (label: string) => (
          <label class="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5">
            <span class="text-compact font-medium">{label}</span>
            <Switch label={label} checked={false} onChange={noop} />
          </label>
        );
        const savedRow = (empty: boolean) => (
          <button
            type="button"
            class="hover:bg-secondary/50 focus-visible:ring-ring/55 flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors outline-none focus-visible:ring-2"
          >
            <span class="text-compact font-medium">Saved</span>
            {empty ? (
              <span class="text-faint text-xs">No saved posts yet</span>
            ) : (
              <span class="flex flex-col items-end">
                <span class="text-compact font-semibold tabular-nums">128 posts</span>
                <span class="text-faint text-2xs">12 Folders</span>
              </span>
            )}
          </button>
        );
        const shell = (empty: boolean) =>
          snap(
            <div
              style="max-width:320px"
              class="bg-card text-card-foreground border-border divide-border flex flex-col gap-0 divide-y rounded-2xl border p-0 shadow-[var(--shadow-elevated)]"
            >
              {toggleRow("Only my languages")}
              {savedRow(empty)}
              {toggleRow("Hide filtered posts")}
            </div>,
          );
        return (
          section("Empty pile — no saves yet", await shell(true)) +
          section(
            "With saves — 128 saved posts across 12 Folders, click opens Options",
            await shell(false),
          )
        );
      },
    );

    await card(
      {
        group: "Extension pages",
        name: "Options — settings workshop",
        file: "page-options.html",
        wide: true,
        minHeight: 900,
      },
      async () => {
        const local = fakeStorage();
        await local.set({ [`lasso:lists`]: LISTS });
        return snap(
          <OptionsApp
            settings={createSettings(fakeStorage())}
            coach={createCoach(local)}
            local={local}
            sync={fakeStorage()}
            platform="mac"
            filter={seededFilter()}
          />,
          (r) => r.container.querySelector("h1"),
        );
      },
    );

    /* ── proposed: scope bindings (spec #31, ticket #34) ──────────────────
       A DESIGN MOCKUP, not a shipping component. Ticket #34 is the review gate
       that must clear before any of this lands as code (#36), so it composes the
       real Lariat primitives and the real compiled CSS here rather than adding a
       component under src/. The select reuses OptionsApp's SELECT class string
       verbatim, so the reviewed design is what implementation will produce. */
    {
      // OptionsApp's SELECT verbatim minus `w-full`, so each use sets its own
      // width — the row select must not crush the scope name beside it.
      const SELECT =
        "border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2";

      /** One bound scope: what it is, which preset it carries, and a way out. */
      const bindingRow = (name: string, key: string, preset: string, presets: string[]) =>
        `<li class="border-border flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm">
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="font-medium">${name}</span>
    <span class="text-faint text-compact font-mono">${key}</span>
  </span>
  <select aria-label="Preset for ${name}" class="${SELECT} w-44">
    ${presets.map((p) => `<option${p === preset ? " selected" : ""}>${p}</option>`).join("")}
  </select>
  <button class="border-border text-muted-foreground hover:bg-secondary h-8 shrink-0 rounded-lg border px-3 text-sm" aria-label="Unbind ${name}">Unbind</button>
</li>`;

      const PRESETS = ["Links only", "Media only", "Text only"];
      const intro = `<p class="text-muted-foreground text-compact mb-3">Give a timeline its own filter. Anything not listed here uses your shared filter.</p>`;

      await card(
        {
          group: "Filter surfaces",
          name: "Scope bindings — proposed (#31)",
          file: "filter-scope-bindings.html",
          minHeight: 460,
        },
        () =>
          `${intro}
<ul class="mb-5 flex flex-col gap-1.5">
  ${bindingRow("Home", "home", "Links only", PRESETS)}
  ${bindingRow("Tech News", "list:1583920441", "Media only", PRESETS)}
  ${bindingRow("@jack", "profile:jack", "Text only", PRESETS)}
</ul>
${section(
  "Bind another timeline",
  `<div class="flex flex-col gap-2">
  <div class="flex gap-2">
    <select aria-label="Choose a List to bind" class="${SELECT} w-full flex-1">
      <option>Choose one of your Lists…</option>
      <option>Tech News</option>
      <option>Photographers</option>
    </select>
    <button class="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 shrink-0 rounded-lg px-4 text-sm font-medium">Bind</button>
  </div>
  <div class="flex gap-2">
    <input aria-label="Profile handle to bind" placeholder="@handle" class="border-input bg-secondary text-foreground placeholder:text-faint h-9 flex-1 rounded-lg border px-3 text-sm outline-none" />
    <button class="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 shrink-0 rounded-lg px-4 text-sm font-medium">Bind</button>
  </div>
</div>`,
)}`,
      );

      await card(
        {
          group: "Filter surfaces",
          name: "Scope bindings — empty (#31)",
          file: "filter-scope-bindings-empty.html",
          minHeight: 260,
        },
        () =>
          `${intro}
<ul class="mb-5 flex flex-col gap-1.5">
  <li class="text-faint text-compact">No scope filters yet — every timeline uses your shared filter.</li>
</ul>
${section(
  "Bind a timeline",
  `<div class="flex gap-2">
  <select aria-label="Choose a List to bind" class="${SELECT} w-full flex-1">
    <option>Choose one of your Lists…</option>
    <option>Tech News</option>
  </select>
  <button class="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 shrink-0 rounded-lg px-4 text-sm font-medium">Bind</button>
</div>`,
)}`,
      );
    }

    /* ── proposed: Folders workshop (spec #41, ticket #72) ────────────────
       A DESIGN MOCKUP, not a shipping component — ticket #72 requires this
       reviewed before the section's code lands (house rule: design review
       before code). Composed from the real Button/Input/Badge primitives and
       OptionsApp's own SELECT string verbatim, so what gets reviewed is what
       implementation will produce. Folders are FLAT (ADR-0013 amendment):
       reorder moves a row within one list, never into another row. */
    {
      // OptionsApp's SELECT verbatim minus `w-full`, matching the scope-bindings
      // precedent above — the reviewed design is what implementation will produce.
      const SELECT =
        "border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2";

      const folderRow = (opts: {
        name: string;
        count: number;
        upDisabled?: boolean;
        downDisabled?: boolean;
      }) => (
        <li
          key={opts.name}
          class="border-border flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
        >
          <span class="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              class="h-5 px-1.5 text-xs leading-none"
              aria-label={`Move ${opts.name} up`}
              disabled={opts.upDisabled}
            >
              ▲
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-5 px-1.5 text-xs leading-none"
              aria-label={`Move ${opts.name} down`}
              disabled={opts.downDisabled}
            >
              ▼
            </Button>
          </span>
          <Input aria-label={`Rename ${opts.name}`} value={opts.name} class="max-w-[220px]" />
          <span class="text-faint text-compact ml-auto tabular-nums">{opts.count} posts</span>
          <Button variant="outline" size="sm" aria-label={`Delete ${opts.name}`}>
            Delete
          </Button>
        </li>
      );

      const defaultFolderSelect = (folders: string[], value: string) => (
        <select aria-label="Default Folder" class={SELECT} value={value}>
          <option value="">None — always ask</option>
          {folders.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      );

      await card(
        {
          group: "Extension pages",
          name: "Folders workshop — populated (proposed, #72)",
          file: "page-options-folders.html",
          minHeight: 520,
        },
        async () =>
          snap(
            <div class="flex max-w-[560px] flex-col gap-4">
              <div class="flex gap-2">
                <Input aria-label="New Folder name" placeholder="New Folder…" />
                <Button variant="secondary">Create</Button>
              </div>
              <ul class="flex flex-col gap-1.5">
                {[
                  folderRow({ name: "Research", count: 42, upDisabled: true }),
                  folderRow({ name: "Design refs", count: 128 }),
                  folderRow({ name: "Saved", count: 7, downDisabled: true }),
                ]}
              </ul>
              <div class="text-muted-foreground text-compact flex items-center justify-between border-t pt-3">
                <span>174 saved posts total, across 3 Folders</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-faint text-2xs font-semibold tracking-wide uppercase">
                  Default Folder
                </span>
                {defaultFolderSelect(["Research", "Design refs", "Saved"], "Saved")}
                <p class="text-muted-foreground text-compact">
                  Alt+Shift+B files straight into this Folder.
                </p>
              </div>
            </div>,
            (r) => r.getByText("Create"),
          ),
      );

      await card(
        {
          group: "Extension pages",
          name: "Folders workshop — empty (proposed, #72)",
          file: "page-options-folders-empty.html",
          minHeight: 260,
        },
        async () =>
          snap(
            <div class="flex max-w-[560px] flex-col gap-4">
              <div class="flex gap-2">
                <Input aria-label="New Folder name" placeholder="New Folder…" />
                <Button variant="secondary">Create</Button>
              </div>
              <p class="text-muted-foreground text-compact border-border rounded-xl border border-dashed px-4 py-6 text-center">
                No Folders yet — create one above to start filing posts.
              </p>
            </div>,
            (r) => r.getByText("Create"),
          ),
      );

      await card(
        {
          group: "Extension pages",
          name: "Folders workshop — create at cap (proposed, #72)",
          file: "page-options-folders-cap.html",
          minHeight: 160,
        },
        async () =>
          snap(
            <div class="flex max-w-[560px] flex-col gap-1.5">
              <div class="flex gap-2">
                <Input aria-label="New Folder name" placeholder="New Folder…" disabled />
                <Button variant="secondary" disabled>
                  Create
                </Button>
              </div>
              <p class="text-muted-foreground text-compact">
                You can have at most 200 Folders — delete one to make room.
              </p>
            </div>,
            (r) => r.getByText("Create"),
          ),
      );

      await card(
        {
          group: "Extension pages",
          name: "Folders workshop — failed read (proposed, #72)",
          file: "page-options-folders-error.html",
          minHeight: 160,
        },
        async () =>
          snap(
            <div class="flex max-w-[560px] flex-col gap-3">
              <p role="alert" class="text-destructive text-sm">
                Could not load Folders.
              </p>
              <div>
                <Button variant="outline" size="pill">
                  Retry
                </Button>
              </div>
            </div>,
            (r) => r.getByText("Retry"),
          ),
      );

      await card(
        {
          group: "Extension pages",
          name: "Folders workshop — delete confirmation (proposed, #72)",
          file: "page-options-folders-delete.html",
          minHeight: 260,
        },
        async () =>
          snap(
            <div class="max-w-[560px]">
              <div class="border-destructive/30 bg-destructive/5 flex flex-col gap-3 rounded-xl border p-4">
                <span class="text-compact font-medium">
                  Delete "Design refs"? It holds 128 posts, 12 of which another Folder also holds.
                </span>
                <div class="flex flex-wrap gap-2">
                  <Button variant="destructive" size="pill">
                    Keep the 128 posts
                  </Button>
                  <Button variant="destructive" size="pill">
                    Delete the 116 posts only this Folder holds
                  </Button>
                  <Button variant="ghost" size="pill">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>,
            (r) => r.getByText("Cancel"),
          ),
      );
    }

    console.log(`cards written: ${made.length}\n${made.join("\n")}`);
    if (failures.length) console.log(`FAILED:\n${failures.join("\n")}`);
    expect(failures).toEqual([]);
  }, 30_000);
  /* oxlint-enable react/style-prop-object */
});
