/** The complete persisted-query contract used by Lasso's GraphQL client. */
export const GRAPHQL_OPERATION_NAMES = [
  "ListAddMember",
  "ListRemoveMember",
  "UserByScreenName",
] as const;

export type GraphqlOperationName = (typeof GRAPHQL_OPERATION_NAMES)[number];

/** One complete operation contract. IDs and metadata must never be mixed. */
export interface GraphqlOperationDescriptor {
  queryId: string;
  features: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
}

/** Atomic descriptors for every internal GraphQL operation Lasso uses. */
export type GraphqlOperationCatalog = Record<GraphqlOperationName, GraphqlOperationDescriptor>;

const QUERY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BOOLEAN_FLAGS = 200;
const MAX_BOOLEAN_FLAG_NAME_LENGTH = 128;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const codePointsAtMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};

const isBooleanMap = (value: unknown): value is Record<string, boolean> =>
  isPlainRecord(value) &&
  Object.keys(value).length <= MAX_BOOLEAN_FLAGS &&
  Object.entries(value).every(
    ([key, item]) =>
      codePointsAtMost(key, MAX_BOOLEAN_FLAG_NAME_LENGTH) && typeof item === "boolean",
  );

/** X persisted-query IDs are short base64url tokens, never URL path fragments. */
export const isGraphqlQueryId = (value: unknown): value is string =>
  typeof value === "string" && QUERY_ID.test(value);

/** Reject an incomplete, extended, or oversized GraphQL operation catalog. */
export const isGraphqlCatalog = (value: unknown): value is GraphqlOperationCatalog =>
  isPlainRecord(value) &&
  Object.keys(value).length === GRAPHQL_OPERATION_NAMES.length &&
  hasOnlyKeys(value, GRAPHQL_OPERATION_NAMES) &&
  GRAPHQL_OPERATION_NAMES.every((name) => {
    const descriptor = value[name];
    return (
      isPlainRecord(descriptor) &&
      hasOnlyKeys(descriptor, ["queryId", "features", "fieldToggles"]) &&
      isGraphqlQueryId(descriptor.queryId) &&
      isBooleanMap(descriptor.features) &&
      (!Object.hasOwn(descriptor, "fieldToggles") || isBooleanMap(descriptor.fieldToggles))
    );
  });
