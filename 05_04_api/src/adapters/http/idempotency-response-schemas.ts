import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(200)
const nullableRecordSchema = z.record(z.string(), z.unknown()).nullable()

export const workSessionRecordSchema = z.object({
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  createdByAccountId: idSchema.nullable(),
  deletedAt: z.string().nullable(),
  id: idSchema,
  metadata: nullableRecordSchema,
  rootRunId: idSchema.nullable(),
  status: z.enum(['active', 'archived', 'deleted']),
  tenantId: idSchema,
  title: z.string().nullable(),
  updatedAt: z.string(),
  workspaceId: idSchema.nullable(),
  workspaceRef: z.string().nullable(),
})

export const bootstrapSessionOutputSchema = z.object({
  messageId: idSchema,
  runId: idSchema,
  sessionId: idSchema,
  threadId: idSchema,
})

export const sessionThreadRecordSchema = z.object({
  branchFromMessageId: idSchema.nullable(),
  branchFromSequence: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  createdByAccountId: idSchema.nullable(),
  id: idSchema,
  parentThreadId: idSchema.nullable(),
  sessionId: idSchema,
  status: z.enum(['active', 'merged', 'archived', 'deleted']),
  tenantId: idSchema,
  title: z.string().nullable(),
  titleSource: z.enum(['manual', 'auto_first_message', 'manual_regenerate']).nullable(),
  updatedAt: z.string(),
})

export const postThreadMessageOutputSchema = z.object({
  messageId: idSchema,
  sequence: z.number().int().nonnegative(),
  sessionId: idSchema,
  threadId: idSchema,
})

const pendingWaitSchema = z.object({
  args: z.record(z.string(), z.unknown()).nullable(),
  callId: idSchema,
  createdAt: z.string(),
  description: z.string().nullable(),
  requiresApproval: z.boolean().optional(),
  targetKind: z.string().trim().min(1).max(200),
  targetRef: z.string().nullable(),
  tool: z.string().trim().min(1).max(300),
  type: z.string().trim().min(1).max(100),
  waitId: idSchema,
})

const usageSchema = z
  .object({
    cachedTokens: z.number().int().nonnegative().nullable().optional(),
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    reasoningTokens: z.number().int().nonnegative().nullable().optional(),
    totalTokens: z.number().int().nonnegative().nullable().optional(),
  })
  .nullable()

export const completedRunExecutionOutputSchema = z.object({
  assistantItemId: idSchema.nullable(),
  assistantMessageId: idSchema.nullable(),
  model: z.string().trim().min(1).max(200),
  outputText: z.string(),
  provider: z.enum(['openai', 'google']),
  responseId: z.string().nullable(),
  runId: idSchema,
  status: z.literal('completed'),
  usage: usageSchema,
})

export const waitingRunExecutionOutputSchema = z.object({
  assistantItemId: z.null(),
  assistantMessageId: z.null(),
  model: z.string().trim().min(1).max(200),
  outputText: z.string(),
  pendingWaits: z.array(pendingWaitSchema),
  provider: z.enum(['openai', 'google']),
  responseId: z.string().nullable(),
  runId: idSchema,
  status: z.literal('waiting'),
  usage: usageSchema,
  waitIds: z.array(idSchema),
})

export const runExecutionOutputSchema = z.union([
  completedRunExecutionOutputSchema,
  waitingRunExecutionOutputSchema,
])

export const bootstrapSessionExecutionOutputSchema = z.intersection(
  z.object({
    inputMessageId: idSchema,
    sessionId: idSchema,
    threadId: idSchema,
  }),
  runExecutionOutputSchema,
)

export const bootstrapSessionRouteOutputSchema = z.union([
  bootstrapSessionOutputSchema,
  bootstrapSessionExecutionOutputSchema,
])

export const cancelRunOutputSchema = z.object({
  runId: idSchema,
  status: z.enum(['cancelled', 'cancelling']),
})

export const startThreadInteractionOutputSchema = z.intersection(
  z.object({
    attachedFileIds: z.array(idSchema),
    inputMessageId: idSchema,
    sessionId: idSchema,
    threadId: idSchema,
  }),
  runExecutionOutputSchema,
)
