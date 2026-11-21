import * as stylex from "@stylexjs/stylex";

export const breakpoints = stylex.defineConsts({
  sm: "@media (min-width: 640px)",
  md: "@media (min-width: 768px)",
  lg: "@media (min-width: 1024px)",
  xl: "@media (min-width: 1280px)",
  "2xl": "@media (min-width: 1536px)",
  dark: "@media (prefers-color-scheme: dark)",
  motionReduce: "@media (prefers-reduced-motion: reduce)",
});
