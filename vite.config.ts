import { fileURLToPath, URL } from "node:url";

import { crx } from "@crxjs/vite-plugin";
import preact from "@preact/preset-vite";
import stylexVite from "@stylexjs/unplugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { defineConfig, type Plugin } from "vite";

import manifest from "./src/manifest.config";

const stylexPlugin = stylexVite({
  useCSSLayers: true,
  unstable_moduleResolution: {
    type: "commonJS",
    rootDir: fileURLToPath(new URL(".", import.meta.url)),
  },
  aliases: {
    "@/*": [fileURLToPath(new URL("./src/*", import.meta.url))],
  },
});

type StylexCollector = { __stylexCollectCss?: () => string };

const shadowInjectorPlugin: Plugin = {
  name: "lasso-stylex-shadow-injector",
  renderChunk(code) {
    if (code.includes("__STYLEX_SHADOW_CSS_INJECT__")) {
      const collector = stylexPlugin as unknown as StylexCollector;
      const collectedCss = collector.__stylexCollectCss?.() ?? "";
      return {
        code: code.replace(
          "__STYLEX_SHADOW_CSS_INJECT__",
          JSON.stringify(collectedCss).slice(1, -1),
        ),
        map: null,
      };
    }
    return null;
  },
};

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [varlockVitePlugin(), stylexPlugin, shadowInjectorPlugin, preact(), crx({ manifest })],
});
