import type { ResponseInput } from '../ai/index.js'
import type { Actor, Artifact, Item, Task } from '../domain.js'
import type { Runtime } from '../runtime.js'
import type { GraphQueries } from './graph.js'
import { agentNames } from '../agents/index.js'

const getActorToolNames = (actor: Actor): string[] =>
  Array.isArray(actor.capabilities?.tools)
    ? actor.capabilities.tools.filter((t): t is string => typeof t === 'string')
    : []

const truncate = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

const safeJson = (value: unknown, fallback: string): string => {
  try {
    return JSON.stringify(value) ?? fallback
  } catch {
    return fallback
  }
}

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string'
    ? value
    : value == null
      ? fallback
      : safeJson(value, fallback)

const getActiveTaskItems = (items: Item[], lastObservedSeq: number): Item[] =>
  items
    .filter(item => item.sequence > lastObservedSeq)
    .sort((a, b) => a.sequence - b.sequence)

const toDelegationMessage = (item: Item): string => {
  const fromActor = typeof item.content.fromActor === 'string'
    ? ` from ${item.content.fromActor}`
    : ''
  const text = asText(item.content.text, '')
  return `Delegated instructions${fromActor}:\n\n${text}`.trim()
}

const toInputItem = (item: Item): ResponseInput[number] | null => {
  switch (item.type) {
    case 'message': {
      const role = typeof item.content.role === 'string' ? item.content.role : 'user'
      const text = role === 'delegator'
        ? toDelegationMessage(item)
        : asText(item.content.text, '')

      if (!text.trim()) return null
      return {
        type: 'message',
        role: 'user',
        content: text,
      }
    }

    case 'decision': {
      const text = asText(item.content.text, '')
      if (!text.trim()) return null
      return {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: text,
      }
    }

    case 'invocation': {
      const callId = asText(item.content.callId, '')
      const tool = asText(item.content.tool, '')
      if (!callId || !tool) return null
      return {
        type: 'function_call',
        call_id: callId,
        name: tool,
        arguments: safeJson(item.content.input ?? {}, '{}'),
        status: 'completed',
      }
    }

    case 'result': {
      const callId = asText(item.content.callId, '')
      if (!callId) return null
      return {
        type: 'function_call_output',
        call_id: callId,
        output: asText(item.content.output, ''),
        status: 'completed',
      }
    }
  }
}

const formatTaskLine = (task: Task, ownerNames: Map<string, string>): string => {
  const owner = task.owner_actor_id ? ownerNames.get(task.owner_actor_id) ?? '?' : '?'
  const recoveryNote = task.recovery?.autoRetry && task.recovery.nextRetryAt
    ? `retry_at=${task.recovery.nextRetryAt}`
    : typeof task.recovery?.lastFailureMessage === 'string'
      ? `note=${truncate(task.recovery.lastFailureMessage)}`
      : null

  return [
    `- ${task.id}`,
    task.status,
    `owner=${owner}`,
    recoveryNote,
    task.title,
  ].filter(Boolean).join(' | ')
}

export async function buildTaskPromptPrefix(
  task: Task,
  actor: Actor,
  rt: Runtime,
): Promise<string> {
  const session = await rt.sessions.getById(task.session_id)
  if (!session) throw new Error(`Session not found: ${task.session_id}`)

  return [
    'You are continuing a task inside a blackboard-style multi-agent system.',
    'Older sealed execution history is available only through task memory. Raw task items are appended separately and include only the unobserved tail.',
    '',
    `Session title: ${session.title}`,
    session.goal ? `Session goal: ${session.goal}` : null,
    '',
    `Current actor: ${actor.name} (${actor.type})`,
    `Current task id: ${task.id}`,
    `Current task title: ${task.title}`,
    `Current task priority: ${task.priority}`,
    task.parent_task_id ? `Parent task id: ${task.parent_task_id}` : null,
    '',
    `Agent registry (use these exact names with create_actor to get predefined tools and instructions): ${agentNames.join(', ')}`,
    '',
    'Rules:',
    '- ALWAYS use tools to change state. Plain text alone does nothing — the scheduler will block your task if you respond without tool calls.',
    '- To create a new specialist, call create_actor with a name from the agent registry, then delegate_task.',
    '- If you need another actor to work, use delegate_task with an existing actor name.',
    '- You may delegate multiple child tasks in one turn when they can run independently.',
    '- Use dependsOnTaskIds when one delegated task must wait for another.',
    '- If you need source material, use read_artifact.',
    '- If you produce a document or notes, use write_artifact.',
    '- You MUST call complete_task when the current task is finished. It is the only way to mark a task done.',
    '- Do not call block_task just because child tasks are in flight; the scheduler waits automatically and resumes you later.',
    '- If you cannot progress and there is no child work in flight, call block_task.',
  ].filter(Boolean).join('\n')
}

async function getChildTaskArtifacts(
  task: Task,
  rt: Runtime,
  graph: GraphQueries,
): Promise<Artifact[]> {
  const children = await rt.tasks.find(t => t.parent_task_id === task.id)
  const all = (await Promise.all(
    children.map(c => graph.getArtifactsProducedByTask(c.id)),
  )).flat()
  return all
}

async function buildTaskSnapshot(
  task: Task,
  rt: Runtime,
  graph: GraphQueries,
): Promise<string> {
  const [actors, tasks, depTasks, depArtifacts, ownArtifacts, childArtifacts] = await Promise.all([
    graph.getSessionActors(task.session_id),
    graph.getSessionTasks(task.session_id),
    graph.getDependencyTasks(task),
    graph.getDependencyArtifacts(task),
    graph.getArtifactsProducedByTask(task.id),
    getChildTaskArtifacts(task, rt, graph),
  ])

  const ownerNames = new Map(actors.map(a => [a.id, a.name]))

  return [
    'Current task snapshot:',
    '',
    'Available actors:',
    ...actors.map(a => `- ${a.name} (${a.type}) tools=${getActorToolNames(a).join(', ') || 'none'}`),
    '',
    'Current session tasks:',
    ...tasks.sort((a, b) => a.priority - b.priority).map(t => formatTaskLine(t, ownerNames)),
    '',
    depTasks.length > 0 ? 'Dependency tasks:' : 'Dependency tasks: none',
    ...depTasks.map(t => `- ${t.id} | ${t.status} | ${t.title}`),
    '',
    depArtifacts.length > 0 ? 'Dependency artifacts available to read:' : 'Dependency artifacts available to read: none',
    ...depArtifacts.map(a => `- ${a.id} | ${a.path} | kind=${a.kind} | version=${a.version}`),
    '',
    childArtifacts.length > 0 ? 'Artifacts produced by child tasks:' : 'Artifacts produced by child tasks: none',
    ...childArtifacts.map(a => `- ${a.id} | ${a.path} | kind=${a.kind} | version=${a.version}`),
    '',
    ownArtifacts.length > 0 ? 'Artifacts already produced by this task:' : 'Artifacts already produced by this task: none',
    ...ownArtifacts.map(a => `- ${a.id} | ${a.path} | kind=${a.kind} | version=${a.version}`),
  ].filter(Boolean).join('\n')
}

export async function buildTaskRunInput(
  task: Task,
  rt: Runtime,
  graph: GraphQueries,
  promptPrefix: string,
): Promise<ResponseInput> {
  const currentTask = await rt.tasks.getById(task.id)
  if (!currentTask) throw new Error(`Task not found: ${task.id}`)

  const taskItems = await graph.getTaskItems(currentTask.id)
  const activeTaskItems = getActiveTaskItems(taskItems, currentTask.memory?.lastObservedSeq ?? 0)
  const observations = currentTask.memory?.observations?.trim()
  const snapshot = await buildTaskSnapshot(currentTask, rt, graph)

  return [
    {
      type: 'message',
      role: 'user',
      content: promptPrefix,
    },
    ...(observations
      ? [{
          type: 'message' as const,
          role: 'user' as const,
          content: [
            'Task memory (sealed older work from this task thread):',
            '',
            observations,
          ].join('\n'),
        }]
      : []),
    {
      type: 'message',
      role: 'user',
      content: snapshot,
    },
    ...activeTaskItems
      .map(toInputItem)
      .filter((item): item is ResponseInput[number] => item !== null),
  ]
}
