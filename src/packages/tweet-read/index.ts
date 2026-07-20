/**
 * tweet-read — the one home that reads a known tweet article into its knowable
 * parts. author() and identity() share the private lib/status.ts core; facets() is a
 * co-located reader. Callers (scanner, filter, overlay, DOM backend) import only
 * this facade; lib/status.ts is never re-exported.
 */
export { author, getTweetType, type TweetType } from "./lib/author";
export { facets } from "./lib/facets";
export { identity } from "./lib/identity";
