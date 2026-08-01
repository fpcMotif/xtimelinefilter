import type { SenderCapability } from "@/background/message-sender";
import { COLLECTIONS_OPERATIONS, type CollectionsOperation } from "@/core/protocol/collections";

type Message = Record<string, unknown>;

const isMessage = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const operationIs = (message: Message, ...operations: string[]): boolean =>
  typeof message.operation === "string" && operations.includes(message.operation);

const coachKind = (message: Message): unknown =>
  isMessage(message.command) ? message.command.kind : undefined;

const contentSettingsPatch = (message: Message): boolean => {
  if (!isMessage(message.patch)) return false;
  return Object.keys(message.patch).every(
    (key) => key === "defaultList" || key === "defaultListId" || key === "pillPosition",
  );
};

/**
 * Which collections operations each surface may submit, as EXACT enumerated
 * sets rather than a prefix or a "reads are fine" rule. A later ticket adding an
 * operation must extend these tables and their test deliberately — it cannot
 * widen a surface by omission.
 *
 * Options runs the Folders workshop, so it may submit everything. The popup only
 * renders a count. Top-level x.com content runs the save gesture and its picker:
 * it lists Folders, asks which hold a post, creates a Folder inline, saves and
 * unsaves — and deliberately gets NO count read, because nothing in the page
 * shows one.
 */
const POPUP_COLLECTIONS = new Set<CollectionsOperation>(["counts"]);
const X_CONTENT_COLLECTIONS = new Set<CollectionsOperation>([
  // `begin` is here because content WRITES: every write carries a Clear fence,
  // and the token has to be minted at the start of the gesture — a token minted
  // worker-side at write time would always be current and fence nothing.
  "begin",
  "list-folders",
  "folders-holding",
  "create-folder",
  "save-post",
  "save-to-default-folder",
  "remove-from-folder",
  "delete-saved-post",
]);

function collectionsCapability(capability: SenderCapability, message: Message): boolean {
  // Typed against the family's own operation list, so a removed or misspelled
  // operation in either set above is a type error rather than a silent grant —
  // and an operation this build does not know is denied outright, including for
  // Options, rather than reaching a handler that has no case for it.
  const operation = COLLECTIONS_OPERATIONS.find((name) => name === message.operation);
  if (operation === undefined) return false;
  if (capability === "options") return true;
  if (capability === "popup") return POPUP_COLLECTIONS.has(operation);
  return capability === "x-content" && X_CONTENT_COLLECTIONS.has(operation);
}

/**
 * Directional runtime capability policy. Shape guards still validate each
 * accepted request; this layer decides which extension surface may submit it.
 */
export function canHandleMessage(capability: SenderCapability, value: unknown): boolean {
  if (!isMessage(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "lasso:clear-data":
      return capability === "options";
    case "lasso:settings":
      if (capability === "options") return operationIs(value, "read", "patch");
      if (capability === "popup") return operationIs(value, "read");
      if (capability !== "x-content") return false;
      return (
        operationIs(value, "read") || (operationIs(value, "patch") && contentSettingsPatch(value))
      );
    case "lasso:filter":
      return (
        (capability === "options" || capability === "popup" || capability === "x-content") &&
        operationIs(value, "read", "command")
      );
    case "lasso:coach":
      if (capability === "options") return coachKind(value) === "replay-intro";
      return capability === "x-content" && coachKind(value) !== "replay-intro";
    case "lasso:list-cache":
      return (
        (capability === "options" && operationIs(value, "all")) ||
        (capability === "x-content" && operationIs(value, "read", "begin", "commit"))
      );
    case "lasso:list-usage":
      return capability === "x-content" && operationIs(value, "record", "recent");
    case "lasso:mirror-status":
      return (
        (capability === "popup" && operationIs(value, "read")) ||
        (capability === "x-content" && operationIs(value, "report"))
      );
    case "lasso:collections":
      return collectionsCapability(capability, value);
    case "lasso:graphql-catalog":
      return capability === "x-content" && operationIs(value, "read", "begin", "commit");
    case "lasso:badge":
    case "lasso:state":
      return capability === "x-content";
    default:
      return false;
  }
}
