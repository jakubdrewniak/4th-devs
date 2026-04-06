import { randomUUID } from 'node:crypto'

export const uuid = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

// ── Sessions ────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'done'

export interface MemoryState {
  observations: string
  lastObservedSeq: number
  observationTokens: number
  generation: number
}

export interface Session {
  id: string
  title: string
  goal?: string
  status: SessionStatus
  usage?: TokenUsage
  created_at: string
  updated_at: string
}

// ── Actors ──────────────────────────────────────────────────────────────────

export type ActorType = 'user' | 'agent'
export type ActorStatus = 'active' | 'idle'

export interface Actor {
  id: string
  session_id: string
  type: ActorType
  name: string
  status: ActorStatus
  capabilities?: Record<string, unknown>
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'blocked' | 'done'

export type TaskRecoveryKind =
  | 'explicit_block'
  | 'llm_transient'
  | 'runtime_error'

export interface TaskRecoveryState {
  autoRetry: boolean
  attempts: number
  lastFailureKind: TaskRecoveryKind
  lastFailureMessage: string
  lastFailureAt: string
  nextRetryAt?: string
}

export interface Task {
  id: string
  session_id: string
  parent_task_id?: string
  owner_actor_id?: string
  title: string
  status: TaskStatus
  memory?: MemoryState
  recovery?: TaskRecoveryState
  priority: number
  created_at: string
}

// ── Items ───────────────────────────────────────────────────────────────────

export type ItemType = 'message' | 'decision' | 'invocation' | 'result'

export interface Item {
  id: string
  session_id: string
  task_id?: string
  actor_id?: string
  type: ItemType
  content: Record<string, unknown>
  sequence: number
  created_at: string
}

// ── Artifacts ───────────────────────────────────────────────────────────────

export type ArtifactKind = 'file' | 'plan' | 'diff' | 'image'

export interface Artifact {
  id: string
  session_id: string
  task_id?: string
  kind: ArtifactKind
  path: string
  version: number
  metadata?: Record<string, unknown>
  created_at: string
}

// ── Token Usage ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0,
})

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
})

// ── Relations ───────────────────────────────────────────────────────────────

export type RelationType = 'depends_on' | 'assigned_to' | 'produces' | 'uses'
export type EntityKind = 'session' | 'actor' | 'task' | 'item' | 'artifact'

export interface Relation {
  id: string
  session_id: string
  from_kind: EntityKind
  from_id: string
  relation_type: RelationType
  to_kind: EntityKind
  to_id: string
  created_at: string
}
