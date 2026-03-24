import { resolveAutonomousWorkflow } from './autonomy/index.js'
import { ensureWorkspaceInitialized } from './bootstrap.js'
import { ENV, PATHS, parseBoolean, parsePositiveInt, readFlag } from './config/index.js'
import { logger } from './core/logger.js'
import { runHeartbeatLoop } from './features/heartbeat/index.js'
import { exists } from './helpers/fs.js'
import { createMcpManager } from './mcp/client.js'
import { resolveWorkflow } from './workflows/registry.js'

const rounds = parsePositiveInt(readFlag('--rounds'), 8)
const delayMs = parsePositiveInt(
  readFlag('--delay-ms') ?? process.env.HEARTBEAT_DELAY_MS,
  ENV.heartbeatDelayMs,
)
const autoHuman = parseBoolean(readFlag('--auto-human'), true)
const workflowId = readFlag('--workflow') ?? process.env.WORKFLOW_ID
const goalPathFlag = readFlag('--goal') ?? process.env.AUTONOMY_GOAL_PATH
const shutdownController = new AbortController()

const requestShutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
  if (shutdownController.signal.aborted) return
  logger.warn('shutdown.requested', { signal })
  shutdownController.abort(signal)
}

const main = async (): Promise<void> => {
  const fallbackWorkflow = resolveWorkflow(workflowId)
  const onSigint = () => requestShutdown('SIGINT')
  const onSigterm = () => requestShutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  try {
    if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
      throw new Error(
        'API key is missing. Set OPENAI_API_KEY or OPENROUTER_API_KEY in your environment.',
      )
    }

    const autoGoalPath = goalPathFlag ?? ((await exists(PATHS.GOAL_PATH)) ? PATHS.GOAL_PATH : undefined)
    const autonomy = await resolveAutonomousWorkflow({
      fallbackWorkflow,
      goalPath: autoGoalPath,
    })
    if (autonomy.mode === 'no-go') {
      logger.warn('plan.no-go', {
        message: autonomy.noGoMessage ?? 'No-go',
        path: autonomy.noGoPath,
      })
      return
    }

    const workflow = autonomy.workflow ?? fallbackWorkflow
    await ensureWorkspaceInitialized(workflow)

    const mcp = await createMcpManager(process.cwd())
    try {
      await runHeartbeatLoop({
        workflow,
        rounds,
        delayMs,
        autoHuman,
        shutdownSignal: shutdownController.signal,
        autonomy: autonomy.autonomyContext,
        mcp,
      })
    } finally {
      await mcp.close()
    }
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  logger.error('index.failed', { error: message })
  process.exitCode = 1
})
