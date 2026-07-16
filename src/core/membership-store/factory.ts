import { NullMembershipStore } from "./null";
import type { MembershipStore } from "./types";

export interface MembershipStoreConfig {
  convexUrl?: string;
  convexDeviceKey?: string;
}

/**
 * The only place that knows the concrete Mirror impl (sibling of `createXListApi`).
 * `loadConvex` is injected and awaited only when a device key is configured, so the
 * Convex client — a separate chunk that opens a WebSocket — is neither fetched nor
 * constructed otherwise. Unconfigured ⇒ Null ⇒ the extension behaves exactly as
 * before (ADR-0009).
 */
export async function createMembershipStore(
  config: MembershipStoreConfig,
  loadConvex: () => Promise<(cfg: { url: string; deviceKey: string }) => MembershipStore>,
): Promise<MembershipStore> {
  if (config.convexUrl && config.convexDeviceKey) {
    try {
      const buildConvex = await loadConvex();
      return buildConvex({ url: config.convexUrl, deviceKey: config.convexDeviceKey });
    } catch (err) {
      // ADR-0009: the Mirror is never load-bearing. Two ways this throws: the
      // dynamic import() can reject (chunk blocked/missing), and a malformed URL
      // makes ConvexHttpClient's constructor throw synchronously. Either would
      // unwind the whole content-script boot (overlay/filter/keyboard/scanner).
      // Degrade to Null instead — the X flow stays bit-for-bit unchanged.
      console.warn("[Lasso] Mirror disabled — Convex client unavailable", err);
      return new NullMembershipStore();
    }
  }
  return new NullMembershipStore();
}
