/** Subsequence score; null if `query` is not a subsequence of `text`. Lower = tighter. */
export function fuzzyScore(query: string, text: string): number | null {
  let from = 0;
  let score = 0;
  let prev = -1;
  for (const ch of query) {
    const idx = text.indexOf(ch, from);
    if (idx === -1) return null;
    score += idx - prev - 1;
    prev = idx;
    from = idx + 1;
  }
  return score;
}

/** Rank items whose key fuzzily matches the query (tightest first); empty query keeps order. */
export function fuzzyRank<T>(query: string, items: readonly T[], key: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items
    .map((item) => ({ item, s: fuzzyScore(q, key(item).toLowerCase()) }))
    .filter((x): x is { item: T; s: number } => x.s !== null)
    .toSorted((a, b) => a.s - b.s || key(a.item).localeCompare(key(b.item)))
    .map((x) => x.item);
}
