import {
  isFilterCommand,
  isFilterState,
  MAX_FILTER_LANGUAGES,
  MAX_FILTER_LANGUAGE_LENGTH,
  type FilterCommand,
} from "@/core/filter-domain";
import type { FilterState } from "@/core/filter-types";

export type FilterRequest =
  | { type: "lasso:filter"; operation: "read"; defaultLanguages: string[] }
  | {
      type: "lasso:filter";
      operation: "command";
      defaultLanguages: string[];
      command: FilterCommand;
    };
export type FilterResponse = { ok: true; state: FilterState } | { ok: false; error: string };

const isDefaults = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_FILTER_LANGUAGES &&
  value.every(
    (language) => typeof language === "string" && language.length <= MAX_FILTER_LANGUAGE_LENGTH,
  );
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isFilterRequest(msg: unknown): msg is FilterRequest {
  if (!isRecord(msg) || msg.type !== "lasso:filter" || !isDefaults(msg.defaultLanguages)) {
    return false;
  }
  if (msg.operation === "read") {
    return Object.keys(msg).every(
      (key) => key === "type" || key === "operation" || key === "defaultLanguages",
    );
  }
  return (
    msg.operation === "command" &&
    isFilterCommand(msg.command) &&
    Object.keys(msg).every(
      (key) =>
        key === "type" || key === "operation" || key === "defaultLanguages" || key === "command",
    )
  );
}

function response(raw: unknown): FilterState {
  if (!isRecord(raw) || typeof raw.ok !== "boolean") {
    throw new Error("Invalid filter response");
  }
  if (!raw.ok) {
    if (typeof raw.error !== "string") throw new Error("Invalid filter response");
    throw new Error(raw.error);
  }
  if (!isFilterState(raw.state)) throw new Error("Invalid filter response");
  return raw.state;
}

export function requestFilterRead(defaultLanguages: readonly string[]): Promise<FilterState> {
  const request = {
    type: "lasso:filter" as const,
    operation: "read" as const,
    defaultLanguages: [...defaultLanguages],
  };
  if (!isFilterRequest(request)) return Promise.reject(new Error("Invalid filter defaults"));
  return chrome.runtime.sendMessage(request).then(response);
}

export function requestFilterCommand(
  command: FilterCommand,
  defaultLanguages: readonly string[],
): Promise<FilterState> {
  const request = {
    type: "lasso:filter" as const,
    operation: "command" as const,
    defaultLanguages: [...defaultLanguages],
    command,
  };
  if (!isFilterRequest(request)) return Promise.reject(new Error("Invalid filter command"));
  return chrome.runtime.sendMessage(request).then(response);
}
