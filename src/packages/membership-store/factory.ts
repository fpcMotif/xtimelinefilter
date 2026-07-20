import { NullMembershipStore } from "./lib/null";
import type { MembershipStore, MembershipStoreProbe } from "./types";

export interface MembershipStoreConfig {
  convexUrl?: string;
  convexDeviceKey?: string;
}

/**
 * Builds the optional read-only health-check seam. The concrete Convex import
 * remains here; options only depends on the MembershipStore contract.
 */
export function createMembershipStoreProbe(
  load: () => Promise<MembershipStoreProbe>,
): MembershipStoreProbe {
  return {
    async probe(config): Promise<void> {
      await (await load()).probe(config);
    },
  };
}

export const defaultMembershipStoreProbe = createMembershipStoreProbe(async () => {
  const { testConvexConnection } = await import("./convex-client");
  return { probe: testConvexConnection };
});

/**
 * The only place that knows the concrete Mirror impl (sibling of `createXListApi`).
 * `loadConvex` is injected and awaited only when a device key is configured, so the
 * Convex client — a separate chunk that opens a WebSocket — is neither fetched nor
 * constructed otherwise. Unconfigured ⇒ Null ⇒ the extension behaves exactly as
 * before (ADR-0009). A configured adapter either builds or rejects; the live
 * facade owns the fail-open transition and reports an unavailable Mirror honestly.
 */
export async function createMembershipStore(
  config: MembershipStoreConfig,
  loadConvex: () => Promise<(cfg: { url: string; deviceKey: string }) => MembershipStore>,
): Promise<MembershipStore> {
  if (config.convexUrl && config.convexDeviceKey) {
    const buildConvex = await loadConvex();
    return buildConvex({ url: config.convexUrl, deviceKey: config.convexDeviceKey });
  }
  return new NullMembershipStore();
}
