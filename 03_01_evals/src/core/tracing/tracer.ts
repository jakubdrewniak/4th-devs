import {
  type LangfuseAgent,
  type LangfuseGeneration,
  type LangfuseSpan,
  type LangfuseTool,
  startActiveObservation,
  startObservation,
  updateActiveTrace,
} from '@langfuse/tracing'
import {
  advanceTurn,
  formatGenerationName,
  formatToolName,
  getCurrentTurn,
  getPromptRef,
  type PromptRef,
  withAgentContext,
} from './context.js'
import { isTracingActive, logTrace } from './init.js'

export interface TraceParams {
  name: string
  sessionId: string
  userId?: string
  input?: unknown
  metadata?: Record<string, unknown>
  tags?: string[]
}

export interface AgentParams {
  name: string
  agentId: string
  task?: string
  metadata?: Record<string, unknown>
}

export interface GenerationParams {
  model: string
  input?: unknown
  metadata?: Record<string, unknown>
  prompt?: PromptRef
}

export interface ToolParams {
  name: string
  input?: unknown
  callId?: string
  metadata?: Record<string, unknown>
}

export interface Usage {
  input?: number
  output?: number
  total?: number
}

export interface GenerationResult {
  output?: unknown
  usage?: Usage
}

export interface ErrorInfo {
  code?: string
  message: string
}

export interface GenerationHandle {
  id: string
  recordFirstToken: () => void
  end: (result?: GenerationResult) => void
  error: (err: ErrorInfo) => void
}

const toUsageDetails = (usage?: Usage): Record<string, number> | undefined => {
  if (!usage) {
    return undefined
  }

  const entries = Object.entries(usage).filter(([, value]) => typeof value === 'number') as Array<
    [string, number]
  >

  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries)
}

export const withTrace = async <T>(params: TraceParams, fn: () => Promise<T>): Promise<T> => {
  if (!isTracingActive()) {
    return fn()
  }

  return startActiveObservation(params.name, async (span: LangfuseSpan) => {
    span.update({
      input: params.input,
      metadata: params.metadata,
    })

    span.updateTrace({
      sessionId: params.sessionId,
      userId: params.userId,
      tags: params.tags,
    })

    try {
      const result = await fn()
      updateActiveTrace({ output: result })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      span.update({
        level: 'ERROR',
        statusMessage: message,
      })
      throw error
    }
  })
}

export const setTraceOutput = (output: unknown): void => {
  if (!isTracingActive()) {
    return
  }

  updateActiveTrace({ output })
}

export const withAgent = async <T>(params: AgentParams, fn: () => Promise<T>): Promise<T> => {
  if (!isTracingActive()) {
    return withAgentContext(params.name, params.agentId, fn)
  }

  return startActiveObservation(
    params.name,
    async (span: LangfuseAgent) => {
      span.update({
        input: { task: params.task },
        metadata: { agentId: params.agentId, ...params.metadata },
      })

      return withAgentContext(params.name, params.agentId, async () => {
        try {
          const result = await fn()
          span.update({ output: result })
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          span.update({
            level: 'ERROR',
            statusMessage: message,
          })
          throw error
        }
      })
    },
    { asType: 'agent' },
  )
}

export const startGeneration = (params: GenerationParams): GenerationHandle => {
  if (!isTracingActive()) {
    return {
      id: '',
      recordFirstToken: () => {},
      end: () => {},
      error: () => {},
    }
  }

  const name = formatGenerationName()
  const promptRef = params.prompt ?? getPromptRef()
  const span = startObservation(
    name,
    {
      model: params.model,
      input: params.input,
      prompt: promptRef,
      metadata: {
        turn: getCurrentTurn(),
        ...params.metadata,
      },
    },
    { asType: 'generation' },
  ) as LangfuseGeneration

  return {
    id: name,
    recordFirstToken: () => {
      span.update({ completionStartTime: new Date() })
    },
    end: (result?: GenerationResult) => {
      if (result) {
        span.update({
          output: result.output,
          usageDetails: toUsageDetails(result.usage),
        })
      }
      span.end()
    },
    error: (err: ErrorInfo) => {
      span.update({
        level: 'ERROR',
        statusMessage: err.message,
        output: {
          error: err.message,
          code: err.code,
        },
      })
      span.end()
    },
  }
}

export const withTool = async <T>(params: ToolParams, fn: () => Promise<T>): Promise<T> => {
  if (!isTracingActive()) {
    return fn()
  }

  const name = formatToolName(params.name)

  return startActiveObservation(
    name,
    async (span: LangfuseTool) => {
      span.update({
        input: params.input,
        metadata: {
          callId: params.callId,
          turn: getCurrentTurn(),
          ...params.metadata,
        },
      })

      try {
        const result = await fn()
        span.update({ output: result })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        span.update({
          level: 'ERROR',
          statusMessage: message,
        })
        throw error
      }
    },
    { asType: 'tool' },
  )
}

export { advanceTurn }

export const recordTraceError = (err: ErrorInfo): void => {
  if (!isTracingActive()) {
    return
  }

  logTrace('error', 'Trace error recorded', { error: err.message, code: err.code })
  updateActiveTrace({
    metadata: {
      error: err.message,
      code: err.code,
    },
  })
}
