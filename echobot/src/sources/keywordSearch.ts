// A small term-overlap scorer for the mock adapters. The real Notion and
// GitHub adapters would use those APIs' own search instead.

const STOP_WORDS = new Set(["the", "a", "an", "is", "in", "on", "of", "to", "for", "and", "or", "my", "with", "how", "do", "i", "what", "why", "does", "it", "inside"]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.-]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function rankByKeywords<T>(items: T[], query: string, textOf: (item: T) => string, limit: number): T[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  return items
    .map((item) => {
      const haystack = textOf(item).toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
