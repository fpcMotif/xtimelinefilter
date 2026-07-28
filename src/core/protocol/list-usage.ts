import { isXId } from "@/core/protocol/x-id";

export type ListUsageRequest =
  | { type: "lasso:list-usage"; operation: "record"; ownerUserId: string; listId: string }
  | { type: "lasso:list-usage"; operation: "recent"; ownerUserId: string; limit: number };
export type ListUsageSuccess = { listIds?: never } | { listIds: string[] };
export type ListUsageResponse = ({ ok: true } & ListUsageSuccess) | { ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function isListUsageRequest(msg: unknown): msg is ListUsageRequest {
  if (!record(msg) || msg.type !== "lasso:list-usage" || !isXId(msg.ownerUserId)) return false;
  if (msg.operation === "record")
    return (
      isXId(msg.listId) &&
      Object.keys(msg).every((key) => ["type", "operation", "ownerUserId", "listId"].includes(key))
    );
  return (
    msg.operation === "recent" &&
    typeof msg.limit === "number" &&
    Number.isSafeInteger(msg.limit) &&
    msg.limit >= 0 &&
    msg.limit <= 100 &&
    Object.keys(msg).every((key) => ["type", "operation", "ownerUserId", "limit"].includes(key))
  );
}
export async function requestListUsage(request: ListUsageRequest): Promise<ListUsageResponse> {
  if (!isListUsageRequest(request)) throw new Error("Invalid list usage request");
  const response = await chrome.runtime.sendMessage(request);
  if (!record(response) || typeof response.ok !== "boolean")
    throw new Error("Invalid list usage response");
  if (!response.ok) {
    if (typeof response.error !== "string") throw new Error("Invalid list usage response");
    throw new Error(response.error);
  }
  if (request.operation === "recent") {
    if (
      !Array.isArray(response.listIds) ||
      response.listIds.length > request.limit ||
      response.listIds.length > 100 ||
      !response.listIds.every(isXId)
    )
      throw new Error("Invalid list usage response");
    return { ok: true, listIds: response.listIds as string[] };
  }
  return { ok: true };
}
