import type { AgentRevisionRecord } from '../../domain/agents/agent-revision-repository'
import { createAgentRevisionRepository } from '../../domain/agents/agent-revision-repository'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { ToolSpec } from '../../domain/tooling/tool-registry'
import type { ToolProfileId } from '../../shared/ids'
import type { TenantScope } from '../../shared/scope'

export interface AgentRuntimeSettings {
  toolProfileId: ToolProfileId | null
  resolvedConfigSnapshot: {
    model: string | null
    modelAlias: string | null
    provider: 'openai' | 'google' | null
    reasoning: Record<string, unknown> | null
  }
}

const isModelProvider = (value: unknown): value is 'openai' | 'google' =>
  value === 'openai' || value === 'google'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const getOptionalString = (value: Record<string, unknown>, key: string): string | null =>
  typeof value[key] === 'string' && value[key]!.trim().length > 0 ? (value[key] as string) : null

const getToolPolicy = (
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>,
): Record<string, unknown> =>
  isPlainObject(revision.toolPolicyJson) ? revision.toolPolicyJson : {}

export const getGrantedToolProfileId = (
  revision: Pick<AgentRevisionRecord, 'toolProfileId'>,
): ToolProfileId | null => revision.toolProfileId

export const resolveRuntimeSettingsFromAgentRevision = (
  revision: Pick<AgentRevisionRecord, 'modelConfigJson' | 'toolProfileId'>,
  fallbackToolProfileId: ToolProfileId | null,
  overrides?: {
    model?: string | null
    modelAlias?: string | null
    provider?: 'openai' | 'google' | null
    reasoning?: Record<string, unknown> | null
  },
): AgentRuntimeSettings => {
  const modelConfig = isPlainObject(revision.modelConfigJson) ? revision.modelConfigJson : {}
  const toolProfileId = getGrantedToolProfileId(revision) ?? fallbackToolProfileId

  return {
    toolProfileId,
    resolvedConfigSnapshot: {
      model: overrides?.model ?? null,
      modelAlias: overrides?.modelAlias ?? getOptionalString(modelConfig, 'modelAlias'),
      provider:
        overrides?.provider ??
        (isModelProvider(modelConfig.provider) ? modelConfig.provider : null),
      reasoning:
        overrides?.reasoning ??
        (isPlainObject(modelConfig.reasoning) ? modelConfig.reasoning : null),
    },
  }
}

export const hasNativeToolGrant = (
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>,
  toolName: string,
): boolean => {
  const toolPolicy = getToolPolicy(revision)
  const nativeTools = Array.isArray(toolPolicy.native)
    ? toolPolicy.native.filter((value): value is string => typeof value === 'string')
    : []

  if (toolName === 'suspend_run') {
    return nativeTools.includes('suspend_run') || nativeTools.includes('block_run')
  }

  if (toolName === 'resume_delegated_run') {
    return nativeTools.includes('resume_delegated_run') || nativeTools.includes('delegate_to_agent')
  }

  return nativeTools.includes(toolName)
}

export const getGrantedMcpProfile = (
  revision: Pick<AgentRevisionRecord, 'toolProfileId'>,
): string | null => getGrantedToolProfileId(revision)

export const isNativeToolAllowedForRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'agentRevisionId'>,
  toolName: string,
): boolean => {
  if (!run.agentRevisionId) {
    return false
  }

  const revision = createAgentRevisionRepository(db).getById(scope, run.agentRevisionId)

  return revision.ok && hasNativeToolGrant(revision.value, toolName)
}

export const isToolAllowedForRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'agentRevisionId' | 'toolProfileId'>,
  tool: Pick<ToolSpec, 'domain' | 'name'>,
): boolean => {
  if (!run.agentRevisionId) {
    return true
  }

  const revision = createAgentRevisionRepository(db).getById(scope, run.agentRevisionId)

  if (!revision.ok) {
    return false
  }

  switch (tool.domain) {
    case 'native':
      return hasNativeToolGrant(revision.value, tool.name)
    case 'mcp': {
      const grantedProfile = getGrantedToolProfileId(revision.value)

      return grantedProfile !== null && run.toolProfileId === grantedProfile
    }
    case 'provider':
    case 'system':
      return false
  }
}
