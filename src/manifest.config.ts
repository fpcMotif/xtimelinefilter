import { defineManifest } from "@crxjs/vite-plugin";

type ContentScript = NonNullable<chrome.runtime.ManifestV3["content_scripts"]>[number];

const mainWorldContentScript = {
  // X auth cookies and the authenticated web APIs are same-origin. Keep the
  // injection scope canonical: a twitter.com document cannot call x.com as
  // its session origin.
  matches: ["https://x.com/*"],
  js: ["src/content/main-world.ts"],
  run_at: "document_start",
  world: "MAIN",
} as unknown as ContentScript;

// Authenticated x.com calls run in the content script (same-origin) per ADR-0002,
// so cookies/ct0 attach automatically — no host permission needed for X. The one
// host_permission is the optional Convex Mirror (ADR-0009): a cross-origin POST to
// the user's own *.convex.cloud deployment, gated by a device key. Absent a key the
// Mirror never connects. Store-listing copy lives in docs/store-listing.md.
export default defineManifest({
  manifest_version: 3,
  name: "Lasso — add people to your X Lists from the timeline",
  version: "0.2.0",
  description:
    "Select posts as you scroll and file their authors into your X Lists — without leaving the feed. Keyboard-first.",
  icons: {
    16: "icons/lasso-16.png",
    32: "icons/lasso-32.png",
    48: "icons/lasso-48.png",
    128: "icons/lasso-128.png",
  },
  permissions: ["storage", "webNavigation"],
  minimum_chrome_version: "106",
  host_permissions: ["https://*.convex.cloud/*"],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src https://*.convex.cloud wss://*.convex.cloud",
  },
  content_scripts: [
    mainWorldContentScript,
    {
      matches: ["https://x.com/*"],
      js: ["src/content/main.tsx"],
      run_at: "document_idle",
    },
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  action: {
    default_title: "Lasso",
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/lasso-16.png",
      32: "icons/lasso-32.png",
    },
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
});
