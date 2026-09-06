import * as stylex from "@stylexjs/stylex";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, type KeyBinding } from "@/content/keyboard";
import { type Coach, createCoach } from "@/core/coach";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import { readCachedCatalog } from "@/core/list-cache";
import { requestLassoDataClear, type ClearDataResponse } from "@/core/protocol";
import { type BackendStrategy, createSettings, type SettingsStore } from "@/core/settings";
import { PRIVACY_LINE } from "@/core/strings";
import { LinkRulesEditor, MyLanguagesEditor } from "@/options/FilterOptions";
import { createFoldersClient, type FoldersClient } from "@/options/folders-client";
import { FoldersOptions } from "@/options/FoldersOptions";
import { PresetManager, SurfaceOptions } from "@/options/SurfaceOptions";
import { useSettingsDraft } from "@/options/use-settings-draft";
import { defaultMembershipStoreProbe } from "@/packages/membership-store/factory";
import type { MembershipStoreProbe, OwnerCatalog } from "@/packages/membership-store/types";
import { breakpoints } from "@/ui/breakpoints.stylex";
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
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

/** Story beat 9: the promised backend disclosure, verbatim. */
export const ACTIVATION_COPY = {
  auto: "On every visit (default)",
  "on-demand": "Only when I use the toolbar or press c",
} as const;

export const BACKEND_COPY: Record<BackendStrategy, string> = {
  dom: "Drive X's own English menus — slow; requires a currently visible post and uses only what you could click yourself",
  rest: "X's web REST endpoints — fast, same calls X's site makes; not the developer API",
  graphql:
    "GraphQL — fastest; uses private endpoints and reads operation IDs from X's page bundles. May break or conflict with X policy. Opt in deliberately.",
};

export const DEFAULT_LIST_NONE = "None — always ask";
export const DEFAULT_LIST_HINT = "Alt+Shift+L adds straight to this List.";

/** Names everything Privacy Clear destroys, so the on-screen promise matches it. */
export const CLEAR_CONFIRMATION =
  "Clear browser settings, cached Lists, coach state, Folders, and Saved Posts? Mirror data stays in Convex.";

export const CONVEX_URL_ERROR = "Enter an https://*.convex.cloud deployment URL.";
export const CONVEX_TEST_ERROR = "Connection failed. Check the URL and device key.";
const CONVEX_URL_ERROR_ID = "convex-url-error";

/**
 * A deployment URL allowed by the extension manifest and CSP. Validation here
 * prevents storing a value the runtime cannot reach.
 */
export function isValidConvexUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".convex.cloud");
  } catch {
    return false;
  }
}

export const RAIL = [
  { label: "General", target: "activation" },
  { label: "Connection", target: "connection" },
  { label: "Lists", target: "lists" },
  { label: "Folders", target: "folders" },
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
  catalogReader?: () => Promise<OwnerCatalog[]>;
  clearData?: () => Promise<ClearDataResponse>;
  keymap?: KeyBinding[];
  platform?: Platform;
  filter?: FilterStore;
  foldersClient?: FoldersClient;
  mirrorProbe?: MembershipStoreProbe;
}

/**
 * The real options page (story beat 9): a two-pane settings app — a sticky nav
 * rail beside content cards. Every setting that once lived only in
 * chrome.storage gets a surface, the strongest trust facts move into
 * user-facing copy, and the data Lasso keeps is named and wipeable.
 */

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 },
});

const styles = stylex.create({
  layoutLoading: {
    marginInline: "auto",
    display: "flex",
    width: "100%",
    maxWidth: "920px",
    gap: "2rem",
    paddingInline: "1.5rem",
    paddingBlock: "2.5rem",
    boxSizing: "border-box",
  },
  layoutError: {
    marginInline: "auto",
    display: "flex",
    width: "100%",
    maxWidth: "920px",
    flexDirection: "column",
    gap: "0.75rem",
    paddingInline: "1.5rem",
    paddingBlock: "2.5rem",
    boxSizing: "border-box",
  },
  aside: {
    display: {
      default: "none",
      [breakpoints.md]: "block",
    },
    width: "196px",
    flexShrink: 0,
  },
  asideSkeleton: {
    backgroundColor: tokens.secondary,
    height: "11rem",
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusXl,
  },
  mainContent: {
    display: "flex",
    minWidth: 0,
    flex: 1,
    flexDirection: "column",
    gap: "1.25rem",
  },
  mainSkeletonH16: {
    backgroundColor: tokens.secondary,
    height: "4rem",
    width: "50%",
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusXl,
  },
  mainSkeletonH48: {
    backgroundColor: tokens.secondary,
    height: "12rem",
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusXl,
  },
  mainSkeletonH72: {
    backgroundColor: tokens.secondary,
    height: "18rem",
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusXl,
  },
  stickyNav: {
    position: "sticky",
    top: "2.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  brandHeader: {
    marginBottom: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    paddingInline: "0.75rem",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
  },
  brandMark: {
    color: tokens.primary,
  },
  brandTitle: {
    fontSize: "17px",
    fontWeight: "700",
    letterSpacing: "-0.025em",
  },
  brandSubtitle: {
    color: tokens.faint,
    fontSize: tokens.textXs,
    fontWeight: "500",
  },
  navCol: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  localFirstBadgeWrap: {
    marginTop: "1rem",
    paddingInline: "0.75rem",
  },
  headerCol: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  pageTitle: {
    fontSize: "24px",
    fontWeight: "700",
    letterSpacing: "-0.025em",
    margin: 0,
  },
  pageSubtitle: {
    color: tokens.mutedForeground,
    fontSize: tokens.textSm,
    margin: 0,
  },
  errorTextSm: {
    color: tokens.destructive,
    fontSize: tokens.textSm,
    margin: 0,
  },
  errorTextXs: {
    color: tokens.destructive,
    fontSize: tokens.textXs,
    margin: 0,
  },
  errorTextCompact: {
    color: tokens.destructive,
    fontSize: tokens.textCompact,
    margin: 0,
  },
  colGap2: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  colGap3: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  colGap1: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  colGap1_5: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
  },
  rowBetween: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  rowBetweenTextSm: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: tokens.textSm,
  },
  rowBetweenMb3: {
    marginBottom: "0.75rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: tokens.textSm,
  },
  rowBetweenTextMd: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: tokens.textMd,
  },
  rowBetweenMb4TextMd: {
    marginBottom: "1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: tokens.textMd,
  },
  rowGap3Mt3: {
    marginTop: "0.75rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  tableRow: {
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: "oklch(from " + tokens.border + " l c h / 0.6)",
  },
  tableHeaderCell: {
    paddingBlock: "0.5rem",
    textAlign: "left",
    fontSize: tokens.textSm,
    fontWeight: "400",
  },
  tableCell: {
    paddingBlock: "0.5rem",
    textAlign: "right",
  },
  kbdMl1: {
    marginLeft: "0.25rem",
  },
  faintCompactMt3: {
    color: tokens.faint,
    fontSize: tokens.textCompact,
    marginTop: "0.75rem",
    marginInline: 0,
    marginBottom: 0,
  },
  faintCompactMt1: {
    color: tokens.faint,
    fontSize: tokens.textCompact,
    marginTop: "0.25rem",
    marginInline: 0,
    marginBottom: 0,
  },
  faintCompactMt2: {
    color: tokens.faint,
    fontSize: tokens.textCompact,
    marginTop: "0.5rem",
    marginInline: 0,
    marginBottom: 0,
  },
  faintXs: {
    color: tokens.faint,
    fontSize: tokens.textXs,
    margin: 0,
  },
  faintXsBlockMt0_5: {
    color: tokens.faint,
    marginTop: "0.125rem",
    display: "block",
    fontSize: tokens.textXs,
  },
  subMt5: {
    marginTop: "1.25rem",
  },
  mirrorGrid: {
    display: "flex",
    flexDirection: {
      default: "column",
      [breakpoints.sm]: "row",
    },
    gap: "0.75rem",
  },
  flex1Col1_5: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: "0.375rem",
  },
  sectionLabel: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
    fontWeight: "600",
    letterSpacing: "0.025em",
    textTransform: "uppercase",
  },
  statusConnected: {
    color: tokens.success,
    fontWeight: "500",
  },
  statusSuccessBlock: {
    color: tokens.success,
    marginTop: "0.5rem",
    display: "block",
    fontSize: tokens.textXs,
    fontWeight: "500",
  },
  textSm: {
    fontSize: tokens.textSm,
    margin: 0,
  },
  textXs: {
    fontSize: tokens.textXs,
  },
  clearDangerBox: {
    borderColor: "rgba(239, 68, 68, 0.3)",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    marginTop: "1rem",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
    borderRadius: tokens.radiusXl,
    borderWidth: "1px",
    borderStyle: "solid",
    padding: "1rem",
  },
  textCompactMedium: {
    fontSize: tokens.textCompact,
    fontWeight: "500",
  },
  mutedCompact: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    margin: 0,
  },
  mutedCompactMt2: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    marginTop: "0.5rem",
    marginInline: 0,
    marginBottom: 0,
  },
  railButton: {
    fontSize: tokens.textCompact,
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
    borderRadius: tokens.radiusLg,
    paddingInline: "0.75rem",
    paddingBlock: "0.5rem",
    textAlign: "left",
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    outline: "none",
    border: "none",
    cursor: "pointer",
  },
  railButtonActive: {
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    fontWeight: "600",
  },
  railButtonInactive: {
    color: tokens.mutedForeground,
    backgroundColor: {
      default: "transparent",
      ":hover": "oklch(from " + tokens.secondary + " l c h / 0.6)",
    },
    ":hover": {
      color: tokens.foreground,
    },
  },
  railDot: {
    height: "0.375rem",
    width: "0.375rem",
    borderRadius: tokens.radiusFull,
  },
  railDotActive: {
    backgroundColor: tokens.primary,
  },
  railDotInactive: {
    backgroundColor: tokens.faint,
  },
  cardScrollMt: {
    scrollMarginTop: "2.5rem",
  },
  subContainer: {
    marginBottom: "0.5rem",
  },
  subHeading: {
    marginBottom: "0.25rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    margin: 0,
  },
  select: {
    borderColor: tokens.input,
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    height: "2.25rem",
    width: "100%",
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
      boxShadow: "0 0 0 2px oklch(from " + tokens.ring + " l c h / 0.4)",
    },
  },
});

export function OptionsApp({
  settings: settingsProp,
  coach: coachProp,
  catalogReader: catalogReaderProp,
  clearData: clearDataProp,
  keymap = DEFAULT_KEYMAP,
  platform = detectPlatform(),
  filter: filterProp,
  mirrorProbe = defaultMembershipStoreProbe,
  foldersClient: foldersClientProp,
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
  const catalogReader = useMemo(() => catalogReaderProp ?? readCachedCatalog, [catalogReaderProp]);
  const clearData = clearDataProp ?? requestLassoDataClear;
  const foldersClient = useMemo(
    () => foldersClientProp ?? createFoldersClient(),
    [foldersClientProp],
  );

  const [mirrorDraft, setMirrorDraft] = useState({ url: "", deviceKey: "" });
  const [lists, setLists] = useState<
    Array<{ id: string; name: string; owner: string; ownerUserId: string }>
  >([]);
  const [cleared, setCleared] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [urlError, setUrlError] = useState(false);
  const [syncSaved, setSyncSaved] = useState(false);
  const [mirrorTest, setMirrorTest] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [activeRail, setActiveRail] = useState<string>(RAIL[0].target);
  const mounted = useRef(false);
  const catalogRevision = useRef(0);
  const filterState = useSignalValue(filter.state);
  const { current, latest, loadError, saveError, retry, patch, beginClear } =
    useSettingsDraft(settings);
  const presentedSettings = useRef<typeof current>(null);
  const presentedMirrorDraft = useRef(mirrorDraft);
  presentedSettings.current = current;
  presentedMirrorDraft.current = mirrorDraft;
  const loaded = current !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!latest) return;
    setMirrorDraft({
      url: latest.convexUrl ?? "",
      deviceKey: latest.convexDeviceKey ?? "",
    });
  }, [latest]);

  useEffect(() => {
    let active = true;
    const readRevision = catalogRevision.current;
    void filter.load();
    void catalogReader()
      .then((catalog) => {
        if (!active || !mounted.current || catalogRevision.current !== readRevision) return;
        setLists(
          catalog.flatMap(({ owner, lists: ownerLists }) =>
            ownerLists.map((list) => ({
              ...list,
              owner: owner.screenName,
              ownerUserId: owner.userId,
            })),
          ),
        );
      })
      .catch(() => {
        if (active && mounted.current && catalogRevision.current === readRevision) setLists([]);
      });
    return () => {
      active = false;
    };
  }, [catalogReader, filter, filterProp]);

  useEffect(() => {
    if (filterProp) return;
    return () => filter.dispose();
  }, [filter, filterProp]);

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

  if (!current && loadError) {
    return (
      <main {...stylex.props(styles.layoutError)}>
        <p role="alert" {...stylex.props(styles.errorTextSm)}>
          Could not load settings.
        </p>
        <div>
          <Button variant="outline" size="pill" onClick={retry}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (!current) {
    return (
      <div data-loading="" {...stylex.props(styles.layoutLoading)}>
        <aside {...stylex.props(styles.aside)}>
          <div {...stylex.props(styles.asideSkeleton)} />
        </aside>
        <main {...stylex.props(styles.mainContent)}>
          <div {...stylex.props(styles.mainSkeletonH16)} />
          <div {...stylex.props(styles.mainSkeletonH48)} />
          <div {...stylex.props(styles.mainSkeletonH72)} />
        </main>
      </div>
    );
  }

  const patchSync = (p: Parameters<typeof patch>[0]) => {
    patch(p, () => {
      setSyncSaved(true);
      setMirrorTest("idle");
    });
  };

  const probeMirror = async (): Promise<void> => {
    const config = { url: mirrorDraft.url.trim(), deviceKey: mirrorDraft.deviceKey.trim() };
    if (
      !isValidConvexUrl(config.url) ||
      !config.deviceKey ||
      current.convexUrl !== config.url ||
      current.convexDeviceKey !== config.deviceKey
    ) {
      return;
    }
    const isCurrentConfig = () => {
      const presented = presentedSettings.current;
      const draft = presentedMirrorDraft.current;
      return (
        presented?.convexUrl === config.url &&
        presented.convexDeviceKey === config.deviceKey &&
        draft.url.trim() === config.url &&
        draft.deviceKey.trim() === config.deviceKey
      );
    };
    setMirrorTest("testing");
    try {
      await mirrorProbe.probe(config);
      if (mounted.current && isCurrentConfig()) {
        setMirrorTest("connected");
      }
    } catch {
      if (mounted.current && isCurrentConfig()) {
        setMirrorTest("failed");
      }
    }
  };

  return (
    <div {...stylex.props(styles.layoutLoading)}>
      <aside {...stylex.props(styles.aside)}>
        <div {...stylex.props(styles.stickyNav)}>
          <div {...stylex.props(styles.brandHeader)}>
            <div {...stylex.props(styles.brandRow)}>
              <LassoMark size={22} sx={styles.brandMark} />
              <span {...stylex.props(styles.brandTitle)}>Lasso</span>
            </div>
            <span {...stylex.props(styles.brandSubtitle)}>Settings</span>
          </div>
          <nav aria-label="Settings sections" {...stylex.props(styles.colGap1)}>
            {RAIL.map((item) => (
              <RailItem
                key={item.target}
                label={item.label}
                target={item.target}
                active={item.target === activeRail}
                onActivate={() => setActiveRail(item.target)}
              />
            ))}
          </nav>
          <div {...stylex.props(styles.localFirstBadgeWrap)}>
            <Badge variant="success">Local-first</Badge>
          </div>
        </div>
      </aside>

      <main {...stylex.props(styles.mainContent)}>
        <header {...stylex.props(styles.colGap1)}>
          <h1 {...stylex.props(styles.pageTitle)}>Settings</h1>
          <p {...stylex.props(styles.pageSubtitle)}>How and when Lasso runs on x.com.</p>
        </header>
        {saveError && (
          <p role="alert" {...stylex.props(styles.errorTextSm)}>
            Could not save settings. Try again.
          </p>
        )}

        <Section title="Activation" id="activation">
          <div
            role="radiogroup"
            aria-labelledby="activation-title"
            {...stylex.props(styles.colGap2)}
          >
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
          <div
            role="radiogroup"
            aria-labelledby="connection-title"
            {...stylex.props(styles.colGap2)}
          >
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
            value={
              current.defaultList
                ? `${current.defaultList.ownerUserId}:${current.defaultList.listId}`
                : ""
            }
            onChange={(e) => {
              const value = (e.currentTarget as HTMLSelectElement).value;
              const separator = value.indexOf(":");
              patch({
                defaultList:
                  separator < 0
                    ? undefined
                    : {
                        ownerUserId: value.slice(0, separator),
                        listId: value.slice(separator + 1),
                      },
                ...(separator < 0 ? { defaultListId: undefined } : {}),
              });
            }}
            {...stylex.props(styles.select)}
          >
            <option value="">{DEFAULT_LIST_NONE}</option>
            {lists.map((l) => (
              <option key={`${l.ownerUserId}:${l.id}`} value={`${l.ownerUserId}:${l.id}`}>
                {l.name} (@{l.owner})
              </option>
            ))}
          </select>
          {current.defaultList && (
            <p {...stylex.props(styles.mutedCompactMt2)}>{DEFAULT_LIST_HINT}</p>
          )}
          {lists.length === 0 && (
            <p {...stylex.props(styles.mutedCompactMt2)}>
              Open x.com once so Lasso can see your Lists.
            </p>
          )}
        </Section>

        <Section
          title="Folders"
          id="folders"
          helper="Free-form collections you own — no X account needed. File a post with Alt+Shift+B."
        >
          <FoldersOptions
            client={foldersClient}
            defaultFolderId={current.defaultFolderId}
            onPatchDefault={(defaultFolderId) => patch({ defaultFolderId })}
          />
        </Section>

        <Section title="Keyboard shortcuts" id="shortcuts">
          <table {...stylex.props(styles.table)}>
            <caption {...stylex.props(styles.srOnly)}>
              Keyboard shortcuts available on x.com
            </caption>
            <tbody>
              {keymap.map((binding) => (
                <tr key={binding.combo} {...stylex.props(styles.tableRow)}>
                  <th scope="row" {...stylex.props(styles.tableHeaderCell)}>
                    {COMMAND_LABELS[binding.command]}
                  </th>
                  <td {...stylex.props(styles.tableCell)}>
                    {keycaps(binding.combo, platform).map((cap) => (
                      <Kbd key={cap} sx={styles.kbdMl1}>
                        {cap}
                      </Kbd>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p {...stylex.props(styles.faintCompactMt3)}>Press ? on x.com anytime.</p>
        </Section>

        <Section
          title="Timeline filter"
          id="filter"
          helper="Narrow Home and List timelines by content type. The chips, the language gate, and link categories all live here — and sync to the funnel pill on x.com and the toolbar popup."
        >
          <div {...stylex.props(styles.rowBetweenMb4TextMd)}>
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
          <div {...stylex.props(styles.colGap3)}>
            <CriteriaMatrix store={filter} />
            {!filterState.enabled && (
              <p {...stylex.props(styles.faintXs)}>
                The filter is off — these chips apply once you turn it on above.
              </p>
            )}
          </div>

          <Sub heading="My languages" sx={styles.subMt5}>
            When “only my languages” is on, posts outside this allowlist are hidden.
          </Sub>
          <div {...stylex.props(styles.rowBetweenMb3)}>
            Only my languages
            <Switch
              label="Only my languages"
              checked={filterState.onlyMyLanguages}
              onChange={(on) => filter.setOnlyMyLanguages(on)}
            />
          </div>
          <MyLanguagesEditor store={filter} />

          <Sub heading="Link rules" sx={styles.subMt5}>
            Map a host to a category; your rules win over the built-ins. Anything unmatched is
            Article/Blog.
          </Sub>
          <LinkRulesEditor store={filter} />

          <Sub heading="Display" sx={styles.subMt5}>
            How filtered posts leave the timeline.
          </Sub>
          <div {...stylex.props(styles.rowBetweenTextSm)}>
            <span>
              Hide filtered posts completely
              <span {...stylex.props(styles.faintXsBlockMt0_5)}>
                Collapse rows to nothing — off keeps the slim placeholders.
              </span>
            </span>
            <Switch
              label="Hide filtered posts completely"
              checked={filterState.compactHidden}
              onChange={(on) => filter.setCompactHidden(on)}
            />
          </div>

          <Sub heading="Presets" sx={styles.subMt5}>
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
          <SurfaceOptions settings={current} onPatch={patch} />
        </Section>

        <Section
          title="Sync across Chrome installations"
          id="sync"
          badge="Optional Convex sync"
          helper="Use the same deployment URL and device key in another Chrome installation to replicate your account-free Folders and Saved Posts. The same personal connection also enables the optional Owner/List Mirror. Anyone with that pair can access the same personal collection; leave either blank for local-only Folders."
        >
          <div {...stylex.props(styles.mirrorGrid)}>
            <div {...stylex.props(styles.flex1Col1_5)}>
              <span {...stylex.props(styles.sectionLabel)}>Deployment URL</span>
              <Input
                type="url"
                aria-label="Convex deployment URL"
                aria-describedby={urlError ? CONVEX_URL_ERROR_ID : undefined}
                aria-invalid={urlError ? "true" : undefined}
                placeholder="https://your-app.convex.cloud"
                value={mirrorDraft.url}
                onChange={(e) => {
                  const value = (e.currentTarget as HTMLInputElement).value;
                  setMirrorDraft((draft) => ({ ...draft, url: value }));
                  setMirrorTest("idle");
                  const raw = value.trim();
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
              {urlError && (
                <span id={CONVEX_URL_ERROR_ID} role="alert" {...stylex.props(styles.errorTextXs)}>
                  {CONVEX_URL_ERROR}
                </span>
              )}
            </div>
            <div {...stylex.props(styles.flex1Col1_5)}>
              <span {...stylex.props(styles.sectionLabel)}>Device key</span>
              <Input
                type="password"
                aria-label="Convex device key"
                autocomplete="off"
                placeholder="matches LASSO_DEVICE_KEY"
                value={mirrorDraft.deviceKey}
                onChange={(e) => {
                  const value = (e.currentTarget as HTMLInputElement).value;
                  setMirrorDraft((draft) => ({ ...draft, deviceKey: value }));
                  setMirrorTest("idle");
                  patchSync({ convexDeviceKey: value.trim() || undefined });
                }}
              />
            </div>
          </div>
          <div {...stylex.props(styles.rowGap3Mt3)}>
            <Button
              variant="secondary"
              size="pill"
              disabled={
                mirrorTest === "testing" ||
                !isValidConvexUrl(mirrorDraft.url.trim()) ||
                !mirrorDraft.deviceKey.trim() ||
                current.convexUrl !== mirrorDraft.url.trim() ||
                current.convexDeviceKey !== mirrorDraft.deviceKey.trim()
              }
              onClick={() => void probeMirror()}
            >
              {mirrorTest === "testing" ? "Testing…" : "Test connection"}
            </Button>
            <span aria-live="polite" {...stylex.props(styles.textXs)}>
              {mirrorTest === "connected" && (
                <span {...stylex.props(styles.statusConnected)}>Connected</span>
              )}
              {mirrorTest === "failed" && (
                <span {...stylex.props(styles.errorTextSm)}>{CONVEX_TEST_ERROR}</span>
              )}
            </span>
          </div>
          {syncSaved && (
            <span aria-live="polite" {...stylex.props(styles.statusSuccessBlock)}>
              Saved
            </span>
          )}
        </Section>

        <Section title="Accessibility" id="access">
          <div {...stylex.props(styles.rowBetweenTextMd)}>
            Higher-contrast buttons
            <Switch
              label="Higher-contrast buttons"
              checked={current.highContrast}
              onChange={(on) => patch({ highContrast: on })}
            />
          </div>
          <p {...stylex.props(styles.faintCompactMt1)}>
            AA-safe deeper amber on the accent controls.
          </p>
        </Section>

        <Section title="Privacy & data" id="privacy">
          <p {...stylex.props(styles.textSm)}>{PRIVACY_LINE}</p>
          <div {...stylex.props(styles.clearDangerBox)}>
            {confirmClear ? (
              <>
                <span {...stylex.props(styles.textCompactMedium)}>{CLEAR_CONFIRMATION}</span>
                <Button
                  variant="destructive"
                  size="pill"
                  onClick={() => {
                    const clear = beginClear();
                    catalogRevision.current += 1;
                    void clearData()
                      .then(({ localCleared, syncCleared }) => {
                        if (!mounted.current) return;
                        if (!localCleared || !syncCleared) {
                          clear.abort();
                          setClearFailed(true);
                          return;
                        }
                        if (!clear.finish()) {
                          setClearFailed(true);
                          return;
                        }
                        setConfirmClear(false);
                        setClearFailed(false);
                        setCleared(true);
                        setUrlError(false);
                        setMirrorTest("idle");
                        setLists([]);
                      })
                      .catch(() => {
                        clear.abort();
                        if (mounted.current) setClearFailed(true);
                      });
                  }}
                >
                  Yes, clear it
                </Button>
                <Button variant="ghost" size="pill" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                size="pill"
                onClick={() => {
                  setClearFailed(false);
                  setConfirmClear(true);
                }}
              >
                Clear Lasso data
              </Button>
            )}
            {cleared && !confirmClear && (
              <span {...stylex.props(styles.mutedCompact)}>Cleared</span>
            )}
            {clearFailed && (
              <span aria-live="polite" {...stylex.props(styles.errorTextCompact)}>
                Could not clear all data. Try again.
              </span>
            )}
            <Button
              variant="outline"
              size="pill"
              onClick={() =>
                void coach
                  .replayIntro()
                  .then(() => {
                    if (mounted.current) setReplayed(true);
                  })
                  .catch(() => {})
              }
            >
              Replay intro
            </Button>
            {replayed && (
              <span {...stylex.props(styles.mutedCompact)}>On your next visit to x.com</span>
            )}
          </div>
          <p {...stylex.props(styles.faintCompactMt2)}>
            Clears browser data only. It does not delete data already in your Convex deployment.
          </p>
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
      {...stylex.props(
        styles.railButton,
        active ? styles.railButtonActive : styles.railButtonInactive,
      )}
    >
      <span
        {...stylex.props(styles.railDot, active ? styles.railDotActive : styles.railDotInactive)}
      />
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
    <Card id={id} sx={styles.cardScrollMt}>
      <CardHeader>
        <div {...stylex.props(styles.rowBetween)}>
          <CardTitle id={id ? `${id}-title` : undefined}>{title}</CardTitle>
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
  sx,
  children,
}: {
  heading: string;
  class?: string;
  sx?: stylex.StyleXStyles;
  children: ComponentChildren;
}) {
  return (
    <div {...stylex.props(styles.subContainer, sx)}>
      <h3 {...stylex.props(styles.subHeading)}>{heading}</h3>
      <p {...stylex.props(styles.mutedCompact)}>{children}</p>
    </div>
  );
}
