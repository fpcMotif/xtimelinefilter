import { NullMembershipStore } from "./null";
import type { MembershipStore } from "./types";

export interface MembershipStoreConfig {
  convexUrl?: string;
  convexDeviceKey?: string;
}

/**
 * The only place that knows the concrete Mirror impl (sibling of `createXListApi`).
 * `buildConvex` is injected and called lazily so the Convex client — which opens a
 * WebSocket — is constructed only when a device key is configured. Unconfigured ⇒
 * Null ⇒ the extension behaves exactly as before (ADR-0009).
 */
export function createMembershipStore(
  config: MembershipStoreConfig,
  buildConvex: (cfg: { url: string; deviceKey: string }) => MembershipStore,
): MembershipStore {
  if (config.convexUrl && config.convexDeviceKey) {
    return buildConvex({ url: config.convexUrl, deviceKey: config.convexDeviceKey });
  }
  return new NullMembershipStore();
}
