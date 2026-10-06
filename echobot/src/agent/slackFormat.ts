// Converts the Markdown habits models fall back on into Slack mrkdwn.
// Code blocks are left untouched.

export function toSlackMrkdwn(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((segment, i) => (i % 2 === 1 ? segment : convertProse(segment)))
    .join("");
}

function convertProse(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}
