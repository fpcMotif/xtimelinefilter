declare module "*.css?inline" {
  const css: string;
  export default css;
}

// Side-effect CSS imports (options/popup pages) — Vite injects them at build.
declare module "*.css";
