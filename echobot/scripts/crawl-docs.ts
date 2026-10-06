// Builds data/docs-index.json from Echo's public website.
//
// Echo's real product docs (docs.echohq.com, Mintlify) require a customer
// login, so this demo indexes the public echo.ai pages instead: the image
// catalog, product and use-case pages, the blog, and the glossary. In
// production the docs adapter would index the Mintlify MDX repo directly.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SITEMAP_URL = "https://www.echo.ai/sitemap.xml";
const INCLUDED_SECTIONS = new Set(["image-pulling", "product", "use-cases", "blog", "glossary"]);
const CONCURRENCY = 4;
const REQUEST_GAP_MS = 150;
const MAX_CHUNK_CHARS = 1800;

const OUT_FILE = path.join(import.meta.dirname, "..", "data", "docs-index.json");

export interface DocChunk {
  id: string;
  url: string;
  title: string;
  section: string;
  text: string;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "EchoBot-demo-crawler/0.1" } });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.text();
}

async function listPageUrls(): Promise<string[]> {
  const xml = await fetchText(SITEMAP_URL);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
  return urls.filter((url) => {
    const section = new URL(url).pathname.split("/")[1] ?? "";
    return INCLUDED_SECTIONS.has(section) && new URL(url).pathname.split("/").length > 2;
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function extractTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Untitled";
  return decodeEntities(title.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractMainText(html: string): string {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const withBreaks = main
    .replace(/<(script|style|nav|header|footer|form|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/pre|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${line}\n`;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

async function crawlPage(url: string): Promise<DocChunk[]> {
  const html = await fetchText(url);
  const title = extractTitle(html);
  const section = new URL(url).pathname.split("/")[1] ?? "";
  return chunkText(extractMainText(html)).map((text, i) => ({
    id: `${url}#${i}`,
    url,
    title,
    section,
    text,
  }));
}

async function crawlAll(urls: string[]): Promise<DocChunk[]> {
  const chunks: DocChunk[] = [];
  const queue = [...urls];
  const failures: string[] = [];

  async function worker(): Promise<void> {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        chunks.push(...(await crawlPage(url)));
      } catch (error) {
        failures.push(`${url}: ${(error as Error).message}`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length > 0) console.warn(`Skipped ${failures.length} pages:\n${failures.join("\n")}`);
  return chunks.sort((a, b) => a.id.localeCompare(b.id));
}

const urls = await listPageUrls();
console.log(`Crawling ${urls.length} pages from echo.ai`);
const chunks = await crawlAll(urls);
await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(
  OUT_FILE,
  JSON.stringify({ crawledAt: new Date().toISOString(), source: SITEMAP_URL, chunks }, null, 1),
);
console.log(`Wrote ${chunks.length} chunks from ${new Set(chunks.map((c) => c.url)).size} pages to ${OUT_FILE}`);
