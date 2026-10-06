import { createDocsSource } from "./docs.ts";
import { createMockGitHub, createMockLinear, createMockNotion, createMockRetool } from "./mocks.ts";
import type { Sources } from "./types.ts";

export async function createSources(): Promise<Sources> {
  return {
    docs: await createDocsSource(),
    github: createMockGitHub(),
    notion: createMockNotion(),
    retool: createMockRetool(),
    linear: createMockLinear(),
  };
}
