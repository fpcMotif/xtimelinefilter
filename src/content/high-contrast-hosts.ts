import type { SettingsStore } from "@/core/settings";

export interface HighContrastHosts {
  /** Apply the current contrast mode now; returns an idempotent unregister. */
  register(host: Element): () => void;
  /** Stop observing settings and release every host. */
  dispose(): void;
}

/**
 * Owns the `data-hc` boundary for every content-script Shadow host. One store
 * subscription keeps existing and later hosts in sync without passing theme
 * state through feature or component APIs.
 */
export function createHighContrastHosts(
  settings: SettingsStore,
  initialHighContrast: boolean,
): HighContrastHosts {
  const hosts = new Set<Element>();
  let highContrast = initialHighContrast;
  let disposed = false;
  let revision = 0;

  function apply(host: Element): void {
    host.toggleAttribute("data-hc", highContrast);
  }

  function setHighContrast(next: boolean): void {
    highContrast = next;
    for (const host of hosts) apply(host);
  }

  const unsubscribe = settings.subscribe((next) => {
    revision += 1;
    setHighContrast(next.highContrast);
  });

  // The boot snapshot prevents a light-frame flicker. Refresh it in case an
  // Options write landed before this content script subscribed. A later push
  // wins over this asynchronous read.
  void settings
    .get()
    .then((next) => {
      if (!disposed && revision === 0) setHighContrast(next.highContrast);
    })
    .catch(() => {
      // Contrast is cosmetic; keep the known boot snapshot if storage fails.
    });

  return {
    register(host) {
      if (disposed) return () => {};
      hosts.add(host);
      apply(host);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        hosts.delete(host);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      hosts.clear();
      unsubscribe();
    },
  };
}
