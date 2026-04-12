import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import { type AgentRecord, createAgentRepository } from '../../domain/agents/agent-repository'
import { createAgentRevisionRepository } from '../../domain/agents/agent-revision-repository'
import { createAgentSubagentLinkRepository } from '../../domain/agents/agent-subagent-link-repository'
import type { AgentKind, AgentVisibility } from '../../domain/agents/agent-types'
import { createAccountPreferencesRepository } from '../../domain/preferences/account-preferences-repository'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  type AgentRevisionId,
  asAgentRevisionId,
  createPrefixedId,
  type ToolProfileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { canEditAgent, canReadAgent, canWriteAgents } from './agent-access'
import { getAgentDescription } from './agent-capabilities'
import {
  type AgentMarkdownDocument,
  type AgentMarkdownSubagent,
  parseAgentMarkdown,
  serializeAgentMarkdown,
} from './agent-markdown'
import {
  type AgentMarkdownExport,
  type CreateAgentSyncServiceDependencies,
  createAgentSyncService,
} from './agent-sync-service'

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

const structuredAgentInputSchema = z.object({
  description: z.string().trim().max(500).optional(),
  instructionsMd: z.string().trim().min(1),
  kind: z.enum(['primary', 'specialist', 'derived']),
  memory: z
    .object({
      childPromotion: z.string().trim().min(1).optional(),
      profileScope: z.boolean().optional(),
    })
    .strict()
    .optional(),
  model: z
    .object({
      modelAlias: z.string().trim().min(1),
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
  slug: slugSchema,
  subagents: z
    .array(
      z
        .object({
          alias: z.string().trim().min(1).max(120),
          mode: z.literal('async_join'),
          slug: slugSchema,
        })
        .strict(),
    )
    .optional(),
  tools: z
    .object({
      toolProfileId: z.string().trim().min(1).nullable().optional(),
      native: z.array(z.string().trim().min(1)).optional(),
    })
    .strict()
    .optional(),
  visibility: z.enum(['account_private', 'tenant_shared', 'system']),
  workspace: z
    .object({
      strategy: z.string().trim().min(1),
    })
    .strict()
    .optional(),
})

const createAgentInputSchema = structuredAgentInputSchema

const updateAgentInputSchema = structuredAgentInputSchema.extend({
  revisionId: z.string().trim().min(1),
})

const markdownUpdateInputSchema = z.object({
  markdown: z.string().trim().min(1),
})

export type CreateAgentInput = z.infer<typeof createAgentInputSchema>
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>
export type MarkdownUpdateInput = z.infer<typeof markdownUpdateInputSchema>

export interface AgentSummary {
  activeRevisionId: AgentRevisionId | null
  activeRevisionVersion: number | null
  createdAt: string
  description: string | null
  id: AgentId
  isDefaultForAccount: boolean
  kind: AgentKind
  name: string
  ownerAccountId: AccountId | null
  slug: string
  status: AgentRecord['status']
  updatedAt: string
  visibility: AgentVisibility
}

export interface AgentDetail extends AgentSummary {
  activeRevision: null | {
    checksumSha256: string
    createdAt: string
    createdByAccountId: AccountId | null
    frontmatterJson: Record<string, unknown>
    id: AgentRevisionId
    instructionsMd: string
    memoryPolicyJson: Record<string, unknown>
    modelConfigJson: Record<string, unknown>
    resolvedConfigJson: Record<string, unknown>
    sourceMarkdown: string
    toolProfileId: ToolProfileId | null
    toolPolicyJson: Record<string, unknown>
    version: number
    workspacePolicyJson: Record<string, unknown>
  }
  subagents: Array<{
    alias: string
    childAgentId: AgentId
    childDescription: string | null
    childName: string
    childSlug: string
    delegationMode: AgentMarkdownSubagent['mode']
    position: number
  }>
}

export interface DeleteAgentResult {
  agentId: AgentId
  deleted: true
}

export interface ListAgentsOptions {
  kind?: AgentKind
  limit?: number
  status?: AgentRecord['status']
  visibility?: AgentVisibility
}

export interface AgentManagementService {
  createAgent: (scope: TenantScope, input: CreateAgentInput) => Result<AgentDetail, DomainError>
  deleteAgent: (scope: TenantScope, agentId: AgentId) => Result<DeleteAgentResult, DomainError>
  exportAgentMarkdown: (
    scope: TenantScope,
    agentId: AgentId,
  ) => Result<AgentMarkdownExport, DomainError>
  getAgentById: (scope: TenantScope, agentId: AgentId) => Result<AgentDetail, DomainError>
  listAgents: (
    scope: TenantScope,
    options?: ListAgentsOptions,
  ) => Result<AgentSummary[], DomainError>
  updateAgent: (
    scope: TenantScope,
    agentId: AgentId,
    input: UpdateAgentInput,
  ) => Result<AgentDetail, DomainError>
  updateAgentMarkdown: (
    scope: TenantScope,
    agentId: AgentId,
    input: MarkdownUpdateInput,
  ) => Result<AgentDetail, DomainError>
}

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

const parseWithSchema = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
): Result<TValue, DomainError> => {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: formatZodError(parsed.error),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const parseCreateAgentInput = (input: unknown): Result<CreateAgentInput, DomainError> =>
  parseWithSchema(createAgentInputSchema, input)

export const parseUpdateAgentInput = (input: unknown): Result<UpdateAgentInput, DomainError> =>
  parseWithSchema(updateAgentInputSchema, input)

export const parseMarkdownUpdateInput = (
  input: unknown,
): Result<MarkdownUpdateInput, DomainError> => parseWithSchema(markdownUpdateInputSchema, input)

const requireWritableScope = (scope: TenantScope): Result<null, DomainError> => {
  if (canWriteAgents(scope.role)) {
    return ok(null)
  }

  return err({
    message: `tenant role ${scope.role} cannot modify agents`,
    type: 'permission',
  })
}

const toMarkdownTools = (
  tools:
    | AgentMarkdownDocument['frontmatter']['tools']
    | NonNullable<CreateAgentInput['tools']>
    | NonNullable<UpdateAgentInput['tools']>
    | undefined,
): AgentMarkdownDocument['frontmatter']['tools'] | undefined => {
  if (!tools) {
    return undefined
  }

  const normalizedNative =
    Array.isArray(tools.native) && tools.native.length > 0 ? [...tools.native] : undefined
  const normalizedToolProfileId = tools.toolProfileId

  if (!normalizedNative && normalizedToolProfileId === undefined) {
    return undefined
  }

  return {
    ...(normalizedToolProfileId !== undefined
      ? { toolProfileId: normalizedToolProfileId }
      : {}),
    ...(normalizedNative ? { native: normalizedNative } : {}),
  }
}

const toStructuredMarkdownDocument = (
  input: CreateAgentInput | UpdateAgentInput,
  overrides: {
    agentId?: AgentId
    revisionId?: AgentRevisionId
  } = {},
): AgentMarkdownDocument => ({
  frontmatter: {
    ...(overrides.agentId ? { agentId: overrides.agentId } : {}),
    ...(input.description ? { description: input.description } : {}),
    kind: input.kind,
    ...(input.memory
      ? {
          memory: {
            ...(input.memory.childPromotion ? { childPromotion: input.memory.childPromotion } : {}),
            ...(input.memory.profileScope !== undefined
              ? { profileScope: input.memory.profileScope }
              : {}),
          },
        }
      : {}),
    ...(input.model
      ? {
          model: {
            modelAlias: input.model.modelAlias,
            provider: input.model.provider,
            ...(input.model.reasoning
              ? {
                  reasoning: {
                    effort: input.model.reasoning.effort,
                  },
                }
              : {}),
          },
        }
      : {}),
    name: input.name,
    ...(overrides.revisionId ? { revisionId: overrides.revisionId } : {}),
    schema: 'agent/v1',
    slug: input.slug,
    ...(input.subagents ? { subagents: input.subagents } : {}),
    ...(toMarkdownTools(input.tools)
      ? {
          tools: toMarkdownTools(input.tools),
        }
      : {}),
    visibility: input.visibility,
    ...(input.workspace
      ? {
          workspace: {
            strategy: input.workspace.strategy,
          },
        }
      : {}),
  },
  instructionsMd: input.instructionsMd,
})

const toMergedStructuredUpdateDocument = (
  current: AgentMarkdownDocument | null,
  input: UpdateAgentInput,
  agentId: AgentId,
): AgentMarkdownDocument => ({
  frontmatter: {
    agentId,
    description:
      input.description !== undefined
        ? input.description || undefined
        : current?.frontmatter.description,
    kind: input.kind,
    memory: input.memory ?? current?.frontmatter.memory,
    model: input.model ?? current?.frontmatter.model,
    name: input.name,
    revisionId: asAgentRevisionId(input.revisionId),
    schema: 'agent/v1',
    slug: input.slug,
    subagents: input.subagents ?? current?.frontmatter.subagents,
    tools: input.tools ? toMarkdownTools(input.tools) : current?.frontmatter.tools,
    visibility: input.visibility,
    workspace: input.workspace ?? current?.frontmatter.workspace,
  },
  instructionsMd: input.instructionsMd,
})

const summarizeAgent = (
  agent: AgentRecord,
  input: {
    activeRevisionVersion: number | null
    description: string | null
    isDefaultForAccount: boolean
  },
): AgentSummary => ({
  activeRevisionId: agent.activeRevisionId,
  activeRevisionVersion: input.activeRevisionVersion,
  createdAt: agent.createdAt,
  description: input.description,
  id: agent.id,
  isDefaultForAccount: input.isDefaultForAccount,
  kind: agent.kind,
  name: agent.name,
  ownerAccountId: agent.ownerAccountId,
  slug: agent.slug,
  status: agent.status,
  updatedAt: agent.updatedAt,
  visibility: agent.visibility,
})

const matchesAgentListOptions = (agent: AgentRecord, options: ListAgentsOptions): boolean => {
  if (options.kind && agent.kind !== options.kind) {
    return false
  }

  if (options.status && agent.status !== options.status) {
    return false
  }

  if (options.visibility && agent.visibility !== options.visibility) {
    return false
  }

  return true
}

export const createAgentManagementService = ({
  createId = createPrefixedId,
  db,
  now = () => new Date().toISOString(),
}: CreateAgentSyncServiceDependencies): AgentManagementService => {
  const syncService = createAgentSyncService({
    createId,
    db,
    now,
  })

  const requireMembership = (scope: TenantScope): Result<null, DomainError> => {
    const membership = createTenantMembershipRepository(db).requireMembership(scope)

    if (!membership.ok) {
      return membership
    }

    return ok(null)
  }

  const loadAccessibleAgent = (
    scope: TenantScope,
    agentId: AgentId,
  ): Result<AgentRecord, DomainError> => {
    const membership = requireMembership(scope)

    if (!membership.ok) {
      return membership
    }

    const agent = createAgentRepository(db).getById(scope, agentId)

    if (!agent.ok) {
      return agent
    }

    if (!canReadAgent(scope, agent.value)) {
      return err({
        message: `agent ${agentId} is not visible to account ${scope.accountId}`,
        type: 'permission',
      })
    }

    return agent
  }

  const hydrateAgentDetail = (
    scope: TenantScope,
    agent: AgentRecord,
  ): Result<AgentDetail, DomainError> => {
    const revisionRepository = createAgentRevisionRepository(db)
    const subagentLinkRepository = createAgentSubagentLinkRepository(db)
    const agentRepository = createAgentRepository(db)
    const preferences = createAccountPreferencesRepository(db).getByAccountId(scope, scope.accountId)
    const isDefaultForAccount =
      preferences.ok &&
      preferences.value.defaultTargetKind === 'agent' &&
      preferences.value.defaultAgentId === agent.id

    let activeRevision: AgentDetail['activeRevision'] = null
    let activeRevisionVersion: number | null = null
    let description: string | null = null
    let subagents: AgentDetail['subagents'] = []

    if (agent.activeRevisionId) {
      const revision = revisionRepository.getById(scope, agent.activeRevisionId)

      if (!revision.ok) {
        return err({
          message: `active revision ${agent.activeRevisionId} for agent ${agent.id} could not be loaded`,
          type: 'conflict',
        })
      }

      activeRevisionVersion = revision.value.version
      const parsedDescription = getAgentDescription(revision.value)

      if (!parsedDescription.ok) {
        return parsedDescription
      }

      description = parsedDescription.value
      activeRevision = {
        checksumSha256: revision.value.checksumSha256,
        createdAt: revision.value.createdAt,
        createdByAccountId: revision.value.createdByAccountId,
        frontmatterJson: revision.value.frontmatterJson,
        id: revision.value.id,
        instructionsMd: revision.value.instructionsMd,
        memoryPolicyJson: revision.value.memoryPolicyJson,
        modelConfigJson: revision.value.modelConfigJson,
        resolvedConfigJson: revision.value.resolvedConfigJson,
        sourceMarkdown: revision.value.sourceMarkdown,
        toolProfileId: revision.value.toolProfileId,
        toolPolicyJson: revision.value.toolPolicyJson,
        version: revision.value.version,
        workspacePolicyJson: revision.value.workspacePolicyJson,
      }

      const links = subagentLinkRepository.listByParentRevisionId(scope, revision.value.id)

      if (!links.ok) {
        return links
      }

      const hydratedSubagents: AgentDetail['subagents'] = []

      for (const link of links.value) {
        const child = agentRepository.getById(scope, link.childAgentId)

        if (!child.ok) {
          return err({
            message: `subagent ${link.childAgentId} for agent ${agent.id} could not be loaded`,
            type: 'conflict',
          })
        }

        let childDescription: string | null = null

        if (child.value.activeRevisionId) {
          const childRevision = revisionRepository.getById(scope, child.value.activeRevisionId)

          if (!childRevision.ok) {
            return err({
              message: `active revision ${child.value.activeRevisionId} for child agent ${child.value.id} could not be loaded`,
              type: 'conflict',
            })
          }

          const parsedChildDescription = getAgentDescription(childRevision.value)

          if (!parsedChildDescription.ok) {
            return parsedChildDescription
          }

          childDescription = parsedChildDescription.value
        }

        hydratedSubagents.push({
          alias: link.alias,
          childAgentId: link.childAgentId,
          childDescription,
          childName: child.value.name,
          childSlug: child.value.slug,
          delegationMode: link.delegationMode,
          position: link.position,
        })
      }

      subagents = hydratedSubagents
    }

    return ok({
      ...summarizeAgent(agent, {
        activeRevisionVersion,
        description,
        isDefaultForAccount,
      }),
      activeRevision,
      subagents,
    })
  }

  return {
    createAgent: (scope, input): Result<AgentDetail, DomainError> => {
      const membership = requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const writable = requireWritableScope(scope)

      if (!writable.ok) {
        return writable
      }

      if (input.visibility === 'system') {
        return err({
          message: 'system agents cannot be created through the tenant API',
          type: 'permission',
        })
      }

      const imported = syncService.importMarkdown(scope, {
        actorAccountId: scope.accountId,
        markdown: serializeAgentMarkdown(toStructuredMarkdownDocument(input)),
      })

      if (!imported.ok) {
        return imported
      }

      return hydrateAgentDetail(scope, imported.value.agent)
    },
    deleteAgent: (scope, agentId): Result<DeleteAgentResult, DomainError> => {
      const membership = requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const writable = requireWritableScope(scope)

      if (!writable.ok) {
        return writable
      }

      const agentRepository = createAgentRepository(db)
      const agent = agentRepository.getById(scope, agentId)

      if (!agent.ok) {
        return agent
      }

      if (!canEditAgent(scope, agent.value)) {
        return err({
          message: `agent ${agentId} cannot be deleted by account ${scope.accountId}`,
          type: 'permission',
        })
      }

      if (agent.value.status === 'deleted') {
        return ok({
          agentId,
          deleted: true,
        })
      }

      const timestamp = now()
      const deleted = withTransaction(db, (tx) => {
        const txAgentRepository = createAgentRepository(tx)
        const removedDefaults = createAccountPreferencesRepository(tx).clearDefaultAgentByAgentId(
          scope,
          agentId,
        )

        if (!removedDefaults.ok) {
          return removedDefaults
        }

        return txAgentRepository.updateStatus(scope, {
          agentId,
          archivedAt: timestamp,
          status: 'deleted',
          updatedAt: timestamp,
        })
      })

      if (!deleted.ok) {
        return deleted
      }

      return ok({
        agentId,
        deleted: true,
      })
    },
    exportAgentMarkdown: (scope, agentId): Result<AgentMarkdownExport, DomainError> => {
      const agent = loadAccessibleAgent(scope, agentId)

      if (!agent.ok) {
        return agent
      }

      return syncService.exportMarkdown(scope, {
        agentId,
      })
    },
    getAgentById: (scope, agentId): Result<AgentDetail, DomainError> => {
      const agent = loadAccessibleAgent(scope, agentId)

      if (!agent.ok) {
        return agent
      }

      return hydrateAgentDetail(scope, agent.value)
    },
    listAgents: (scope, options = {}): Result<AgentSummary[], DomainError> => {
      const membership = requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const agentRepository = createAgentRepository(db)
      const revisionRepository = createAgentRevisionRepository(db)
      const agents = agentRepository.listByTenant(scope)

      if (!agents.ok) {
        return agents
      }

      const preferences = createAccountPreferencesRepository(db).getByAccountId(scope, scope.accountId)
      const defaultAgentId =
        preferences.ok && preferences.value.defaultTargetKind === 'agent'
          ? preferences.value.defaultAgentId
          : null
      const visibleAgents = agents.value
        .filter((agent) => canReadAgent(scope, agent))
        .filter((agent) => matchesAgentListOptions(agent, options))

      const summaries: AgentSummary[] = []

      for (const agent of visibleAgents) {
        let activeRevisionVersion: number | null = null
        let description: string | null = null

        if (agent.activeRevisionId) {
          const revision = revisionRepository.getById(scope, agent.activeRevisionId)

          if (!revision.ok) {
            return err({
              message: `active revision ${agent.activeRevisionId} for agent ${agent.id} could not be loaded`,
              type: 'conflict',
            })
          }

          activeRevisionVersion = revision.value.version
          const parsedDescription = getAgentDescription(revision.value)

          if (!parsedDescription.ok) {
            return parsedDescription
          }

          description = parsedDescription.value
        }

        summaries.push(
          summarizeAgent(agent, {
            activeRevisionVersion,
            description,
            isDefaultForAccount: defaultAgentId === agent.id,
          }),
        )
      }

      if (options.limit !== undefined) {
        return ok(summaries.slice(0, options.limit))
      }

      return ok(summaries)
    },
    updateAgent: (scope, agentId, input): Result<AgentDetail, DomainError> => {
      const membership = requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const writable = requireWritableScope(scope)

      if (!writable.ok) {
        return writable
      }

      const existingAgent = createAgentRepository(db).getById(scope, agentId)

      if (!existingAgent.ok) {
        return existingAgent
      }

      if (!canEditAgent(scope, existingAgent.value)) {
        return err({
          message: `agent ${agentId} cannot be edited by account ${scope.accountId}`,
          type: 'permission',
        })
      }

      if (input.visibility === 'system') {
        return err({
          message: 'system visibility cannot be assigned through the tenant API',
          type: 'permission',
        })
      }

      let currentDocument: AgentMarkdownDocument | null = null

      if (existingAgent.value.activeRevisionId) {
        const exported = syncService.exportMarkdown(scope, {
          agentId,
        })

        if (!exported.ok) {
          return exported
        }

        const parsedCurrent = parseAgentMarkdown(exported.value.markdown)

        if (!parsedCurrent.ok) {
          return parsedCurrent
        }

        currentDocument = parsedCurrent.value
      }

      const imported = syncService.importMarkdown(scope, {
        actorAccountId: scope.accountId,
        markdown: serializeAgentMarkdown(
          toMergedStructuredUpdateDocument(currentDocument, input, agentId),
        ),
      })

      if (!imported.ok) {
        return imported
      }

      return hydrateAgentDetail(scope, imported.value.agent)
    },
    updateAgentMarkdown: (scope, agentId, input): Result<AgentDetail, DomainError> => {
      const membership = requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const writable = requireWritableScope(scope)

      if (!writable.ok) {
        return writable
      }

      const existingAgent = createAgentRepository(db).getById(scope, agentId)

      if (!existingAgent.ok) {
        return existingAgent
      }

      if (!canEditAgent(scope, existingAgent.value)) {
        return err({
          message: `agent ${agentId} cannot be edited by account ${scope.accountId}`,
          type: 'permission',
        })
      }

      const parsed = parseAgentMarkdown(input.markdown)

      if (!parsed.ok) {
        return parsed
      }

      if (!parsed.value.frontmatter.agentId) {
        return err({
          message: 'markdown updates for an existing agent must include agent_id',
          type: 'validation',
        })
      }

      if (parsed.value.frontmatter.agentId !== agentId) {
        return err({
          message: `markdown agent_id ${parsed.value.frontmatter.agentId} does not match route agent ${agentId}`,
          type: 'validation',
        })
      }

      if (parsed.value.frontmatter.visibility === 'system') {
        return err({
          message: 'system visibility cannot be assigned through the tenant API',
          type: 'permission',
        })
      }

      const imported = syncService.importMarkdown(scope, {
        actorAccountId: scope.accountId,
        markdown: input.markdown,
      })

      if (!imported.ok) {
        return imported
      }

      return hydrateAgentDetail(scope, imported.value.agent)
    },
  }
}
