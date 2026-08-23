import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType } from "convex/server";

// convex/_generated lives outside src/; this is the only Folder source file
// that names generated Convex references.
import { api } from "../../../convex/_generated/api";
import {
  boundedReplicaCalls,
  ConvexFolderReplica,
  type ConvexReplicaCalls,
} from "./convex-replica";
import type { CollectionReplicaRemote, ReplicaPullResponse, ReplicaPushResponse } from "./replica";

type Assignable<Source, Target> = Source extends Target ? true : false;

const ASSERT_PUSH: Assignable<
  FunctionReturnType<typeof api.folderReplica.push>,
  ReplicaPushResponse
> = true;
const ASSERT_PULL: Assignable<
  FunctionReturnType<typeof api.folderReplica.pull>,
  ReplicaPullResponse
> = true;
void ASSERT_PUSH;
void ASSERT_PULL;

/**
 * One Convex call may take at most this long. Well under Chrome's MV3 worker
 * lifetime, so a stalled endpoint ends the sync as "offline" instead of the
 * worker dying mid-reply.
 */
const REPLICA_CALL_TIMEOUT_MS = 20_000;

/** Builds the MV3-safe HTTP client for one configured personal Convex replica. */
export function buildConvexFolderReplica(cfg: {
  url: string;
  deviceKey: string;
}): CollectionReplicaRemote {
  const http = new ConvexHttpClient(cfg.url);
  const calls: ConvexReplicaCalls = {
    mutation: (ref, args) => http.mutation(ref as FunctionReference<"mutation">, args),
    query: (ref, args) => http.query(ref as FunctionReference<"query">, args),
  };
  return new ConvexFolderReplica(
    boundedReplicaCalls(calls, REPLICA_CALL_TIMEOUT_MS),
    api.folderReplica,
    cfg.deviceKey,
  );
}
