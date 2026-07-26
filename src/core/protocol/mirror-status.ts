export type MirrorStatusRequest =
  | { type: "lasso:mirror-status"; operation: "read" }
  | { type: "lasso:mirror-status"; operation: "report"; ok: boolean; configId: string };
export type MirrorStatusSuccess =
  | { status?: never }
  | { status: { ok: boolean; at: number; configId: string } | null };
export type MirrorStatusResponse =
  | ({ ok: true } & MirrorStatusSuccess)
  | { ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const atMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};
export function isMirrorStatusRequest(msg: unknown): msg is MirrorStatusRequest {
  if (!record(msg) || msg.type !== "lasso:mirror-status") return false;
  if (msg.operation === "read") return Object.keys(msg).length === 2;
  return (
    msg.operation === "report" &&
    typeof msg.ok === "boolean" &&
    typeof msg.configId === "string" &&
    msg.configId.trim().length > 0 &&
    atMost(msg.configId, 256) &&
    Object.keys(msg).every((key) => ["type", "operation", "ok", "configId"].includes(key))
  );
}
export async function requestMirrorStatus(
  request: MirrorStatusRequest,
): Promise<MirrorStatusResponse> {
  if (!isMirrorStatusRequest(request)) throw new Error("Invalid mirror status request");
  const response = await chrome.runtime.sendMessage(request);
  if (!record(response) || typeof response.ok !== "boolean")
    throw new Error("Invalid mirror status response");
  if (!response.ok) {
    if (typeof response.error !== "string") throw new Error("Invalid mirror status response");
    throw new Error(response.error);
  }
  if (request.operation === "report") return { ok: true };
  const status = response.status;
  if (
    status !== null &&
    (!record(status) ||
      typeof status.ok !== "boolean" ||
      typeof status.at !== "number" ||
      !Number.isSafeInteger(status.at) ||
      status.at < 0 ||
      typeof status.configId !== "string" ||
      status.configId.trim().length === 0 ||
      !atMost(status.configId, 256))
  )
    throw new Error("Invalid mirror status response");
  return { ok: true, status: status as { ok: boolean; at: number; configId: string } | null };
}
