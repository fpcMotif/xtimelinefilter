/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Convex Mirror deployment URL — written to .env.local by `convex dev`. */
  readonly VITE_CONVEX_URL?: string;
  /** Convex Mirror device key — matches LASSO_DEVICE_KEY on the deployment. */
  readonly VITE_LASSO_DEVICE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
