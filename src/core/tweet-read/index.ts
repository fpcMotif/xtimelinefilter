/**
 * tweet-read — the one home that reads a known tweet article into its knowable
 * parts. author() and identity() share the private status.ts core; facets() is a
 * co-located reader. Callers (scanner, filter, overlay, DOM backend) import only
 * this facade; status.ts is never re-exported.
 */
export { author, getTweetType, type TweetType } from "./author";
export { facets } from "./facets";
export { identity } from "./identity";
