import { uuid, now } from './domain.js'
import type { Runtime } from './runtime.js'
import { createRuntime, addItem, addRelation } from './runtime.js'
import { processSession } from './scheduler/index.js'
import { getAgentDefinition, bootstrapAgents } from './agents/index.js'
import { log } from './log.js'
import { describeLlm } from './ai/index.js'
import { startServer } from './server.js'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const openBrowser = (url: string) => {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] }

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
  })

  child.unref()
}

const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '…' : s
const statusIcon = (s: string) =>
  ({ todo: '○', in_progress: '◐', waiting: '⏸', blocked: '◆', done: '●' }[s] ?? '?')

async function resolveLabel(kind: string, id: string, rt: Runtime): Promise<string> {
  switch (kind) {
    case 'actor': { const a = await rt.actors.getById(id); return a?.name ?? id.slice(0, 8) }
    case 'task':  { const t = await rt.tasks.getById(id); return t ? truncate(t.title, 44) : id.slice(0, 8) }
    case 'artifact': { const a = await rt.artifacts.getById(id); return a?.path ?? id.slice(0, 8) }
    default: return id.slice(0, 8)
  }
}

async function startSession(userMessage: string, rt: Runtime) {
  const session = await rt.sessions.add({
    id: uuid(), title: userMessage,
    status: 'active', created_at: now(), updated_at: now(),
  })

  const user = await rt.actors.add({
    id: uuid(), session_id: session.id, type: 'user',
    name: 'alice', status: 'active',
  })

  const agents = await Promise.all(
    bootstrapAgents.map(name => {
      const def = getAgentDefinition(name)!
      return rt.actors.add({
        id: uuid(), session_id: session.id, type: def.type,
        name: def.name, status: 'active',
        capabilities: { tools: def.tools, instructions: def.instructions },
      })
    }),
  )

  const orchestrator = agents.find(a => a.name === 'orchestrator')!

  const rootTask = await rt.tasks.add({
    id: uuid(), session_id: session.id, owner_actor_id: orchestrator.id,
    title: 'Handle user request', status: 'todo', priority: 1, created_at: now(),
  })

  await addItem(rt, session.id, 'message', {
    role: 'user', text: userMessage,
  }, { taskId: rootTask.id, actorId: user.id })

  await addRelation(rt, session.id, 'task', rootTask.id, 'assigned_to', 'actor', orchestrator.id)

  return { session, user, orchestrator, rootTask }
}

async function main() {
  const userMessage = process.argv[2] ?? 'Write a comprehensive blog post about TypeScript 5.0 features'

  await rm('.data', { recursive: true, force: true })
  const rt = await createRuntime()

  const { url } = await startServer(rt)
  openBrowser(url)
  await new Promise(resolve => setTimeout(resolve, 800))

  log.header(`Multi-Agent Core Schema — ${describeLlm()}`)

  const { session, orchestrator } = await startSession(userMessage, rt)
  log.info(`Session: "${session.title}"`)
  log.info(`Orchestrator: ${orchestrator.name}`)

  log.header('Processing')

  await processSession(session.id, rt)

  const allTasks = await rt.tasks.find(t => t.session_id === session.id)
  const allDone = allTasks.length > 0 && allTasks.every(t => t.status === 'done')
  await rt.sessions.update(session.id, {
    status: allDone ? 'done' : 'paused',
    updated_at: now(),
  })

  // ── Post-run summary (terminal only) ────────────────────────────────────

  log.header('Graph Summary')

  const [sessions, actors, tasks, items, artifacts, relations] = await Promise.all([
    rt.sessions.all(), rt.actors.all(), rt.tasks.all(),
    rt.items.all(), rt.artifacts.all(), rt.relations.all(),
  ])

  log.summary('sessions', sessions.length)
  log.summary('actors', actors.length)
  log.summary('tasks', tasks.length)
  log.summary('items', items.length)
  log.summary('artifacts', artifacts.length)
  log.summary('relations', relations.length)

  const usage = sessions[0]?.usage
  if (usage) {
    const cacheRate = usage.inputTokens > 0
      ? Math.round((usage.cachedTokens / usage.inputTokens) * 100)
      : 0
    log.summary('tokens (in/out/cached)', `${usage.inputTokens} / ${usage.outputTokens} / ${usage.cachedTokens}`)
    log.summary('cache hit rate', `${cacheRate}%`)
  }

  log.header('Relations')

  for (const rel of relations) {
    const from = await resolveLabel(rel.from_kind, rel.from_id, rt)
    const to = await resolveLabel(rel.to_kind, rel.to_id, rt)
    console.log(`  [${rel.from_kind}] ${from} ──${rel.relation_type}──▸ [${rel.to_kind}] ${to}`)
  }

  log.header('Task Tree')

  const roots = tasks.filter(t => !t.parent_task_id)
  for (const t of roots) {
    console.log(`  ${statusIcon(t.status)} ${t.title}`)
    const children = tasks.filter(c => c.parent_task_id === t.id)
    for (const c of children) {
      console.log(`    ${statusIcon(c.status)} ${c.title}`)
    }
  }

  log.header('Artifacts')

  for (const a of artifacts) {
    console.log(`  [${a.kind.padEnd(4)}] ${a.path}  v${a.version}  (${a.metadata?.chars ?? '?'} chars)`)
  }

  log.success('All data persisted to .data/')
  log.done()

  log.info(`Dashboard still live at ${url} — Ctrl+C to stop`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
