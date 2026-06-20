/*
 * Live-DOM verify-by-effect for the filter surfaces (docs/plans task-018).
 *
 * HOW TO RUN:
 *   1. `bun run build`, load the unpacked `dist/` in a Chromium profile signed into X.
 *   2. Open https://x.com/home (or an /i/lists/* timeline) with a populated feed.
 *   3. Open DevTools → Console, paste this whole file, press Enter.
 *   4. Read the printed table. Then do the manual preset+reload step it prompts for.
 *
 * It drives the REAL pill/panel (open Shadow DOM is reachable from the page) and
 * asserts each scenario "Then" by observed DOM effect — not by assumption.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cells = () => document.querySelectorAll('div[data-testid="cellInnerDiv"]').length;
const hidden = () => document.querySelectorAll("[data-lasso-filtered]").length;
const stubs = () => document.querySelectorAll("[data-lasso-filter-stub]").length;

(async () => {
  const log = [];
  const add = (check, pass, detail = "") =>
    log.push({ check, result: pass === null ? "INFO" : pass ? "PASS" : "FAIL", detail });

  const host = document.getElementById("lasso-filter-surfaces");
  const sr = host && host.shadowRoot;
  if (!sr) {
    console.error(
      "[live-verify] filter surface not found. Is the unpacked dist/ loaded, and are you on x.com/home with the funnel pill enabled?",
    );
    return;
  }

  const dialog = () => sr.querySelector('[role="dialog"][aria-label="Timeline filter"]');
  const btnByText = (re) => {
    const d = dialog();
    return d && [...d.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));
  };

  // 1. Pill present + position (overlap is an eyeball check — rect is reported).
  const pillBtn = sr.querySelector('button[aria-label="Timeline filter"]');
  add("funnel pill present", !!pillBtn);
  const r = pillBtn && pillBtn.getBoundingClientRect();
  add(
    "pill rect (eyeball vs compose/DM docks + ActionBar)",
    null,
    r
      ? `x:${Math.round(r.x)} y:${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`
      : "n/a",
  );

  if (pillBtn) pillBtn.click();
  await sleep(80);
  add("popover opens on pill click", !!dialog());
  if (!dialog()) {
    console.table(log);
    return;
  }

  add("baseline cells in DOM", null, String(cells()));

  // 2. Video -> only (one cycle from off). Non-video should collapse to stubs.
  const videoChip = dialog().querySelector('button[aria-label="Video"]');
  add("Video chip present", !!videoChip);
  if (videoChip) videoChip.click();
  await sleep(200);
  add(
    "non-video cells collapse to reversible stubs",
    hidden() > 0 && stubs() > 0,
    `hidden=${hidden()} stubs=${stubs()}`,
  );
  const vidCells = [...document.querySelectorAll('div[data-testid="cellInnerDiv"]')].filter((c) =>
    c.querySelector('[data-testid="videoPlayer"],[data-testid="videoComponent"]'),
  );
  const vidHidden = vidCells.filter((c) => c.hasAttribute("data-lasso-filtered")).length;
  add(
    "video posts stay visible",
    vidCells.length === 0 || vidHidden === 0,
    `videoCells=${vidCells.length} hidden=${vidHidden}${vidCells.length === 0 ? " (none in view — scroll to a video)" : ""}`,
  );
  // "video only" must mean originals AND reposts that contain video. A repost
  // renders the original's media inline + a socialContext label, so a
  // repost-of-a-video is itself a video cell — it must NOT be collapsed.
  const repostVidCells = vidCells.filter((c) => c.querySelector('[data-testid="socialContext"]'));
  const repostVidHidden = repostVidCells.filter((c) =>
    c.hasAttribute("data-lasso-filtered"),
  ).length;
  add(
    "reposts of videos stay visible (not just originals)",
    repostVidCells.length === 0 || repostVidHidden === 0,
    `repostVideoCells=${repostVidCells.length} hidden=${repostVidHidden}${repostVidCells.length === 0 ? " (none in view — scroll to a reposted video)" : ""}`,
  );

  // 2b. Compact mode (opt-in `compactHidden`, toggled in the EXTENSION POPUP — this
  // probe can't reach the popup, so it only reports state). With it ON, stubs must
  // collapse to 0 height. The over-fetch / scroll-jump risks (ADR-0010) are manual.
  const compactOn = document.documentElement.hasAttribute("data-lasso-compact");
  add(
    "compact mode (set in popup: 'Hide filtered posts completely')",
    null,
    compactOn ? "ON" : "off",
  );
  if (compactOn) {
    const stubEls = [...document.querySelectorAll("[data-lasso-filter-stub]")];
    const tall = stubEls.filter((s) => s.offsetHeight > 0).length;
    add(
      "compact: stubs collapse to 0 height",
      tall === 0,
      `stubs=${stubEls.length} withHeight=${tall}`,
    );
  }

  // 3. show all -> hide all (this session's change).
  const showAll = btnByText(/show all/i);
  add('"show all" present', !!showAll);
  if (showAll) showAll.click();
  await sleep(200);
  add('"show all" reveals every cell', hidden() === 0, `hidden=${hidden()}`);
  const hideAll = btnByText(/hide all/i);
  add('"hide all" present while revealed', !!hideAll);
  if (hideAll) hideAll.click();
  await sleep(200);
  add('"hide all" re-collapses cells', hidden() > 0, `hidden=${hidden()}`);

  // 4. master toggle OFF restores native feed; ON re-arms.
  const master = dialog().querySelector('input[aria-label="Timeline filter enabled"]');
  add("master toggle present", !!master);
  if (master) master.click();
  await sleep(200);
  add(
    "master OFF restores native feed",
    hidden() === 0 && stubs() === 0,
    `hidden=${hidden()} stubs=${stubs()}`,
  );
  if (master) master.click();
  await sleep(150);
  add("master ON re-applies the filter", hidden() > 0, `hidden=${hidden()}`);

  // cleanup: cycle Video only->hide->off so the feed is left as found.
  const v = dialog() && dialog().querySelector('button[aria-label="Video"]');
  if (v) {
    v.click();
    await sleep(60);
    v.click();
    await sleep(60);
  }
  add("left feed clean (Video back to off)", hidden() === 0, `hidden=${hidden()}`);

  console.table(log);
  const fails = log.filter((x) => x.result === "FAIL");
  console.log(
    fails.length
      ? `❌ ${fails.length} automated check(s) FAILED — see table`
      : "✅ all automated checks PASSED",
  );
  console.log(
    "MANUAL steps left: (1) set a chip, Save a preset, RELOAD x.com, re-open the pill → preset persists & re-applies, badge count correct. (2) For compact mode: enable 'Hide filtered posts completely' in the popup, then scroll several screens watching for over-fetch / scroll-jumps (ADR-0010 / verify-filter-virtualization-dom.md).",
  );
  return log;
})();
