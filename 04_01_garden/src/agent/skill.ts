import type { SkillTemplate } from "./template";

interface ParsedSkillInvocation {
  skillName: string;
  arguments: string;
}

export interface ResolvedSkillContext {
  toolNames: string[];
  userMessage: string;
}

function parseSkillInvocation(userMessage: string): ParsedSkillInvocation | undefined {
  const trimmed = userMessage.trim();
  const match = trimmed.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;

  return {
    skillName: match[1].toLowerCase(),
    arguments: (match[2] ?? "").trim(),
  };
}

function findSkillByName(
  skills: SkillTemplate[],
  skillName: string,
): SkillTemplate | undefined {
  return skills.find((skill) => skill.name.toLowerCase() === skillName);
}

function buildSkillMetadata(
  invocation: ParsedSkillInvocation,
  skill: SkillTemplate,
): string {
  const metadata = {
    active_skill: {
      name: skill.name,
      arguments: invocation.arguments || null,
      allowed_tools: skill.allowedTools,
      runtime_scripts: skill.runtimeScripts,
      argument_hint: skill.argumentHint ?? null,
    },
  };

  return `<metadata>\n${JSON.stringify(metadata)}\n</metadata>`;
}

export function resolveSkillContext(
  userMessage: string,
  skills: SkillTemplate[],
  defaultToolNames: string[],
): ResolvedSkillContext {
  const invocation = parseSkillInvocation(userMessage);
  const invokedSkill = invocation
    ? findSkillByName(skills, invocation.skillName)
    : undefined;
  const toolNames =
    invokedSkill && invokedSkill.allowedTools.length > 0
      ? invokedSkill.allowedTools
      : defaultToolNames;

  if (!invokedSkill || !invocation) {
    return {
      toolNames,
      userMessage,
    };
  }

  const metadata = buildSkillMetadata(invocation, invokedSkill);
  const messageWithMetadata = [
    metadata,
    "<user_request>",
    userMessage,
    "</user_request>",
  ].join("\n");

  return {
    toolNames,
    userMessage: messageWithMetadata,
  };
}
