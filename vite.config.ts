import { fileURLToPath, URL } from "node:url";

import { crx } from "@crxjs/vite-plugin";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { defineConfig } from "vite";

import manifest from "./src/manifest.config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [varlockVitePlugin(), tailwindcss(), preact(), crx({ manifest })],
});
