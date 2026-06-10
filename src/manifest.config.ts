import { defineManifest } from "@crxjs/vite-plugin";

// No host_permissions: authenticated x.com calls run in the content script
// (same-origin) per ADR-0002, so cookies/ct0 attach automatically.
export default defineManifest({
  manifest_version: 3,
  name: "Lasso — X List Assigner",
  version: "0.1.0",
  description:
    "Select tweets and assign their authors to your X Lists, in bulk, from the timeline.",
  permissions: ["storage"],
  content_scripts: [
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["src/content/main.tsx"],
      run_at: "document_idle",
    },
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  action: { default_title: "Lasso" },
});
