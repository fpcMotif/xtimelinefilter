import { NullMembershipStore } from "./null";
import type { MembershipStore } from "./types";

export interface MembershipStoreConfig {
  convexUrl?: string;
  convexDeviceKey?: string;
}

/**
 * The only place that knows the concrete Mirror impl. Unlike its sibling
 * `createXListApi`, which imports its backends directly, this still *injects*
 * `buildConvex` and calls it lazily — the Convex client opens a WebSocket at
 * construction, so it is built only when a device key is configured and must
 * fail open. Unconfigured ⇒ Null ⇒ the extension behaves exactly as before
 * (ADR-0009).
 */
export function createMembershipStore(
  config: MembershipStoreConfig,
  buildConvex: (cfg: { url: string; deviceKey: string }) => MembershipStore,
): MembershipStore {
  if (config.convexUrl && config.convexDeviceKey) {
    try {
      return buildConvex({ url: config.convexUrl, deviceKey: config.convexDeviceKey });
    } catch (err) {
      // ADR-0009: the Mirror is never load-bearing. A malformed URL makes
      // ConvexHttpClient's constructor throw synchronously; without this guard
      // that throw unwinds the whole content-script boot (overlay/filter/keyboard/
      // scanner). Degrade to Null instead — the X flow stays bit-for-bit unchanged.
      console.warn("[Lasso] Mirror disabled — Convex client construction failed", err);
      return new NullMembershipStore();
    }
  }
  return new NullMembershipStore();
}
