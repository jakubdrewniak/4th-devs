import { z } from 'zod'
import type { RunId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import type { RunExecutionOutput } from '../runtime/drive-run'
import { waitForRunToReachDurableState } from '../runtime/run-execution-convergence'
import {
  type RunWaitResolutionInput,
  type RunWaitResolutionState,
  resolveRunWait,
} from '../runtime/run-wait-resolution'
import type { CommandContext, CommandResult } from './command-context'

const resumeRunInputSchema = z
  .object({
    approve: z.boolean().optional(),
    errorMessage: z.string().trim().min(1).max(10_000).optional(),
    maxOutputTokens: z.number().int().positive().max(100_000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelAlias: z.string().trim().min(1).max(200).optional(),
    output: z.unknown().optional(),
    provider: z.enum(['openai', 'google']).optional(),
    rememberApproval: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    waitId: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) =>
      value.approve !== undefined || value.output !== undefined || value.errorMessage !== undefined,
    {
      message: 'Either approve, output, or errorMessage is required',
    },
  )

export type ResumeRunInput = z.infer<typeof resumeRunInputSchema>
export type RuntimeResumeRunInput = RunWaitResolutionInput
export type ResumeRunOutput = RunExecutionOutput
export type ResumeRunResolutionState = RunWaitResolutionState

export const parseResumeRunInput = (input: unknown): CommandResult<ResumeRunInput> => {
  const parsed = resumeRunInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export { resolveRunWait }

export const createResumeRunCommand = () => ({
  execute: async (
    context: CommandContext,
    runId: RunId,
    input: RuntimeResumeRunInput,
  ): Promise<CommandResult<ResumeRunOutput>> => {
    const resolved = await resolveRunWait(context, runId, input)

    if (!resolved.ok) {
      return resolved
    }

    if (resolved.value.kind === 'waiting') {
      return ok(resolved.value.output)
    }

    return waitForRunToReachDurableState(context, runId, {
      message: `run ${runId} did not resume after its waits were resolved`,
      type: 'conflict',
    })
  },
})
