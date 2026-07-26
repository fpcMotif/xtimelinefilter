import { isCoachCommand, type CoachCommand, type CoachCommandResult } from "@/core/coach-domain";

export interface CoachRequest {
  type: "lasso:coach";
  command: CoachCommand;
}
export type CoachResponse = { ok: true; result: CoachCommandResult } | { ok: false; error: string };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isCoachRequest(msg: unknown): msg is CoachRequest {
  return (
    isRecord(msg) &&
    msg.type === "lasso:coach" &&
    "command" in msg &&
    isCoachCommand(msg.command) &&
    Object.keys(msg).every((key) => key === "type" || key === "command")
  );
}

function isResultFor(value: unknown, command: CoachCommand): value is CoachCommandResult {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (command.kind) {
    case "is-onboarded":
      return (
        value.kind === "is-onboarded" &&
        typeof value.onboarded === "boolean" &&
        Object.keys(value).every((key) => key === "kind" || key === "onboarded")
      );
    case "hints-active":
      return (
        value.kind === "hints-active" &&
        typeof value.active === "boolean" &&
        Object.keys(value).every((key) => key === "kind" || key === "active")
      );
    case "try-show-tip":
      return (
        value.kind === "try-show-tip" &&
        typeof value.show === "boolean" &&
        Object.keys(value).every((key) => key === "kind" || key === "show")
      );
    default:
      return value.kind === "ok" && Object.keys(value).length === 1;
  }
}

function response(value: unknown, command: CoachCommand): CoachCommandResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("Invalid coach response");
  if (!value.ok) {
    if (typeof value.error !== "string") throw new Error("Invalid coach response");
    throw new Error(value.error);
  }
  if (!isResultFor(value.result, command)) throw new Error("Invalid coach response");
  return value.result;
}

export function requestCoach(command: CoachCommand): Promise<CoachCommandResult> {
  const request = { type: "lasso:coach" as const, command };
  if (!isCoachRequest(request)) return Promise.reject(new Error("Invalid coach command"));
  return chrome.runtime.sendMessage(request).then((value: unknown) => response(value, command));
}
