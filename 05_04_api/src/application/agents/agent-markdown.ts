import matter from 'gray-matter'
import { z } from 'zod'

import {
  type AgentKind,
  type AgentVisibility,
  agentKindValues,
  agentVisibilityValues,
  type DelegationMode,
  delegationModeValues,
} from '../../domain/agents/agent-types'
import type { DomainError } from '../../shared/errors'
import { type AgentId, type AgentRevisionId, asAgentId, asAgentRevisionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'

const frontmatterFence = '---'
const agentSlugPattern = /^[a-z0-9][a-z0-9_-]*$/

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    agentSlugPattern,
    'must be a lowercase slug using letters, numbers, underscores, or hyphens',
  )

const rawAgentMarkdownFrontmatterSchema = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    kind: z.enum(agentKindValues),
    memory: z
      .object({
        child_promotion: z.string().trim().min(1).optional(),
        profile_scope: z.boolean().optional(),
      })
      .strict()
      .optional(),
    model: z
      .object({
        model_alias: z.string().trim().min(1),
        provider: z.string().trim().min(1),
        reasoning: z
          .object({
            effort: z.string().trim().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    name: z.string().trim().min(1).max(200),
    revision_id: z.string().trim().min(1).optional(),
    schema: z.literal('agent/v1'),
    slug: slugSchema,
    subagents: z
      .array(
        z
          .object({
            alias: z.string().trim().min(1).max(120),
            mode: z.enum(delegationModeValues),
            slug: slugSchema,
          })
          .strict(),
      )
      .optional(),
    tools: z
      .object({
        mcp_profile: z.string().trim().min(1).nullable().optional(),
        tool_profile_id: z.string().trim().min(1).nullable().optional(),
        native: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
    visibility: z.enum(agentVisibilityValues),
    workspace: z
      .object({
        strategy: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const nativeTools = value.tools?.native ?? []
    const duplicateNativeTool = nativeTools.find(
      (tool, index) => nativeTools.indexOf(tool) !== index,
    )

    if (duplicateNativeTool) {
      context.addIssue({
        code: 'custom',
        message: `tools.native contains duplicate entry "${duplicateNativeTool}"`,
        path: ['tools', 'native'],
      })
    }

    const subagents = value.subagents ?? []
    const duplicateAlias = subagents.find(
      (subagent, index) =>
        subagents.findIndex((candidate) => candidate.alias === subagent.alias) !== index,
    )

    if (duplicateAlias) {
      context.addIssue({
        code: 'custom',
        message: `subagents contains duplicate alias "${duplicateAlias.alias}"`,
        path: ['subagents'],
      })
    }

    const duplicateSlug = subagents.find(
      (subagent, index) =>
        subagents.findIndex((candidate) => candidate.slug === subagent.slug) !== index,
    )

    if (duplicateSlug) {
      context.addIssue({
        code: 'custom',
        message: `subagents contains duplicate slug "${duplicateSlug.slug}"`,
        path: ['subagents'],
      })
    }
  })

export type RawAgentMarkdownFrontmatter = z.infer<typeof rawAgentMarkdownFrontmatterSchema>

export interface AgentMarkdownSubagent {
  alias: string
  mode: DelegationMode
  slug: string
}

export interface AgentMarkdownFrontmatter {
  agentId?: AgentId
  description?: string
  kind: AgentKind
  memory?: {
    childPromotion?: string
    profileScope?: boolean
  }
  model?: {
    modelAlias: string
    provider: string
    reasoning?: {
      effort: string
    }
  }
  name: string
  revisionId?: AgentRevisionId
  schema: 'agent/v1'
  slug: string
  subagents?: AgentMarkdownSubagent[]
  tools?: {
    toolProfileId?: string | null
    native?: string[]
  }
  visibility: AgentVisibility
  workspace?: {
    strategy: string
  }
}

export interface AgentMarkdownDocument {
  frontmatter: AgentMarkdownFrontmatter
  instructionsMd: string
}

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, '\n')

const normalizeInstructionsMd = (value: string): string => normalizeNewlines(value).trim()

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

const toTypedFrontmatter = (value: RawAgentMarkdownFrontmatter): AgentMarkdownFrontmatter => ({
  agentId: value.agent_id ? asAgentId(value.agent_id) : undefined,
  description: value.description,
  kind: value.kind,
  memory: value.memory
    ? {
        childPromotion: value.memory.child_promotion,
        profileScope: value.memory.profile_scope,
      }
    : undefined,
  model: value.model
    ? {
        modelAlias: value.model.model_alias,
        provider: value.model.provider,
        reasoning: value.model.reasoning
          ? {
              effort: value.model.reasoning.effort,
            }
          : undefined,
      }
    : undefined,
  name: value.name,
  revisionId: value.revision_id ? asAgentRevisionId(value.revision_id) : undefined,
  schema: value.schema,
  slug: value.slug,
  subagents: value.subagents?.map((subagent) => ({
    alias: subagent.alias,
    mode: subagent.mode,
    slug: subagent.slug,
  })),
  tools: value.tools
    ? {
        toolProfileId: value.tools.tool_profile_id ?? value.tools.mcp_profile,
        native: value.tools.native,
      }
    : undefined,
  visibility: value.visibility,
  workspace: value.workspace
    ? {
        strategy: value.workspace.strategy,
      }
    : undefined,
})

export const toAgentMarkdownFrontmatterJson = (
  value: AgentMarkdownFrontmatter,
): RawAgentMarkdownFrontmatter => ({
  ...(value.agentId ? { agent_id: value.agentId } : {}),
  ...(value.description ? { description: value.description } : {}),
  kind: value.kind,
  ...(value.memory
    ? {
        memory: {
          ...(value.memory.childPromotion ? { child_promotion: value.memory.childPromotion } : {}),
          ...(value.memory.profileScope !== undefined
            ? { profile_scope: value.memory.profileScope }
            : {}),
        },
      }
    : {}),
  ...(value.model
    ? {
        model: {
          model_alias: value.model.modelAlias,
          provider: value.model.provider,
          ...(value.model.reasoning
            ? {
                reasoning: {
                  effort: value.model.reasoning.effort,
                },
              }
            : {}),
        },
      }
    : {}),
  name: value.name,
  ...(value.revisionId ? { revision_id: value.revisionId } : {}),
  schema: value.schema,
  slug: value.slug,
  ...(value.subagents && value.subagents.length > 0
    ? {
        subagents: value.subagents.map((subagent) => ({
          alias: subagent.alias,
          mode: subagent.mode,
          slug: subagent.slug,
        })),
      }
    : {}),
  ...(value.tools
    ? {
        tools: {
          ...(value.tools.toolProfileId !== undefined
            ? { tool_profile_id: value.tools.toolProfileId }
            : {}),
          ...(value.tools.native && value.tools.native.length > 0
            ? { native: value.tools.native }
            : {}),
        },
      }
    : {}),
  visibility: value.visibility,
  ...(value.workspace
    ? {
        workspace: {
          strategy: value.workspace.strategy,
        },
      }
    : {}),
})

const parseFrontmatterJson = (value: unknown): Result<AgentMarkdownFrontmatter, DomainError> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return toValidationError('agent frontmatter must be a YAML object')
  }

  const parsed = rawAgentMarkdownFrontmatterSchema.safeParse(value)

  if (!parsed.success) {
    return toValidationError(formatZodError(parsed.error))
  }

  return ok(toTypedFrontmatter(parsed.data))
}

export const parseAgentMarkdown = (
  markdown: string,
): Result<AgentMarkdownDocument, DomainError> => {
  const normalized = normalizeNewlines(markdown)

  if (!normalized.startsWith(`${frontmatterFence}\n`)) {
    return toValidationError('agent markdown must start with frontmatter delimited by ---')
  }

  let parsedMatter: matter.GrayMatterFile<string>

  try {
    parsedMatter = matter(normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown frontmatter parse failure'

    return toValidationError(`invalid agent frontmatter: ${message}`)
  }

  if (Object.keys(parsedMatter.data ?? {}).length === 0) {
    return toValidationError('agent markdown frontmatter cannot be empty')
  }

  const rawTools =
    parsedMatter.data &&
    typeof parsedMatter.data === 'object' &&
    !Array.isArray(parsedMatter.data) &&
    parsedMatter.data.tools &&
    typeof parsedMatter.data.tools === 'object' &&
    !Array.isArray(parsedMatter.data.tools)
      ? (parsedMatter.data.tools as Record<string, unknown>)
      : null

  if (rawTools && rawTools.mcp_profile !== undefined) {
    return toValidationError('tools.mcp_profile is no longer supported; use tools.tool_profile_id')
  }

  const frontmatter = parseFrontmatterJson(parsedMatter.data)

  if (!frontmatter.ok) {
    return frontmatter
  }

  const instructionsMd = normalizeInstructionsMd(parsedMatter.content)

  if (instructionsMd.length === 0) {
    return toValidationError('agent markdown body cannot be empty')
  }

  return ok({
    frontmatter: frontmatter.value,
    instructionsMd,
  })
}

export const parseStoredAgentFrontmatter = (
  value: Record<string, unknown>,
): Result<AgentMarkdownFrontmatter, DomainError> => parseFrontmatterJson(value)

export const serializeAgentMarkdown = (document: AgentMarkdownDocument): string => {
  const frontmatterJson = toAgentMarkdownFrontmatterJson(document.frontmatter)
  const serialized = matter.stringify(
    normalizeInstructionsMd(document.instructionsMd),
    frontmatterJson,
    {
      delimiters: frontmatterFence,
      language: 'yaml',
    },
  )

  return `${normalizeNewlines(serialized).trimEnd()}\n`
}
