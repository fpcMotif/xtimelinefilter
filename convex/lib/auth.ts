// Convex provides `process.env` in its runtime; declare it locally so the
// convex/ tsconfig typechecks without pulling full @types/node.
declare const process: { env: Record<string, string | undefined> };

// Single-tenant device-key gate. Every Convex function calls this first.
// The deployment is personal; the key is the only long-lived credential.
export function assertDeviceKey(deviceKey: string): void {
  const expected = process.env.LASSO_DEVICE_KEY;
  if (!expected || deviceKey !== expected) {
    throw new Error("Unauthorized: invalid device key");
  }
}
