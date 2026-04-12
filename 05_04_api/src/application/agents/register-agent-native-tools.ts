import { z } from 'zod'

import type { AppDatabase } from '../../db/client'
import type { ToolRegistry, ToolSpec } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import { isNativeToolAllowedForRun } from './agent-runtime-policy'
import { createDelegationService } from './delegation-service'
import { resumeDelegatedRun } from './resume-delegated-run-service'

const delegateToAgentArgsSchema = z.object({
  agentAlias: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(10_000).optional(),
  task: z.string().trim().min(1).max(10_000),
})

const suspendWaitTypeSchema = z.enum(['human', 'upload', 'tool', 'mcp'])
const suspendTargetKindSchema = z.enum(['human_response', 'upload', 'external', 'mcp_operation'])

type SuspendWaitType = z.infer<typeof suspendWaitTypeSchema>
type SuspendTargetKind = z.infer<typeof suspendTargetKindSchema>

const waitTypeByTargetKind: Record<SuspendTargetKind, SuspendWaitType> = {
  external: 'tool',
  human_response: 'human',
  mcp_operation: 'mcp',
  upload: 'upload',
}

const targetKindByWaitType: Record<SuspendWaitType, SuspendTargetKind> = {
  human: 'human_response',
  mcp: 'mcp_operation',
  tool: 'external',
  upload: 'upload',
}

const defaultTargetRefByKind: Record<SuspendTargetKind, string> = {
  external: 'external',
  human_response: 'user_response',
  mcp_operation: 'mcp_operation',
  upload: 'upload',
}

const resolveSuspendWaitPair = (input: {
  targetKind?: SuspendTargetKind
  waitType?: SuspendWaitType
}): {
  ok: true
  targetKind: SuspendTargetKind
  waitType: SuspendWaitType
} | {
  error: string
  ok: false
} => {
  const targetKind =
    input.targetKind ?? (input.waitType ? targetKindByWaitType[input.waitType] : 'human_response')
  const waitType =
    input.waitType ?? (input.targetKind ? waitTypeByTargetKind[input.targetKind] : 'human')

  return waitTypeByTargetKind[targetKind] === waitType
    ? {
        ok: true,
        targetKind,
        waitType,
      }
    : {
        error: `waitType "${waitType}" is not valid for targetKind "${targetKind}"`,
        ok: false,
      }
}

const suspendRunArgsSchema = z
  .object({
    details: z.unknown().optional(),
    reason: z.string().trim().min(1).max(10_000),
    targetKind: suspendTargetKindSchema.optional(),
    targetRef: z.string().trim().min(1).max(500).optional(),
    timeoutAt: z.string().trim().min(1).max(100).optional(),
    waitType: suspendWaitTypeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const resolved = resolveSuspendWaitPair({
      targetKind: value.targetKind,
      waitType: value.waitType,
    })

    if (!resolved.ok) {
      ctx.addIssue({
        code: 'custom',
        message: resolved.error,
        path: ['waitType'],
      })
    }
  })
  .transform((value) => {
    const resolved = resolveSuspendWaitPair({
      targetKind: value.targetKind,
      waitType: value.waitType,
    })

    if (!resolved.ok) {
      throw new Error(resolved.error)
    }

    return {
      details: value.details,
      reason: value.reason,
      targetKind: resolved.targetKind,
      targetRef: value.targetRef ?? defaultTargetRefByKind[resolved.targetKind],
      timeoutAt: value.timeoutAt ?? null,
      waitType: resolved.waitType,
    }
  })

const resumeDelegatedRunArgsSchema = z
  .object({
    approve: z.boolean().optional(),
    childRunId: z.string().trim().min(1).max(200),
    errorMessage: z.string().trim().min(1).max(10_000).optional(),
    output: z.unknown().optional(),
    rememberApproval: z.boolean().optional(),
    waitId: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) =>
      value.approve !== undefined || value.output !== undefined || value.errorMessage !== undefined,
    {
      message: 'Either approve, output, or errorMessage is required',
    },
  )

const toValidationResult = <TValue>(
  parsed: ReturnType<z.ZodType<TValue>['safeParse']>,
): Result<TValue, DomainError> =>
  parsed.success
    ? ok(parsed.data)
    : err({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })

export const registerAgentNativeTools = (
  toolRegistry: ToolRegistry,
  input: {
    db: AppDatabase
    fileStorageRoot: string
  },
): void => {
  const delegationService = createDelegationService({
    db: input.db,
    fileStorageRoot: input.fileStorageRoot,
  })

  const delegateToAgentTool: ToolSpec<z.infer<typeof delegateToAgentArgsSchema>> = {
    description:
      'Create a private child run for one allowed subagent and wait for that delegated result.',
    domain: 'native',
    execute: async (context, args) => {
      const created = delegationService.createDelegatedChildRun({
        instructions: args.instructions ?? null,
        targetAlias: args.agentAlias,
        task: args.task,
        toolContext: context,
      })

      if (!created.ok) {
        return created
      }

      return ok({
        kind: 'waiting' as const,
        wait: {
          description: `Waiting for delegated child agent "${created.value.link.alias}"`,
          targetKind: 'run' as const,
          targetRef: `${created.value.childAgent.slug}:${created.value.childRun.id}`,
          targetRunId: created.value.childRun.id,
          type: 'agent' as const,
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        agentAlias: {
          description: 'Allowed subagent alias from the current agent profile.',
          type: 'string',
        },
        instructions: {
          description: 'Detailed instructions for the delegated child run.',
          type: 'string',
        },
        task: {
          description: 'Short task title or objective for the delegated child run.',
          type: 'string',
        },
      },
      required: ['agentAlias', 'task'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'delegate_to_agent'),
    name: 'delegate_to_agent',
    strict: false,
    validateArgs: (args) => toValidationResult(delegateToAgentArgsSchema.safeParse(args)),
  }

  const suspendRunTool: ToolSpec<z.infer<typeof suspendRunArgsSchema>> = {
    description:
      'Suspend the current run until missing user, file, MCP, or external input arrives.',
    domain: 'native',
    execute: async (_context, args) =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: args.reason,
          targetKind: args.targetKind,
          targetRef: args.targetRef,
          timeoutAt: args.timeoutAt,
          type: args.waitType,
        },
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {
        details: {
          description: 'Optional structured details explaining what input is needed.',
        },
        reason: {
          description: 'Why this delegated run must pause before it can continue.',
          type: 'string',
        },
        targetKind: {
          description:
            'What kind of dependency this run is waiting on. Defaults to human_response.',
          enum: ['human_response', 'upload', 'external', 'mcp_operation'],
          type: 'string',
        },
        targetRef: {
          description: 'Optional stable label for the missing dependency or external operation.',
          type: 'string',
        },
        timeoutAt: {
          description: 'Optional ISO timestamp after which the wait should time out.',
          type: 'string',
        },
        waitType: {
          description: 'Optional wait category. Defaults based on targetKind.',
          enum: ['human', 'upload', 'tool', 'mcp'],
          type: 'string',
        },
      },
      required: ['reason'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'suspend_run'),
    name: 'suspend_run',
    strict: false,
    validateArgs: (args) => toValidationResult(suspendRunArgsSchema.safeParse(args)),
  }

  const resumeDelegatedRunTool: ToolSpec<z.infer<typeof resumeDelegatedRunArgsSchema>> = {
    description:
      'Provide missing input to a suspended delegated child run and wait for that child to continue.',
    domain: 'native',
    execute: async (context, args) => {
      const resumed = await resumeDelegatedRun(context, args)

      if (!resumed.ok) {
        return resumed
      }

      return ok({
        kind: 'waiting' as const,
        wait: {
          description: `Waiting for delegated child run "${resumed.value.childTask}" to continue`,
          targetKind: 'run' as const,
          targetRef: resumed.value.childRunId,
          targetRunId: resumed.value.childRunId,
          type: 'agent' as const,
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        childRunId: {
          description:
            'The childRunId returned by a prior delegated suspended result that this run should resume.',
          type: 'string',
        },
        approve: {
          description:
            'Optional explicit approval decision for a suspended delegated child wait that requires confirmation.',
          type: 'boolean',
        },
        errorMessage: {
          description:
            'Optional rejection or failure message to feed into the suspended child instead of output.',
          type: 'string',
        },
        output: {
          description:
            'The structured input to feed back into the suspended child wait. For a user reply, this is usually a compact object describing that answer.',
        },
        rememberApproval: {
          description:
            'Optional flag for confirmation waits. When true, persist the approval for future matching MCP tool fingerprints.',
          type: 'boolean',
        },
        waitId: {
          description: 'The pending child waitId returned by the suspended delegated result.',
          type: 'string',
        },
      },
      required: ['childRunId', 'waitId'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(
        input.db,
        context.tenantScope,
        context.run,
        'resume_delegated_run',
      ),
    name: 'resume_delegated_run',
    strict: false,
    validateArgs: (args) => toValidationResult(resumeDelegatedRunArgsSchema.safeParse(args)),
  }

  toolRegistry.register(delegateToAgentTool as ToolSpec)
  toolRegistry.register(suspendRunTool as ToolSpec)
  toolRegistry.register(resumeDelegatedRunTool as ToolSpec)
}
