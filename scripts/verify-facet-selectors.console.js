/*
 * Live-DOM verification of the AMBER FacetSelectors (src/content/selectors.ts).
 * Tracking record: docs/research/verify-filter-dom.md.
 *
 * WHY: tweet-read/facets.ts reads each Tweet's Facets through FacetSelectors that
 * are ASSUMPTIONS until confirmed on real x.com (MISSION.md: assumption ≠ proof).
 * happy-dom fixtures prove the LOGIC, never that the selectors match live posts.
 *
 * HOW TO RUN (no extension build needed):
 *   1. Open a logged-in https://x.com/home — or an /i/lists/* timeline, or a
 *      media-heavy profile — with a populated feed.
 *   2. DevTools → Console → paste this whole file → Enter.
 *   3. Read the table. SCROLL a few screens through mixed content (photos, native
 *      video, GIFs, quotes, link cards, reposts) and re-run to accumulate samples.
 *   4. Record the verdicts in docs/research/verify-filter-dom.md.
 *
 * IT DOES NOT trust the selector under test. For each facet it computes an
 * INDEPENDENT ground-truth (GT) from a different DOM fact, then asserts the
 * faithful facets.ts selector (SEL) agrees with GT — per stable /status/ id, in
 * one pass, with a settle re-run to expose lazy video-player hydration.
 *
 * VERDICTS:
 *   PASS         SEL agreed with GT on ≥1 positive AND ≥1 negative sample.
 *   FAIL         SEL and GT disagreed — selector drift, or over/under-match.
 *   NO-SAMPLE    no positive (or no negative) sample in view — scroll & re-run.
 *   SUSPECT-DRIFT media-heavy page but SEL never matched — likely a renamed hook.
 *   EYEBALL      no DOM-independent oracle exists — samples printed for a human.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMediaImg = (img) =>
  (img.getAttribute("src") || "").startsWith("https://pbs.twimg.com/media/");
const isVideoThumb = (img) => /video_thumb/.test(img.getAttribute("src") || "");

(async () => {
  // ---- faithful mirrors of facets.ts / selectors.ts (SEL side — unscoped) ----
  const F = {
    PHOTO: '[data-testid="tweetPhoto"]',
    VIDEO: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
    CARD: '[data-testid="card.wrapper"]',
    QUOTE: '[data-testid="tweet"] [data-testid="tweet"]',
    OUTBOUND_LINK: 'a[href^="http"]',
    // Owner "liked" (the like button's testid flips to unlike). Read HOST-scoped,
    // mirroring facets.ts scopedHas, so a quoted post's bar can't leak. VERIFIED
    // 2026-06-27. NB: no inline bookmark button exists on this build, so there is
    // no "bookmarked" hook to probe (see verify-filter-dom.md).
    LIKED: '[data-testid="unlike"]',
  };
  const S = {
    TWEET: 'article[data-testid="tweet"]',
    TWEET_TEXT: '[data-testid="tweetText"]',
    SOCIAL_CONTEXT: '[data-testid="socialContext"]',
    CARET: '[data-testid="caret"]',
  };
  const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  const INTERNAL_RE = /(?:^|\.)(?:x\.com|twitter\.com|t\.co)$/i;
  const PERMALINK_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/;

  const hostFromText = (raw) => {
    if (!raw) return null;
    const head = raw
      .trim()
      .replace(/^https?:\/\//i, "")
      .split(/[/?#\s]/);
    const host = (head[0] || "").toLowerCase();
    return HOST_RE.test(host) ? host : null;
  };
  const hostFromHref = (href) => {
    if (!href) return null;
    try {
      const host = new URL(href, "https://x.com").hostname.toLowerCase();
      return INTERNAL_RE.test(host) ? null : host;
    } catch {
      return null;
    }
  };
  const collectLinkHosts = (article) => {
    const hosts = new Set();
    for (const a of article.querySelectorAll(F.OUTBOUND_LINK)) {
      const fromHref = hostFromHref(a.getAttribute("href"));
      if (fromHref) hosts.add(fromHref);
      else {
        const fromText = hostFromText(a.textContent);
        if (fromText) hosts.add(fromText);
      }
    }
    const card = article.querySelector(F.CARD);
    if (card)
      for (const el of card.querySelectorAll("span, div")) {
        const h = hostFromText(el.textContent);
        if (h) hosts.add(h);
      }
    return [...hosts];
  };
  /** Faithful facets.ts extractFacets — unscoped, exactly as the consumer runs. */
  const selFacets = (article) => {
    const has = (sel) => !!article.querySelector(sel);
    // Mirror facets.ts scopedHas: a match counts only if its nearest tweet is THIS one.
    const scopedHas = (sel) => {
      const el = article.querySelector(sel);
      return !!el && el.closest(S.TWEET) === article;
    };
    const tt = article.querySelector(F.TWEET_TEXT) ?? article.querySelector(S.TWEET_TEXT);
    const linkHosts = collectLinkHosts(article);
    const hasCard = has(F.CARD);
    return {
      hasText: !!(tt && (tt.textContent || "").trim()),
      hasPhoto: has(F.PHOTO),
      hasVideo: has(F.VIDEO),
      hasQuote: has(F.QUOTE),
      hasLink: hasCard || linkHosts.length > 0,
      linkHosts,
      role: has(S.SOCIAL_CONTEXT) ? "repost" : null,
      lang: tt ? tt.getAttribute("lang") || null : null,
      liked: scopedHas(F.LIKED),
    };
  };

  // ---- independent ground truth (GT side — host-scoped to dodge quote-bleed) ----
  const inHost = (n, host) => n.closest(S.TWEET) === host;
  const hostAll = (host, sel) => [...host.querySelectorAll(sel)].filter((n) => inHost(n, host));
  const hostHas = (host, sel) => hostAll(host, sel).length > 0;

  // Video signal read WITHOUT the testid under test: a real <video>, a /video/
  // permalink, or a poster img on a *_video_thumb CDN path. (Pre-hydration none of
  // these may be present yet — handled by the settle re-run.)
  const gtVideoSignal = (a) =>
    hostHas(a, "video") || hostHas(a, 'a[href*="/video/"]') || hostAll(a, "img").some(isVideoThumb);
  const gtPhoto = (a) =>
    (hostAll(a, "img").some((i) => isMediaImg(i) && !isVideoThumb(i)) ||
      hostHas(a, 'a[href*="/photo/"]')) &&
    !gtVideoSignal(a);
  const gtText = (a) => {
    const tt = hostAll(a, S.TWEET_TEXT)[0];
    return !!(tt && (tt.textContent || "").trim());
  };
  // A quoted post = a host-scoped embedded block (role=link) carrying its OWN
  // User-Name + a /status/ id different from the host. Independent of the nested
  // [data-testid=tweet] hook the consumer relies on (the AMBER concern).
  const gtQuote = (a, hostId) =>
    hostAll(a, 'div[role="link"]').some((b) => {
      if (!b.querySelector('[data-testid="User-Name"]')) return false;
      return [...b.querySelectorAll('a[href*="/status/"]')].some((x) => {
        const m = (x.getAttribute("href") || "").match(/\/status\/(\d+)/);
        return m && m[1] !== hostId;
      });
    });
  const isRepostLabel = (a) => {
    const sc = hostAll(a, S.SOCIAL_CONTEXT)[0];
    return sc ? /repost|retweet/i.test(sc.textContent || "") : false;
  };

  // ---- enumerate REAL posts (ANCHORS GT-POST: caret + /status/ permalink) ----
  // Outermost articles only; must own a caret AND a permalink, so the not-interested
  // Feedback panel (keeps data-testid=tweet, no caret) is excluded as a phantom.
  const statusIdOf = (a) => {
    for (const x of a.querySelectorAll('a[href*="/status/"]')) {
      try {
        const p = new URL(x.getAttribute("href") || "", "https://x.com").pathname;
        const m = p.match(PERMALINK_RE);
        if (m) return m[2];
      } catch {}
    }
    return null;
  };
  const posts = [...document.querySelectorAll(S.TWEET)]
    .filter((a) => !a.parentElement?.closest(S.TWEET)) // outermost only
    .map((a) => ({ a, id: statusIdOf(a), caret: hostHas(a, S.CARET) }))
    .filter((p) => p.id && p.caret); // a real post owns both

  const totalArticles = document.querySelectorAll(S.TWEET).length;
  const phantoms = [...document.querySelectorAll(S.TWEET)].filter(
    (a) => !a.parentElement?.closest(S.TWEET) && !hostHas(a, S.CARET),
  ).length;

  if (posts.length === 0) {
    console.error(
      "[verify-facets] no real posts found (need article[data-testid=tweet] with a caret + /status/ permalink). Are you on a populated x.com timeline?",
    );
    return;
  }

  // ---- one pass: faithful SEL vector + GT vector + fail-open assertion ----
  const evalPost = (p) => {
    let threw = false;
    let sel;
    try {
      sel = selFacets(p.a);
    } catch {
      threw = true; // §8 fail-open is violated if facets() ever throws live
      sel = {};
    }
    return {
      id: p.id,
      threw,
      sel,
      gt: {
        hasText: gtText(p.a),
        hasPhoto: gtPhoto(p.a),
        videoSignal: gtVideoSignal(p.a),
        hasQuote: gtQuote(p.a, p.id),
        repostLabel: isRepostLabel(p.a),
      },
    };
  };

  const t0 = new Map(posts.map((p) => [p.id, evalPost(p)]));
  await sleep(3500); // let lazy video players hydrate, decode posters
  const live = [...document.querySelectorAll(S.TWEET)]
    .filter((a) => !a.parentElement?.closest(S.TWEET))
    .map((a) => ({ a, id: statusIdOf(a), caret: hostHas(a, S.CARET) }))
    .filter((p) => p.id && p.caret);
  const t1 = new Map(live.map((p) => [p.id, evalPost(p)]));

  // Prefer the settled (t1) reading where the same id is still mounted.
  const rows = [];
  for (const [id, a] of t0) rows.push(t1.get(id) || a);

  // hydration swap: a post that read hasPhoto at t0 but reveals video by t1
  const swaps = [...t0.keys()].filter((id) => {
    const b = t1.get(id);
    return b && t0.get(id).sel.hasPhoto && (b.gt.videoSignal || b.sel.hasVideo);
  });

  // ---- per-facet tally with the ≥1-positive AND ≥1-negative PASS rule ----
  const log = [];
  const tally = (name, selOf, gtOf, { eyeball = false, neverPass = false } = {}) => {
    let pos = 0,
      neg = 0,
      disagree = 0,
      selEverMatched = 0;
    const bad = [];
    for (const r of rows) {
      if (r.gt[gtOf] === undefined && !eyeball) continue;
      const s = selOf(r),
        g = r.gt[gtOf];
      if (s) selEverMatched++;
      if (eyeball) continue;
      if (g) pos++;
      else neg++;
      if (s !== g) {
        disagree++;
        if (bad.length < 6) bad.push(r.id);
      }
    }
    let result, detail;
    if (eyeball) {
      result = "EYEBALL";
      detail = `${selEverMatched}/${rows.length} matched SEL — verify by eye (no DOM-independent oracle)`;
    } else if (disagree > 0) {
      result = "FAIL";
      detail = `${disagree} disagreement(s) (ids ${bad.join(",")}); pos=${pos} neg=${neg}`;
    } else if (pos === 0 || neg === 0) {
      const mediaHeavy = rows.filter((r) => r.gt.hasPhoto || r.gt.videoSignal).length >= 3;
      if (selEverMatched === 0 && mediaHeavy) {
        result = "SUSPECT-DRIFT";
        detail = `SEL never matched on a media-heavy page — likely renamed. pos=${pos} neg=${neg}`;
      } else {
        result = "NO-SAMPLE";
        detail = `need a positive AND a negative sample (pos=${pos} neg=${neg}) — scroll & re-run`;
      }
    } else if (neverPass) {
      result = "NO-FP-OBSERVED";
      detail = `agreed on ${pos + neg} samples — but socialContext is over-broad; MUST also run on a profile (pinned) + a feed with a Promoted unit before trusting`;
    } else {
      result = "PASS";
      detail = `agreed on pos=${pos} neg=${neg}`;
    }
    log.push({ facet: name, result, detail });
  };

  tally("hasText", (r) => r.sel.hasText, "hasText");
  tally("hasPhoto (tweetPhoto)", (r) => r.sel.hasPhoto, "hasPhoto");
  tally("hasVideo (videoPlayer/videoComponent)", (r) => r.sel.hasVideo, "videoSignal");
  tally("hasQuote (nested tweet)", (r) => r.sel.hasQuote, "hasQuote");
  tally("role:repost (socialContext)", (r) => r.sel.role === "repost", "repostLabel", {
    neverPass: true,
  });
  tally("hasLink / linkHosts / card.wrapper", (r) => r.sel.hasLink, null, { eyeball: true });

  // ---- audits the booleans hide ----
  // (a) raw outbound-anchor audit: every a[href^=http] the consumer would scan,
  //     flagged if it is actually an avatar / permalink / quote anchor (the
  //     OUTBOUND_LINK selector is only safe because X uses RELATIVE hrefs for those).
  const anchorLeaks = [];
  for (const r of rows) {
    const host = posts.find((p) => p.id === r.id)?.a || live.find((p) => p.id === r.id)?.a;
    if (!host) continue;
    for (const x of host.querySelectorAll(F.OUTBOUND_LINK)) {
      const near = x.closest("[data-testid]")?.getAttribute("data-testid") || "";
      if (/UserAvatar|User-Name/.test(near) || x.closest('div[role="link"]')) {
        anchorLeaks.push({
          id: r.id,
          near,
          href: x.getAttribute("href"),
          text: (x.textContent || "").slice(0, 30),
        });
      }
    }
  }
  // (b) card-derived hosts with no visible vanity-domain caption (greedy hostFromText injection)
  const cardHostAudit = [];
  for (const r of rows) {
    const host = posts.find((p) => p.id === r.id)?.a || live.find((p) => p.id === r.id)?.a;
    const card = host && host.querySelector(F.CARD);
    if (!card) continue;
    const fromSpans = [...card.querySelectorAll("span, div")]
      .map((el) => hostFromText(el.textContent))
      .filter(Boolean);
    if (fromSpans.length)
      cardHostAudit.push({ id: r.id, hosts: [...new Set(fromSpans)], linkHosts: r.sel.linkHosts });
  }

  // ---- report ----
  console.log(
    `[verify-facets] ${posts.length} real posts (of ${totalArticles} articles; ${phantoms} caret-less phantom(s) excluded). Settled re-run after 3.5s.`,
  );
  console.table(log);
  if (swaps.length)
    console.warn(
      `⚠ ${swaps.length} post(s) read hasPhoto first then revealed video (lazy hydration) — ids ${swaps.join(",")}. These are the exact posts facets() can mislabel video→photo; the filter-applier MutationObserver must reclassify them.`,
    );
  console.log(
    "linkHosts samples (eyeball vs the visible vanity domain):",
    rows
      .filter((r) => r.sel.linkHosts?.length)
      .slice(0, 8)
      .map((r) => ({ id: r.id, linkHosts: r.sel.linkHosts, hasLink: r.sel.hasLink })),
  );
  if (anchorLeaks.length)
    console.warn(
      "⚠ OUTBOUND_LINK matched avatar/permalink/quote anchors (safe only while X keeps them RELATIVE):",
      anchorLeaks,
    );
  else
    console.log(
      "✓ OUTBOUND_LINK matched no avatar/permalink/quote anchors (the internal-relative-href invariant holds).",
    );
  if (cardHostAudit.length)
    console.log(
      "card.wrapper-derived hosts (flag any with no matching visible caption — greedy injection):",
      cardHostAudit,
    );
  const threw = rows.filter((r) => r.threw).map((r) => r.id);
  console.log(
    threw.length
      ? `❌ §8 FAIL-OPEN VIOLATED: facets() threw on ids ${threw.join(",")}`
      : "✓ §8 fail-open: facets() threw on no sampled post.",
  );
  const fails = log.filter((x) => /FAIL|SUSPECT/.test(x.result));
  console.log(
    fails.length
      ? `❌ ${fails.length} facet(s) FAILED/SUSPECT — see table`
      : "✅ no facet FAILED (mind NO-SAMPLE / EYEBALL / repost caveats)",
  );
  console.log(
    "STILL MANUAL: (1) role:repost needs a profile (pinned post) + a Promoted unit in view — socialContext fires on both. (2) hasLink/card needs eyeballing a real link-preview card AND a poll/Spaces card (a poll wrongly sets hasLink). (3) Re-run after scrolling through native video, a GIF, and a quote to fill NO-SAMPLE rows.",
  );

  // ---- engagement (liked): EYEBALL — no DOM-independent oracle ----
  // The strongest read-only proof needs no clicks: the Likes tab (every post liked
  // → all liked:true) vs Home (un-liked → all false). Confirm host-scoping: a post
  // that merely QUOTES a liked post must read liked:false. (No inline bookmark
  // button exists on this build, so bookmarked is not probed — see the doc.)
  console.table(rows.map((r) => ({ id: r.id, liked: r.sel.liked })));
  const anyLiked = rows.some((r) => r.sel.liked);
  console.log(
    anyLiked
      ? "engagement: LIKED matched at least one post — eyeball the heart fills above."
      : "engagement: no liked post in view — open your Likes tab or like one, then re-run.",
  );

  // ---- U1: is a live like-toggle an ATTRIBUTE flip or a CHILDLIST swap? ----
  // The applier observer watches BOTH, so the feature is correct either way; this
  // only tells us which path actually fires (right-sizes the cost + the test).
  window.__lassoEngagementMechanism = () => {
    const col = document.querySelector('[data-testid="primaryColumn"]') || document.body;
    const ENG = '[data-testid="like"],[data-testid="unlike"]';
    let n = 0;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes" && /like/i.test(m.target.getAttribute("data-testid") || "")) {
          console.log(
            `[mechanism] ATTRIBUTE flip → now "${m.target.getAttribute("data-testid")}" (was "${m.oldValue}")`,
          );
          if (++n >= 6) obs.disconnect();
        }
        if (m.type === "childList")
          for (const node of m.addedNodes)
            if (node.nodeType === 1 && (node.matches?.(ENG) || node.querySelector?.(ENG))) {
              console.log("[mechanism] CHILDLIST insert of a like button node");
              if (++n >= 6) obs.disconnect();
            }
      }
    });
    obs.observe(col, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-testid"],
      attributeOldValue: true,
    });
    console.log(
      "[mechanism] watching — now click a post's like. ATTRIBUTE vs CHILDLIST is reported above.",
    );
  };
  console.log(
    "U1 (mutation mechanism): run __lassoEngagementMechanism() then click a post's like to see whether X flips the testid via ATTRIBUTE or CHILDLIST.",
  );

  return log;
})();
