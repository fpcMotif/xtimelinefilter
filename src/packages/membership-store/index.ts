/** membership-store facade: identity + null-object live in lib/; the store
 *  implementations (factory, live, convex, convex-client) and types are
 *  their own root entry points. */
export { membershipIdentityOf } from "./lib/identity";
export { NullMembershipStore } from "./lib/null";
