import { basename, dirname, extname, join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import matter from "gray-matter";

const REPO_ROOT = join(import.meta.dir, "../..");
const SYSTEM_DIR = join(import.meta.dir, "../../vault/system");
const WORKFLOWS_DIR = join(SYSTEM_DIR, "workflows");
const SKILLS_DIR = join(SYSTEM_DIR, "skills");
const SKILL_SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"]);

export interface AgentTemplate {
  name: string;
  model: string;
  tools: string[];
  instructions: string;
  skills: SkillTemplate[];
}

async function loadWorkflows(): Promise<string> {
  let entries: string[];
  try {
    entries = (await readdir(WORKFLOWS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return "";
  }

  if (entries.length === 0) return "";

  const sections: string[] = [];
  for (const file of entries) {
    const raw = await Bun.file(join(WORKFLOWS_DIR, file)).text();
    const { data, content } = matter(raw);
    const name = data.name ?? file.replace(/\.md$/, "");
    const description = data.description ?? "";
    sections.push(`### ${name}\n${description}\n\n${content.trim()}`);
  }

  return `\n\n## Workflows\n\nYou MUST follow a workflow when the user's request matches one. Follow every step exactly — do not skip saving results.\n\n${sections.join("\n\n")}`;
}

export interface SkillTemplate {
  name: string;
  description: string;
  relativePath: string;
  runtimeScripts: string[];
  disableModelInvocation: boolean;
  userInvocable: boolean;
  argumentHint?: string;
  allowedTools: string[];
  instructions: string;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeRepoRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isSkillRuntimeScript(path: string): boolean {
  return SKILL_SCRIPT_EXTENSIONS.has(extname(path).toLowerCase());
}

function resolveRuntimeScriptPath(skillDir: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const absoluteCandidate = trimmed.startsWith("vault/system/skills/")
    ? join(REPO_ROOT, trimmed)
    : join(skillDir, trimmed);

  const relativePath = normalizeRepoRelativePath(relative(REPO_ROOT, absoluteCandidate));
  if (
    relativePath === "" ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    return undefined;
  }

  if (!relativePath.startsWith("vault/system/skills/")) return undefined;
  if (!relativePath.includes("/scripts/")) return undefined;
  if (!isSkillRuntimeScript(relativePath)) return undefined;
  return relativePath;
}

async function collectRuntimeScripts(skillDir: string): Promise<string[]> {
  const scriptsDir = join(skillDir, "scripts");
  const collected: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = normalizeRepoRelativePath(relative(REPO_ROOT, full));
      if (!relativePath.startsWith("vault/system/skills/")) continue;
      if (!relativePath.includes("/scripts/")) continue;
      if (!isSkillRuntimeScript(relativePath)) continue;
      collected.push(relativePath);
    }
  }

  try {
    await walk(scriptsDir);
  } catch {
    return [];
  }

  collected.sort((a, b) => a.localeCompare(b));
  return collected;
}

async function collectSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(full)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(full);
    }
  }

  return files;
}

function formatSkill(skill: SkillTemplate): string {
  const metadata: string[] = [
    `source: ${skill.relativePath}`,
    `description: ${skill.description || "(none)"}`,
    `disable-model-invocation: ${skill.disableModelInvocation}`,
    `user-invocable: ${skill.userInvocable}`,
  ];

  if (skill.argumentHint) {
    metadata.push(`argument-hint: ${skill.argumentHint}`);
  }

  if (skill.allowedTools.length > 0) {
    metadata.push(`allowed-tools: ${skill.allowedTools.join(", ")}`);
  }

  if (skill.runtimeScripts.length > 0) {
    metadata.push(`runtime-scripts: ${skill.runtimeScripts.join(", ")}`);
  }

  return `### ${skill.name}\n${metadata.map((line) => `- ${line}`).join("\n")}\n\n${skill.instructions}`;
}

interface LoadedSkills {
  section: string;
  skills: SkillTemplate[];
}

async function loadSkills(): Promise<LoadedSkills> {
  let files: string[];
  try {
    files = await collectSkillFiles(SKILLS_DIR);
  } catch {
    return { section: "", skills: [] };
  }

  if (files.length === 0) return { section: "", skills: [] };

  files.sort((a, b) => a.localeCompare(b));

  const skills: SkillTemplate[] = [];
  for (const file of files) {
    const raw = await Bun.file(file).text();
    const { data, content } = matter(raw);
    const skillDir = dirname(file);

    const fallbackName = basename(dirname(file));
    const name = parseString(data.name) ?? fallbackName;
    const description = parseString(data.description) ?? "";
    const argumentHint = parseString(data["argument-hint"]);
    const disableModelInvocation = parseBoolean(data["disable-model-invocation"], false);
    const userInvocable = parseBoolean(data["user-invocable"], true);
    const allowedTools = parseStringList(data["allowed-tools"]);
    const declaredSingleRuntimeScript = parseString(data["runtime-script"]);
    const declaredRuntimeScripts = [
      ...parseStringList(data["runtime-scripts"]),
      ...(declaredSingleRuntimeScript ? [declaredSingleRuntimeScript] : []),
    ]
      .map((value) => resolveRuntimeScriptPath(skillDir, value))
      .filter((value): value is string => Boolean(value));
    const discoveredRuntimeScripts = await collectRuntimeScripts(skillDir);
    const runtimeScripts = [...new Set([...declaredRuntimeScripts, ...discoveredRuntimeScripts])];
    runtimeScripts.sort((a, b) => a.localeCompare(b));

    skills.push({
      name,
      description,
      relativePath: relative(SYSTEM_DIR, file),
      runtimeScripts,
      disableModelInvocation,
      userInvocable,
      argumentHint,
      allowedTools,
      instructions: content.trim(),
    });
  }

  if (skills.length === 0) return { section: "", skills: [] };

  const sections = skills.map(formatSkill);
  return {
    section: `\n\n## Skills\n\nYou have skills available from vault/system/skills.\nSelect and apply a skill when its description matches the user's request.\nIf the user explicitly invokes "/<skill-name>", prioritize that skill.\nFor skills with disable-model-invocation=true, only use them when explicitly invoked.\nWhen a skill is selected, follow its instructions exactly.\nIf a skill provides runtime scripts, prefer executing them via code_mode "script_path" instead of rewriting the same logic inline.\n\n${sections.join("\n\n")}`,
    skills,
  };
}

export async function loadTemplate(agent: string): Promise<AgentTemplate> {
  const path = join(SYSTEM_DIR, `${agent}.agent.md`);
  const raw = await Bun.file(path).text();
  const { data, content } = matter(raw);

  const workflows = await loadWorkflows();
  const loadedSkills = await loadSkills();
  const today = new Date().toISOString().slice(0, 10);
  const instructions = [workflows, loadedSkills.section, content.trim()]
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("{{date}}", today);

  return {
    name: data.name ?? agent,
    model: data.model ?? "gpt-5.2",
    tools: data.tools ?? [],
    instructions,
    skills: loadedSkills.skills,
  };
}
