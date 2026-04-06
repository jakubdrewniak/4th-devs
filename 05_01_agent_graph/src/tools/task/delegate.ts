import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { uuid, now } from '../../domain.js'
import { addItem, ensureRelation } from '../../runtime.js'
import { log } from '../../log.js'
import { getString, getPositiveInteger, getStringArray } from '../args.js'

export const definition: FunctionToolDefinition = {
  name: 'delegate_task',
  description: 'Create a child task assigned to an existing actor. Use returned task ids when creating dependency chains.',
  parameters: {
    type: 'object',
    properties: {
      actorName: { type: 'string', description: 'Target actor name, e.g. researcher or writer' },
      title: { type: 'string', description: 'Short task title' },
      instructions: { type: 'string', description: 'Detailed instructions for the delegated task' },
      priority: { type: 'integer', description: 'Lower runs first. Default 1' },
      dependsOnTaskIds: {
        type: 'array',
        description: 'Task ids that must finish before this task can run',
        items: { type: 'string' },
      },
    },
    required: ['actorName', 'title', 'instructions'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call, task, actor, rt }) => {
  const actorName = getString(call.arguments.actorName, 'actorName')
  const title = getString(call.arguments.title, 'title')
  const instructions = getString(call.arguments.instructions, 'instructions')
  const priority = getPositiveInteger(call.arguments.priority, 1)
  const dependsOnTaskIds = getStringArray(call.arguments.dependsOnTaskIds)

  const assignees = await rt.actors.find(a => a.session_id === task.session_id && a.name === actorName)
  const assignee = assignees[0]
  if (!assignee) throw new Error(`Unknown actor: ${actorName}`)

  log.delegate(actor.name, assignee.name, title)

  const childTask = await rt.tasks.add({
    id: uuid(), session_id: task.session_id, parent_task_id: task.id,
    owner_actor_id: assignee.id, title,
    status: dependsOnTaskIds.length > 0 ? 'waiting' : 'todo',
    priority, created_at: now(),
  })

  await ensureRelation(rt, task.session_id, 'task', childTask.id, 'assigned_to', 'actor', assignee.id)
  for (const depTaskId of dependsOnTaskIds) {
    await ensureRelation(rt, task.session_id, 'task', childTask.id, 'depends_on', 'task', depTaskId)
  }

  await addItem(rt, task.session_id, 'message', {
    role: 'delegator', text: instructions, fromActor: actor.name,
  }, { taskId: childTask.id, actorId: actor.id })

  return {
    status: 'continue',
    message: `Delegated "${title}" to ${assignee.name}. The scheduler will resume this task after child work finishes.`,
    output: JSON.stringify({
      taskId: childTask.id, actorName: assignee.name,
      title: childTask.title, status: childTask.status, dependsOnTaskIds,
    }),
  }
}
