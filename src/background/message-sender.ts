/**
 * Classifies an inbound runtime sender into one narrow extension capability.
 * Routes still decide which operations each capability may perform.
 */

export type SenderCapability = "options" | "popup" | "x-content" | "unknown";

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
    return isTopXContent(sender, runtime.id) ? "x-content" : "unknown";
  };
}
