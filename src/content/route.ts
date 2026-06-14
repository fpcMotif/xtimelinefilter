/**
 * Where the Filter is allowed to run (spec §3): Home and List timelines only.
 * x.com is a SPA, so callers re-evaluate on route change, not just page load.
 */
export function isInScope(pathname: string): boolean {
  return pathname === "/home" || /^\/i\/lists\/\d+(?:\/|$)/.test(pathname);
}

/**
 * Fire `cb` on SPA navigations (pushState/replaceState/popstate). Returns an
 * unsubscribe. Patches history once; multiple subscribers share the patch.
 */
let patched = false;
const listeners = new Set<() => void>();

function ensurePatched(): void {
  if (patched) return;
  patched = true;
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name];
    history[name] = function patchedHistory(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      for (const cb of listeners) cb();
      return result;
    } as History[typeof name];
  }
  window.addEventListener("popstate", () => {
    for (const cb of listeners) cb();
  });
}

export function onRouteChange(cb: () => void): () => void {
  ensurePatched();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
