import { statusId } from "./status";

/**
 * Stable per-tweet identity when X has exposed one. Visible text is not identity:
 * distinct posts can share it, and media-only posts have none.
 */
export function identity(article: Element): string | null {
  return statusId(article);
}
