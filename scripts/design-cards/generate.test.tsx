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

import { fireEvent, render, waitFor } from "@testing-library/preact";
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
import { XApiError, type XList } from "@/core/x-client/types";
import { OptionsApp } from "@/options/OptionsApp";
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

  const rootDecls = (text: string): string[] =>
    [...text.matchAll(/:root(?:\s*,\s*:host)?\{([^{}]*)\}/g)].map((m) => m[1] ?? "");

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
        const closed = await snap(
          <FunnelPill
            store={seededFilter()}
            hiddenCount={() => 7}
            position={{ x: 16, y: 16 }}
            onPositionChange={noop}
          />,
        );
        const r = render(
          <FunnelPill
            store={seededFilter()}
            hiddenCount={() => 7}
            position={{ x: 16, y: 90 }}
            onPositionChange={noop}
          />,
        );
        fireEvent.click(r.getByRole("button", { name: "Timeline filter" }));
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
        const ready = createPickerController({ cache: fakeCache({ cached: LISTS }) });
        await ready.open(AUTHORS.slice(0, 2));
        const loading = createPickerController({
          cache: fakeCache({ cached: null, fresh: () => new Promise<XList[]>(() => {}) }),
        });
        void loading.open(AUTHORS.slice(0, 1));
        const empty = createPickerController({ cache: fakeCache({ cached: null }) });
        await empty.open(AUTHORS.slice(0, 1));
        const error = createPickerController({
          cache: fakeCache({
            cached: null,
            fresh: async () => {
              throw new XApiError("auth", "401");
            },
          }),
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

    console.log(`cards written: ${made.length}\n${made.join("\n")}`);
    if (failures.length) console.log(`FAILED:\n${failures.join("\n")}`);
    expect(failures).toEqual([]);
  }, 30_000);
});
