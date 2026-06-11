/**
 * Pure background logic (testable without chrome.*): the install moment opens
 * the product itself as the tour (story beat 2), and the toolbar badge mirrors
 * the content script's live state (beats 7 & 9). index.ts wires chrome events.
 */

/** The product IS the tour: land where the value lives. */
export const WELCOME_URL = "https://x.com/home#lasso-welcome";

/**
 * One-question exit form (story beat 10) — the only telemetry Lasso will ever
 * have. Hosted off-extension; update when the form moves.
 */
export const UNINSTALL_FORM_URL =
  "https://github.com/fpcMotif/xtimelinefilter/issues/new?labels=uninstall-feedback&title=What%20made%20you%20remove%20Lasso%3F";

export interface InstallApi {
  createTab(url: string): void;
  setUninstallURL(url: string): void;
}

export function handleInstalled(details: { reason: string }, api: InstallApi): void {
  if (details.reason === "install") api.createTab(WELCOME_URL);
  api.setUninstallURL(UNINSTALL_FORM_URL);
}

/** Messages the content script sends about its per-tab state. */
export interface BadgeMessage {
  type?: string;
  count?: number;
  state?: "asleep" | "awake";
}

/** Badge text for a message, or null when the message is not badge-related. */
export function badgeTextFor(msg: BadgeMessage | undefined): string | null {
  if (msg?.type === "lasso:badge" && typeof msg.count === "number") {
    return msg.count > 0 ? String(msg.count) : "";
  }
  if (msg?.type === "lasso:state") return msg.state === "asleep" ? "zz" : "";
  return null;
}
