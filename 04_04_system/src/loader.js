/*
  Agent profile loader — reads agent definitions from workspace/system/agents/*.md

  Each agent file is markdown with frontmatter that declares the agent's
  model, tools, and description. The content is the system prompt.

  loadAgent("alice") → { name, description, model, toolNames, instructions }
*/

import matter from "gray-matter";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AGENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../workspace/system/agents",
);

export const loadAgent = async (name) => {
  const raw = await readFile(join(AGENTS_DIR, `${name}.md`), "utf-8");
  const { data, content } = matter(raw);

  return {
    name: data.title ?? name,
    description: data.description ?? "",
    model: data.model ?? "gpt-4.1-mini",
    toolNames: data.tools ?? [],
    instructions: content.trim(),
  };
};
