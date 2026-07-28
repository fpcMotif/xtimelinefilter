/**
 * tweet-read — the one home that reads a known tweet article into its knowable
 * parts. author() and identity() share the private lib/status.ts core; facets()
 * and capture() are co-located readers. Callers (scanner, filter, overlay, DOM
 * backend) import only this facade; lib/status.ts is never re-exported.
 *
 * Two of these reads answer "which post is this", and they are NOT
 * interchangeable: identity() is the scanner's recycle-safe per-cell key, loose
 * by design and never persisted; capture() is the durable capture, host-scoped
 * and origin-checked, and is the only one fit to be written down.
 */
export { author, getTweetType, type TweetType } from "./lib/author";
export { capture, type TweetCapture } from "./lib/capture";
export { facets } from "./lib/facets";
export { identity } from "./lib/identity";
