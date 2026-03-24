import { createInterface } from 'node:readline/promises'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveAutonomousWorkflow } from './src/autonomy/index.js'
import { ensureWorkspaceInitialized } from './src/bootstrap.js'
import { PATHS, parseBoolean, parsePositiveInt, readFlag } from './src/config/index.js'
import { logger } from './src/core/logger.js'
import { runHeartbeatLoop } from './src/features/heartbeat/index.js'
import { countTasksByStatus, listTasks } from './src/features/tasks/index.js'
import { exists } from './src/helpers/fs.js'
import { createMcpManager } from './src/mcp/client.js'
import { resolveWorkflow } from './src/workflows/registry.js'
import type { WorkflowDefinition } from './src/workflows/types.js'

const WORKSPACE = PATHS.WORKSPACE_DIR
const EVENTS_DIR = PATHS.EVENTS_DIR
const MEMORY_DIR = PATHS.MEMORY_DIR

const blue = (text: string): string => `\x1b[34m${text}\x1b[0m`
const green = (text: string): string => `\x1b[32m${text}\x1b[0m`
const yellow = (text: string): string => `\x1b[33m${text}\x1b[0m`
const cyan = (text: string): string => `\x1b[36m${text}\x1b[0m`
const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`
const timestamp = (): string => new Date().toISOString()
const log = (message: string): void => {
  console.log(`[${timestamp()}] ${message}`)
}
const logDim = (message: string): void => {
  console.log(`${dim(`[${timestamp()}]`)} ${message}`)
}

const resetWorkspaceForDemo = async (): Promise<void> => {
  const resetTargets = [
    'tasks',
    'notes',
    'assets',
    'report',
    'deliverables',
    'work',
    'system',
    'no-go.md',
    'goal.md',
    'project.md',
  ].map((target) => join(WORKSPACE, target))

  await Promise.all(resetTargets.map((target) => rm(target, { recursive: true, force: true })))
}

const countFilesRecursive = async (dir: string): Promise<number> => {
  if (!(await exists(dir))) return 0
  const entries = await readdir(dir, { withFileTypes: true })

  let total = 0
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isFile()) {
      total += 1
      continue
    }
    if (entry.isDirectory()) {
      total += await countFilesRecursive(fullPath)
    }
  }
  return total
}

const printSummary = async (workflow: WorkflowDefinition): Promise<void> => {
  const status = await countTasksByStatus()
  const tasks = await listTasks()
  const roundFiles = (await exists(EVENTS_DIR))
    ? (await readdir(EVENTS_DIR)).filter((file) => file.startsWith('round-') && file.endsWith('.md'))
    : []

  console.log('\n' + blue('━━━ Demo Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(
    `${green('Task status:')} done=${status.done} open=${status.open} blocked=${status.blocked} waiting-human=${status['waiting-human']}`,
  )
  for (const task of tasks) {
    console.log(
      dim(
        `  • ${task.frontmatter.id} [${task.frontmatter.owner}] ${task.frontmatter.status}`,
      ),
    )
  }

  const eventCount = await countFilesRecursive(EVENTS_DIR)
  const memoryCount = await countFilesRecursive(MEMORY_DIR)
  console.log(
    `${cyan('Artifacts:')} rounds=${roundFiles.length} event_files=${eventCount} memory_logs=${memoryCount}`,
  )
  console.log(dim(`  workspace/project/system/events/events.jsonl`))
  console.log(dim(`  workspace/project/${workflow.project.deliverablePath}`))
  console.log(dim(`  workspace/project/system/memory/`))

  const finalDeliverablePath = join(WORKSPACE, workflow.project.deliverablePath)

  if (await exists(finalDeliverablePath)) {
    const report = await readFile(finalDeliverablePath, 'utf-8')
    const preview = report.split('\n').slice(0, 14).join('\n')
    console.log('\n' + yellow('Final report preview:'))
    console.log(preview)
  } else {
    console.log(yellow('\nFinal report is not ready yet. Increase --rounds and rerun demo.'))
  }
}

const rounds = parsePositiveInt(readFlag('--rounds'), 8)
const delayMs = parsePositiveInt(
  readFlag('--delay-ms') ?? process.env.HEARTBEAT_DELAY_MS,
  650,
)
const autoHuman = parseBoolean(readFlag('--auto-human'), true)
const reset = parseBoolean(readFlag('--reset'), true)
const workflowId = readFlag('--workflow') ?? process.env.WORKFLOW_ID
const goalPathFlag = readFlag('--goal') ?? process.env.AUTONOMY_GOAL_PATH
const shutdownController = new AbortController()

const requestShutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
  if (shutdownController.signal.aborted) return
  logDim(`\nReceived ${signal}. Finishing current round, then exiting...`)
  shutdownController.abort(signal)
}

const main = async (): Promise<void> => {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error('API key is missing. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env')
  }

  const fallbackWorkflow = resolveWorkflow(workflowId)
  const onSigint = () => requestShutdown('SIGINT')
  const onSigterm = () => requestShutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  try {
    console.log(blue('━━━ 03_02_events Demo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))

    if (reset) {
      logDim('Resetting workspace demo state...')
      await resetWorkspaceForDemo()
    }

    const autoGoalPath = goalPathFlag ?? ((await exists(PATHS.GOAL_PATH)) ? PATHS.GOAL_PATH : undefined)

    const planProgress = (step: string, detail?: string): void => {
      const tag = cyan(`[plan:${step}]`)
      log(`${tag} ${detail ?? ''}`)
    }

    const autonomy = await resolveAutonomousWorkflow({
      fallbackWorkflow,
      goalPath: autoGoalPath,
      onProgress: planProgress,
    })
    if (autonomy.mode === 'no-go') {
      log(
        yellow(`No-go: ${autonomy.noGoMessage ?? 'Planner rejected the goal.'} (${autonomy.noGoPath})`),
      )
      return
    }

    const workflow = autonomy.workflow ?? fallbackWorkflow
    logDim(
      `workflow=${workflow.id} rounds=${rounds} delayMs=${delayMs} autoHuman=${autoHuman} reset=${reset}`,
    )
    await ensureWorkspaceInitialized(workflow)

    logDim('Connecting MCP servers...')
    const mcp = await createMcpManager(process.cwd())
    const mcpServers = mcp.servers()
    if (mcpServers.length > 0) {
      const mcpTools = await mcp.listTools()
      logDim(`MCP ready: ${mcpServers.join(', ')} (${mcpTools.map((t) => t.prefixedName).join(', ')})`)
    } else {
      logDim('No MCP servers configured.')
    }

    logDim('Starting heartbeat...\n')

    try {
      await runHeartbeatLoop({
        workflow,
        rounds,
        delayMs,
        autoHuman,
        verbose: true,
        shutdownSignal: shutdownController.signal,
        autonomy: autonomy.autonomyContext,
        mcp,
      })

      await printSummary(workflow)
    } finally {
      await mcp.close()
    }
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

const confirmRun = async (): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(yellow('\n  ⚠  UWAGA: To demo wykonuje wiele zapytań do API (LLM, web search, scrape).'))
    console.log(yellow('     Pojedyncze uruchomienie może zużyć znaczną liczbę tokenów i zająć kilka minut.\n'))
    console.log(dim('     Jeśli chcesz tylko podejrzeć wyniki, zajrzyj do folderu:'))
    console.log(cyan('     workspace/demo/\n'))
    const answer = await rl.question('  Czy chcesz kontynuować? Wpisz "yes" aby uruchomić demo: ')
    return answer.trim().toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

const skipConfirm = parseBoolean(readFlag('--yes'), false)

const run = async (): Promise<void> => {
  if (!skipConfirm) {
    const confirmed = await confirmRun()
    if (!confirmed) {
      console.log(dim('\n  Anulowano. Podejrzyj wyniki w workspace/demo/\n'))
      return
    }
  }
  await main()
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  logger.error('demo.failed', { error: message })
  process.exitCode = 1
})
