/** Platform-aware keycap rendering: `Alt` on Windows/Linux, `⌥` on macOS (story beat 5). */

export type Platform = "mac" | "other";

const MAC_GLYPHS: Record<string, string> = { Alt: "⌥", Shift: "⇧", Meta: "⌘", Ctrl: "⌃" };
const SHARED: Record<string, string> = { Escape: "Esc" };

export interface PlatformSource {
  platform?: string;
  userAgent?: string;
}

export function detectPlatform(nav: PlatformSource = navigator): Platform {
  const probe = `${nav.platform ?? ""} ${nav.userAgent ?? ""}`;
  return /mac/i.test(probe) ? "mac" : "other";
}

/** "Alt+Shift+l" → ["Alt","Shift","L"] (or ["⌥","⇧","L"] on mac). */
export function keycaps(combo: string, platform: Platform): string[] {
  return combo
    .split("+")
    .filter(Boolean)
    .map((part) => {
      if (platform === "mac" && MAC_GLYPHS[part]) return MAC_GLYPHS[part];
      if (SHARED[part]) return SHARED[part];
      return part.length === 1 ? part.toUpperCase() : part;
    });
}
