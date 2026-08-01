/**
 * Classifies an inbound runtime sender into one narrow extension capability.
 * Routes still decide which operations each capability may perform.
 */

export type SenderCapability = "options" | "popup" | "x-content" | "social-content" | "unknown";

/** Minimal runtime identity; injected so the classifier has no global dependency. */
export interface SenderRuntime {
  id: string;
  getURL(path: string): string;
  getManifest(): {
    options_ui?: { page?: unknown };
    action?: { default_popup?: unknown };
  };
}

/** The only MessageSender fields that establish a route capability. */
export interface RuntimeMessageSender {
  id?: unknown;
  tab?: { id?: unknown };
  frameId?: unknown;
  origin?: unknown;
  url?: unknown;
}

interface SenderUrls {
  options?: string;
  popup?: string;
}

export type MessageSenderClassifier = (sender: RuntimeMessageSender) => SenderCapability;

const SOCIAL_ORIGINS = new Set([
  "https://threads.com",
  "https://www.threads.com",
  "https://threads.net",
  "https://www.threads.net",
  "https://instagram.com",
  "https://www.instagram.com",
]);
const X_ORIGIN = "https://x.com";

function extensionPageUrl(runtime: SenderRuntime, path: unknown): string | undefined {
  if (typeof path !== "string" || path.length === 0) return undefined;
  try {
    const root = new URL(runtime.getURL("/"));
    const page = new URL(path, root);
    return page.protocol === root.protocol && page.host === root.host ? page.href : undefined;
  } catch {
    return undefined;
  }
}

function senderUrls(runtime: SenderRuntime): SenderUrls {
  const manifest = runtime.getManifest();
  return {
    options: extensionPageUrl(runtime, manifest.options_ui?.page),
    popup: extensionPageUrl(runtime, manifest.action?.default_popup),
  };
}

function isTopXContent(sender: RuntimeMessageSender, extensionId: string): boolean {
  if (
    sender.id !== extensionId ||
    typeof sender.tab?.id !== "number" ||
    !Number.isSafeInteger(sender.tab.id) ||
    sender.tab.id < 0 ||
    sender.frameId !== 0 ||
    sender.origin !== X_ORIGIN ||
    typeof sender.url !== "string"
  ) {
    return false;
  }
  try {
    return new URL(sender.url).origin === X_ORIGIN;
  } catch {
    return false;
  }
}
function isTopSocialContent(sender: RuntimeMessageSender, extensionId: string): boolean {
  if (
    sender.id !== extensionId ||
    typeof sender.tab?.id !== "number" ||
    !Number.isSafeInteger(sender.tab.id) ||
    sender.tab.id < 0 ||
    sender.frameId !== 0 ||
    typeof sender.origin !== "string" ||
    !SOCIAL_ORIGINS.has(sender.origin) ||
    typeof sender.url !== "string"
  ) {
    return false;
  }
  try {
    return SOCIAL_ORIGINS.has(new URL(sender.url).origin);
  } catch {
    return false;
  }
}

/**
 * Builds one immutable capability classifier from this extension's manifest.
 * A missing or malformed manifest route is intentionally unavailable.
 */
export function createMessageSenderClassifier(runtime: SenderRuntime): MessageSenderClassifier {
  const { options, popup } = senderUrls(runtime);

  return (sender) => {
    if (sender.id !== runtime.id || typeof sender.url !== "string") return "unknown";
    if (options !== undefined && sender.url === options) return "options";
    if (popup !== undefined && sender.url === popup) return "popup";
    if (isTopXContent(sender, runtime.id)) return "x-content";
    return isTopSocialContent(sender, runtime.id) ? "social-content" : "unknown";
  };
}
