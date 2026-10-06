// Verifies every link in an answer came from a tool result in this request.
// Models produce plausible URLs that don't exist; this catches them.

const SLACK_LINK = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/g;
// A URL needs a real host, so prose like "an `https://` URL" isn't mistaken for a link.
const BARE_URL = /https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>|()`]*/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"*_`]+$/;

function normalize(url: string): string {
  return url.replace(TRAILING_PUNCTUATION, "");
}

export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(SLACK_LINK)) urls.add(normalize(match[1] ?? ""));
  const withoutSlackLinks = text.replace(SLACK_LINK, " ");
  for (const match of withoutSlackLinks.matchAll(BARE_URL)) urls.add(normalize(match[0]));
  urls.delete("");
  return [...urls];
}

export interface CitationCheck {
  cited: string[];
  unverified: string[];
}

export function checkCitations(text: string, knownUrls: Iterable<string>): CitationCheck {
  const known = new Set(knownUrls);
  const cited = extractUrls(text);
  return { cited, unverified: cited.filter((url) => !known.has(url)) };
}
