import type {
  AgentId,
  AgentKind,
  AgentStatus,
  AgentVisibility,
  BackendAccountPreferences,
  BackendAgentDetail,
  BackendAgentSummary,
  BackendEvent,
  BackendToolProfile,
  BackendSession,
  BackendModelsCatalog,
  BackendRun,
  BackendThread,
  BackendThreadMessage,
  BootstrapSessionInput,
  BootstrapSessionOutput,
  BranchThreadInput,
  BranchThreadOutput,
  CreateAgentApiInput,
  CreateToolProfileInput,
  CreateSessionInput,
  CreateSessionThreadInput,
  EditThreadMessageInput,
  EditThreadMessageOutput,
  ExecuteRunInput,
  MessageId,
  PostThreadMessageInput,
  PostThreadMessageOutput,
  RunExecutionOutput,
  RunId,
  StartThreadInteractionInput,
  StartThreadInteractionOutput,
  SessionId,
  ThreadId,
  ToolProfileId,
  UpdateAccountPreferencesInput,
  UpdateAgentApiInput,
  UpdateToolProfileInput,
} from '../../../shared/chat'
import { asEventId } from '../../../shared/chat'
import { withRafBatching } from '../runtime/with-raf-batching'
import { apiFetch, createApiHeaders, apiRequest, toApiUrl } from './backend'
import { createReconnectingSseConsumer } from './sse'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export type McpServerKind = 'stdio' | 'streamable_http'
export type McpServerStatus = 'authorization_required' | 'connecting' | 'degraded' | 'ready'

export type CreateMcpHttpAuthInput =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | {
      clientId?: string
      clientName?: string
      clientSecret?: string
      kind: 'oauth_authorization_code'
      resource?: string
      resourceMetadataUrl?: string
      scope?: string
      tokenEndpointAuthMethod?: string
    }

export type CreateMcpServerInput =
  | {
      config: {
        args?: string[]
        command: string
        cwd?: string
        env?: Record<string, string>
        stderr?: 'inherit' | 'pipe'
      }
      enabled?: boolean
      kind: 'stdio'
      label: string
      logLevel?: string
    }
  | {
      config: {
        auth?: CreateMcpHttpAuthInput
        headers?: Record<string, string>
        url: string
      }
      enabled?: boolean
      kind: 'streamable_http'
      label: string
      logLevel?: string
    }

export interface BackendMcpServer {
  config: Record<string, unknown>
  createdAt: string | null
  createdByAccountId: string | null
  enabled: boolean
  id: string
  kind: McpServerKind
  label: string
  lastDiscoveredAt: string | null
  lastError: string | null
  logLevel: string | null
  source: 'db' | 'static'
  tenantId: string
  updatedAt: string | null
}

export interface BackendMcpServerEntry extends BackendMcpServer {
  snapshot: BackendMcpServerSnapshot | null
}

export interface BackendMcpServerSnapshot {
  discoveredToolCount: number
  id: string
  kind: McpServerKind
  lastError: string | null
  registeredToolCount: number
  status: McpServerStatus
}

export type BeginMcpServerAuthorizationResult =
  | {
      kind: 'authorized'
      snapshot: BackendMcpServerSnapshot
    }
  | {
      authorizationUrl: string
      kind: 'redirect'
    }

export interface BackendMcpToolAssignment {
  approvedAt: string | null
  approvedFingerprint: string | null
  assignedAt: string
  assignedByAccountId: string
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  tenantId: string
  toolProfileId: ToolProfileId | string
  updatedAt: string
}

export interface BackendMcpToolAppsMeta {
  csp: Record<string, unknown> | null
  domain: string | null
  permissions: Record<string, unknown> | null
  resourceUri: string | null
  visibility: Array<'app' | 'model'>
}

export interface BackendMcpServerTool {
  appsMetaJson: BackendMcpToolAppsMeta | null
  assignment?: BackendMcpToolAssignment | null
  createdAt: string | null
  description: string | null
  executionJson: Record<string, unknown> | null
  fingerprint: string
  id: string
  inputSchemaJson: Record<string, unknown>
  isActive: boolean
  modelVisible: boolean
  outputSchemaJson: Record<string, unknown> | null
  remoteName: string
  runtimeName: string
  serverId: string
  tenantId: string
  title: string | null
  updatedAt: string | null
}

const parseBackendEvent = (value: unknown): BackendEvent => {
  if (!isObject(value)) {
    throw new Error('Invalid backend event payload received.')
  }

  if (
    typeof value.aggregateId !== 'string' ||
    typeof value.aggregateType !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.eventNo !== 'number' ||
    typeof value.id !== 'string' ||
    !isObject(value.payload) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('Invalid backend event payload received.')
  }

  return {
    ...value,
    id: asEventId(value.id),
  } as BackendEvent
}

export const bootstrapSession = (input: BootstrapSessionInput): Promise<BootstrapSessionOutput> =>
  apiRequest<BootstrapSessionOutput>('/sessions/bootstrap', {
    body: JSON.stringify({
      ...input,
      execute: true,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const createSession = (input: CreateSessionInput): Promise<BackendSession> =>
  apiRequest<BackendSession>('/sessions', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const createSessionThread = (
  sessionId: SessionId,
  input: CreateSessionThreadInput,
): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/sessions/${sessionId}/threads`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const branchThread = (
  threadId: ThreadId,
  input: BranchThreadInput,
): Promise<BranchThreadOutput> =>
  apiRequest<BranchThreadOutput>(`/threads/${threadId}/branches`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const getSupportedModels = (): Promise<BackendModelsCatalog> =>
  apiRequest<BackendModelsCatalog>('/system/models')

export const listAgents = async (
  options: {
    kind?: AgentKind
    limit?: number
    status?: AgentStatus
    visibility?: AgentVisibility
  } = {},
): Promise<BackendAgentSummary[]> => {
  const searchParams = new URLSearchParams()

  searchParams.set('limit', String(options.limit ?? 50))
  searchParams.set('status', options.status ?? 'active')

  if (options.kind) {
    searchParams.set('kind', options.kind)
  }

  if (options.visibility) {
    searchParams.set('visibility', options.visibility)
  }

  return apiRequest<BackendAgentSummary[]>(`/agents?${searchParams.toString()}`)
}

export const getAgent = (agentId: AgentId): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}`)

export const createAgent = (input: CreateAgentApiInput): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>('/agents', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateAgent = (
  agentId: AgentId,
  input: UpdateAgentApiInput,
): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })

export const renameAgent = (
  agentId: AgentId,
  name: string,
): Promise<BackendAgentSummary> =>
  apiRequest<BackendAgentSummary>(`/agents/${encodeURIComponent(agentId)}`, {
    body: JSON.stringify({ name }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const deleteAgent = (agentId: AgentId): Promise<void> =>
  apiRequest<{ agentId: AgentId; deleted: true }>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  }).then(() => undefined)

export const getAgentMarkdown = (
  agentId: AgentId,
): Promise<{ agentId: string; markdown: string; revisionId: string }> =>
  apiRequest<{ agentId: string; markdown: string; revisionId: string }>(
    `/agents/${encodeURIComponent(agentId)}/markdown`,
  )

export const updateAgentMarkdown = (
  agentId: AgentId,
  markdown: string,
): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}/markdown`, {
    body: JSON.stringify({ markdown }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })

export const getAccountPreferences = (): Promise<BackendAccountPreferences> =>
  apiRequest<BackendAccountPreferences>('/account/preferences')

export const listToolProfiles = (): Promise<BackendToolProfile[]> =>
  apiRequest<BackendToolProfile[]>('/tool-profiles')

export const getToolProfile = (
  toolProfileId: ToolProfileId | string,
): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>(`/tool-profiles/${encodeURIComponent(toolProfileId)}`)

export const createToolProfile = (
  input: CreateToolProfileInput,
): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>('/tool-profiles', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateToolProfile = (
  toolProfileId: ToolProfileId | string,
  input: UpdateToolProfileInput,
): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>(`/tool-profiles/${encodeURIComponent(toolProfileId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const updateAccountPreferences = (
  input: UpdateAccountPreferencesInput,
): Promise<BackendAccountPreferences> =>
  apiRequest<BackendAccountPreferences>('/account/preferences', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const getThread = (threadId: ThreadId): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/threads/${threadId}`)

export const listThreads = async (
  options: { limit?: number; query?: string } = {},
): Promise<BackendThread[]> => {
  const limit = options.limit ?? 50
  const searchParams = new URLSearchParams()
  searchParams.set('limit', String(limit))

  if (options.query?.trim()) {
    searchParams.set('query', options.query.trim())
  }

  const response = await apiRequest<{ threads: BackendThread[] }>(
    `/threads?${searchParams.toString()}`,
  )

  return response.threads
}

export interface ThreadActivityItem {
  id: string
  title: string | null
  activity: {
    state: 'pending' | 'running' | 'waiting' | 'approval' | 'failed' | 'completed'
    label: string
    updatedAt: string
    completedAt: string | null
  }
}

export const getThreadsActivity = async (
  options: { completedWithinMinutes?: number } = {},
): Promise<ThreadActivityItem[]> => {
  const searchParams = new URLSearchParams()

  if (options.completedWithinMinutes != null) {
    searchParams.set('completed_within_minutes', String(options.completedWithinMinutes))
  }

  const query = searchParams.toString()
  const response = await apiRequest<{ threads: ThreadActivityItem[] }>(
    `/threads/activity${query ? `?${query}` : ''}`,
  )

  return response.threads
}

export const listThreadMessages = (threadId: ThreadId): Promise<BackendThreadMessage[]> =>
  apiRequest<BackendThreadMessage[]>(`/threads/${threadId}/messages`)

export const editThreadMessage = (
  threadId: ThreadId,
  messageId: MessageId,
  input: EditThreadMessageInput,
): Promise<EditThreadMessageOutput> =>
  apiRequest<EditThreadMessageOutput>(`/threads/${threadId}/messages/${messageId}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export interface ThreadBudgetSnapshot {
  actualInputTokens: number | null
  actualOutputTokens: number | null
  actualTotalTokens: number | null
  cachedInputTokens: number | null
  contextWindow: number | null
  estimatedInputTokens: number
  measuredAt: string | null
  model: string | null
  provider: string | null
  reasoningTokens: number | null
  reservedOutputTokens: number | null
  stablePrefixTokens: number | null
  turn: number | null
  volatileSuffixTokens: number | null
}

export interface ThreadBudgetResponse {
  budget: ThreadBudgetSnapshot | null
}

export interface ThreadObservationItem {
  text: string
}

export interface ThreadObservationContent {
  observations: ThreadObservationItem[]
  source: 'observer_v1'
}

export interface ThreadReflectionContent {
  reflection: string
  source: 'reflector_v1'
}

export interface ThreadMemoryRecord {
  content: ThreadObservationContent
  createdAt: string
  id: string
  kind: 'observation'
  tokenCount: number | null
}

export interface ThreadMemoryReflection {
  content: ThreadReflectionContent
  createdAt: string
  generation: number
  id: string
  kind: 'reflection'
  tokenCount: number | null
}

export interface ThreadMemoryResponse {
  observations: ThreadMemoryRecord[]
  reflection: ThreadMemoryReflection | null
}

export type UpdateThreadMemoryInput =
  | {
      kind: 'observation'
      observations: ThreadObservationItem[]
    }
  | {
      kind: 'reflection'
      reflection: string
    }

export interface ThreadMemoryUpdateResponse {
  record: ThreadMemoryRecord | ThreadMemoryReflection
}

export const getThreadMemory = (threadId: ThreadId): Promise<ThreadMemoryResponse> =>
  apiRequest<ThreadMemoryResponse>(`/threads/${threadId}/memory`)

export const updateThreadMemory = (
  threadId: ThreadId,
  recordId: string,
  input: UpdateThreadMemoryInput,
): Promise<ThreadMemoryRecord | ThreadMemoryReflection> =>
  apiRequest<ThreadMemoryUpdateResponse>(`/threads/${threadId}/memory/${recordId}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  }).then((response) => response.record)

export const getThreadBudget = async (threadId: ThreadId): Promise<ThreadBudgetSnapshot | null> => {
  const response = await apiRequest<ThreadBudgetResponse>(`/threads/${threadId}/budget`)
  return response.budget
}

export const renameThread = (
  threadId: ThreadId,
  title: string,
): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/threads/${threadId}`, {
    body: JSON.stringify({
      title,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const regenerateThreadTitle = (threadId: ThreadId): Promise<void> =>
  apiRequest<{ accepted: true; threadId: ThreadId }>(`/threads/${threadId}/title/regenerate`, {
    method: 'POST',
  }).then(() => undefined)

export const deleteThread = (threadId: ThreadId): Promise<void> =>
  apiRequest<{ deleted: true; threadId: ThreadId }>(`/threads/${threadId}`, {
    method: 'DELETE',
  }).then(() => undefined)

export const startThreadInteraction = (
  threadId: ThreadId,
  input: StartThreadInteractionInput,
): Promise<StartThreadInteractionOutput> =>
  apiRequest<StartThreadInteractionOutput>(`/threads/${threadId}/interactions`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const postThreadMessage = (
  threadId: ThreadId,
  input: PostThreadMessageInput,
): Promise<PostThreadMessageOutput> =>
  apiRequest<PostThreadMessageOutput>(`/threads/${threadId}/messages`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const executeRun = (
  runId: RunId,
  input: ExecuteRunInput,
): Promise<RunExecutionOutput> =>
  apiRequest<RunExecutionOutput>(`/runs/${runId}/execute`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const getRun = (runId: RunId): Promise<BackendRun> =>
  apiRequest<BackendRun>(`/runs/${runId}`)

export const resumeRun = (
  runId: RunId,
  input: {
    approve?: boolean
    errorMessage?: string
    maxOutputTokens?: number
    model?: string
    modelAlias?: string
    output?: unknown
    provider?: 'openai' | 'google'
    rememberApproval?: boolean
    temperature?: number
    waitId: string
  },
): Promise<RunExecutionOutput> =>
  apiRequest<RunExecutionOutput>(`/runs/${runId}/resume`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const cancelRun = (
  runId: RunId,
  reason?: string,
): Promise<{ runId: RunId; status: 'cancelled' }> =>
  apiRequest<{ runId: RunId; status: 'cancelled' }>(`/runs/${runId}/cancel`, {
    body: JSON.stringify(reason ? { reason } : {}),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const createMcpServer = (
  input: CreateMcpServerInput,
): Promise<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }> =>
  apiRequest<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }>('/mcp/servers', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const listMcpServers = (): Promise<BackendMcpServerEntry[]> =>
  apiRequest<BackendMcpServerEntry[]>('/mcp/servers')

export const updateMcpServer = (
  serverId: string,
  input: CreateMcpServerInput,
): Promise<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }> =>
  apiRequest<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }>(
    `/mcp/servers/${encodeURIComponent(serverId)}`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )

export const refreshMcpServer = (serverId: string): Promise<BackendMcpServerSnapshot> =>
  apiRequest<BackendMcpServerSnapshot>(`/mcp/servers/${encodeURIComponent(serverId)}/refresh`, {
    method: 'POST',
  })

export const beginMcpServerAuthorization = (
  serverId: string,
  input: {
    responseOrigin?: string
  } = {},
): Promise<BeginMcpServerAuthorizationResult> =>
  apiRequest<BeginMcpServerAuthorizationResult>(
    `/mcp/servers/${encodeURIComponent(serverId)}/oauth/start`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

export const deleteMcpServer = (
  serverId: string,
): Promise<{
  deletedToolAssignments: number
  deletedTools: number
  serverId: string
}> =>
  apiRequest<{
    deletedToolAssignments: number
    deletedTools: number
    serverId: string
  }>(`/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  })

export const getMcpServerTools = (
  serverId: string,
  options: { toolProfileId?: ToolProfileId | string } = {},
): Promise<{
  toolProfileId: ToolProfileId | string | null
  server: BackendMcpServer
  tools: BackendMcpServerTool[]
}> => {
  const searchParams = new URLSearchParams()

  const toolProfileId = options.toolProfileId?.toString().trim()

  if (toolProfileId) {
    searchParams.set('toolProfileId', toolProfileId)
  }

  const path =
    searchParams.size > 0
      ? `/mcp/servers/${encodeURIComponent(serverId)}/tools?${searchParams.toString()}`
      : `/mcp/servers/${encodeURIComponent(serverId)}/tools`

  return apiRequest<{
    toolProfileId: ToolProfileId | string | null
    server: BackendMcpServer
    tools: BackendMcpServerTool[]
  }>(path)
}

export const assignMcpTool = (input: {
  requiresConfirmation?: boolean
  runtimeName: string
  serverId: string
  toolProfileId: ToolProfileId | string
}): Promise<{
  assignment: BackendMcpToolAssignment
  tool: BackendMcpServerTool
}> =>
  apiRequest<{
    assignment: BackendMcpToolAssignment
    tool: BackendMcpServerTool
  }>('/mcp/assignments', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const deleteMcpToolAssignment = (input: {
  runtimeName: string
  toolProfileId: ToolProfileId | string
}): Promise<{
  assignment: BackendMcpToolAssignment
}> => {
  const searchParams = new URLSearchParams({
    toolProfileId: input.toolProfileId.toString(),
  })

  return apiRequest<{
    assignment: BackendMcpToolAssignment
  }>(
    `/mcp/assignments/${encodeURIComponent(input.runtimeName)}?${searchParams.toString()}`,
    {
      method: 'DELETE',
    },
  )
}

interface StreamThreadEventsOptions {
  cursor?: number
  onEvents: (events: BackendEvent[]) => void
  onReconnectStateChange?: (isReconnecting: boolean) => void
  signal?: AbortSignal
  threadId: ThreadId
}

export const streamThreadEvents = async ({
  cursor = 0,
  onEvents,
  onReconnectStateChange,
  signal,
  threadId,
}: StreamThreadEventsOptions): Promise<void> => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const batcher = withRafBatching<BackendEvent>((batch) => {
    onEvents(batch)
  })

  const consumer = createReconnectingSseConsumer(toApiUrl('/events/stream'), {
    buildRequest(nextCursor) {
      const url = new URL(toApiUrl('/events/stream'), origin)
      url.searchParams.set('category', 'all')
      url.searchParams.set('follow', 'true')
      url.searchParams.set('threadId', threadId)
      url.searchParams.set('cursor', nextCursor ?? String(cursor))

      return {
        init: {
          headers: createApiHeaders(),
          method: 'GET',
        },
        url: url.toString(),
      }
    },
    fetch: apiFetch,
    onEvent(event) {
      batcher.push(parseBackendEvent(JSON.parse(event.data)))
    },
    onReconnectStateChange,
    signal,
  })

  try {
    await consumer.consume()
  } finally {
    batcher.flush()
  }
}
