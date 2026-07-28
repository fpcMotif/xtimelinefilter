import { isCacheObservation, type CacheObservation } from "@/core/cache-observation";
import { isXId } from "@/core/protocol/x-id";
import type { Owner } from "@/packages/membership-store/types";
import type { XList } from "@/packages/x-client/types";

export type ListCacheRequest =
  | { type: "lasso:list-cache"; operation: "read"; owner: Owner }
  | { type: "lasso:list-cache"; operation: "all" }
  | { type: "lasso:list-cache"; operation: "begin"; owner: Owner }
  | {
      type: "lasso:list-cache";
      operation: "commit";
      owner: Owner;
      token: CacheObservation;
      lists: XList[];
    };
export type ListCacheSuccess =
  | { lists: XList[] | null }
  | { catalogs: Array<{ owner: Owner; lists: XList[] }> }
  | { token: CacheObservation };
export type ListCacheResponse = ({ ok: true } & ListCacheSuccess) | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const has = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const atMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};
const owner = (value: unknown): value is Owner =>
  record(value) &&
  Object.keys(value).every((key) => key === "userId" || key === "screenName") &&
  isXId(value.userId) &&
  typeof value.screenName === "string" &&
  atMost(value.screenName, 50);
const list = (value: unknown): value is XList =>
  record(value) &&
  Object.keys(value).every(
    (key) => key === "id" || key === "name" || key === "memberCount" || key === "isPrivate",
  ) &&
  isXId(value.id) &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  atMost(value.name, 100) &&
  (!has(value, "memberCount") ||
    (typeof value.memberCount === "number" &&
      Number.isSafeInteger(value.memberCount) &&
      value.memberCount >= 0)) &&
  (!has(value, "isPrivate") || typeof value.isPrivate === "boolean");
const lists = (value: unknown): value is XList[] =>
  Array.isArray(value) && value.length <= 1000 && value.every(list);
export function isListCacheRequest(msg: unknown): msg is ListCacheRequest {
  if (!record(msg) || msg.type !== "lasso:list-cache") return false;
  if (msg.operation === "all") return Object.keys(msg).length === 2;
  if (msg.operation === "read" || msg.operation === "begin")
    return (
      owner(msg.owner) &&
      Object.keys(msg).every((key) => key === "type" || key === "operation" || key === "owner")
    );
  return (
    msg.operation === "commit" &&
    owner(msg.owner) &&
    isCacheObservation(msg.token) &&
    lists(msg.lists) &&
    Object.keys(msg).every((key) => ["type", "operation", "owner", "token", "lists"].includes(key))
  );
}
function success(value: unknown): Record<string, unknown> {
  if (!record(value) || typeof value.ok !== "boolean")
    throw new Error("Invalid list cache response");
  if (!value.ok) {
    if (typeof value.error !== "string") throw new Error("Invalid list cache response");
    throw new Error(value.error);
  }
  return value;
}
export async function requestListCache(request: ListCacheRequest): Promise<ListCacheResponse> {
  if (!isListCacheRequest(request)) throw new Error("Invalid list cache request");
  const response = success(await chrome.runtime.sendMessage(request));
  if (request.operation === "all") {
    if (
      !Array.isArray(response.catalogs) ||
      response.catalogs.length > 32 ||
      !response.catalogs.every((row) => record(row) && owner(row.owner) && lists(row.lists))
    )
      throw new Error("Invalid list cache response");
    return { ok: true, catalogs: response.catalogs as Array<{ owner: Owner; lists: XList[] }> };
  }
  if (request.operation === "begin") {
    if (!isCacheObservation(response.token)) throw new Error("Invalid list cache response");
    return { ok: true, token: response.token };
  }
  if (!(response.lists === null || lists(response.lists)))
    throw new Error("Invalid list cache response");
  return { ok: true, lists: response.lists };
}
