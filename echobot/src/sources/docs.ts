// Docs adapter. Searches the real public echo.ai pages (built by
// `bun crawl-docs`) plus a few illustrative pages standing in for Echo's
// login-gated Mintlify docs. In production this would index the Mintlify MDX
// repo instead.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import MiniSearch from "minisearch";
import type { DocHit, DocsSource } from "./types.ts";
import gatedDocs from "./fixtures/docs-gated.json" with { type: "json" };
import { tokenize } from "./keywordSearch.ts";

const INDEX_FILE = path.join(import.meta.dirname, "..", "..", "data", "docs-index.json");
const EXCERPT_CHARS = 1400;

/** Product docs outrank catalog pages, which outrank marketing and the blog. */
const SECTION_WEIGHT: Record<string, number> = {
  docs: 1.8,
  "image-pulling": 1.4,
  product: 1.1,
  "use-cases": 1.0,
  glossary: 0.9,
  blog: 0.7,
};

interface IndexedChunk {
  id: string;
  url: string;
  title: string;
  section: string;
  text: string;
  illustrative: boolean;
}

interface CrawledIndex {
  chunks: Omit<IndexedChunk, "illustrative">[];
}

export async function createDocsSource(): Promise<DocsSource> {
  if (!existsSync(INDEX_FILE)) {
    throw new Error(`Docs index not found at ${INDEX_FILE}. Run \`bun crawl-docs\` first.`);
  }
  const crawled = JSON.parse(await readFile(INDEX_FILE, "utf8")) as CrawledIndex;
  const chunks: IndexedChunk[] = [
    ...crawled.chunks.map((c) => ({ ...c, illustrative: false })),
    ...gatedDocs.pages.map((p) => ({ id: p.url, url: p.url, title: p.title, section: "docs", text: p.body, illustrative: true })),
  ];

  const search = new MiniSearch<IndexedChunk>({
    fields: ["title", "text"],
    storeFields: ["url", "title", "section", "text", "illustrative"],
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: 0.1,
      boostDocument: (_id, _term, stored) => SECTION_WEIGHT[String(stored?.section)] ?? 1,
    },
  });
  search.addAll(chunks);

  return {
    async search(query, limit) {
      const seen = new Set<string>();
      const hits: DocHit[] = [];
      for (const result of search.search(query)) {
        const chunk = result as unknown as IndexedChunk;
        if (seen.has(chunk.url)) continue;
        seen.add(chunk.url);
        hits.push({ url: chunk.url, title: chunk.title, excerpt: excerptFor(chunk.text, query), illustrative: chunk.illustrative });
        if (hits.length >= limit) break;
      }
      return hits;
    },
  };
}

function excerptFor(text: string, query: string): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const lower = text.toLowerCase();
  const firstHit = tokenize(query)
    .map((term) => lower.indexOf(term))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (firstHit ?? 0) - 200);
  return text.slice(start, start + EXCERPT_CHARS);
}
