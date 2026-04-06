import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { ACTOR_TOOL_NAMES } from '../types.js'
import { uuid } from '../../domain.js'
import { getAgentDefinition, agentNames } from '../../agents/index.js'
import { log } from '../../log.js'
import { getString, getOptionalString, getToolNameArray } from '../args.js'

export const definition: FunctionToolDefinition = {
  name: 'create_actor',
  description: [
    'Create or update a specialist actor in this session.',
    `For registry agents (${agentNames.join(', ')}), only "name" is needed — tools and instructions are predefined.`,
    'For custom agents, provide all three fields.',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Actor name. Use a registry name for predefined config, or a custom name for ad-hoc agents.' },
      instructions: { type: 'string', description: 'Role instructions (required only for non-registry actors)' },
      tools: {
        type: 'array',
        description: 'Allowed tools (required only for non-registry actors)',
        items: { type: 'string', enum: ACTOR_TOOL_NAMES },
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call, task, rt }) => {
  const name = getString(call.arguments.name, 'name')
  const registry = getAgentDefinition(name)

  const tools = registry?.tools
    ?? (call.arguments.tools ? getToolNameArray(call.arguments.tools, 'tools') : undefined)
  const instructions = registry?.instructions
    ?? getOptionalString(call.arguments.instructions)
  const webSearch = registry?.webSearch === true

  if (!tools || tools.length === 0) {
    throw new Error(`"${name}" is not a registry agent — provide tools: [${ACTOR_TOOL_NAMES.join(', ')}]`)
  }
  if (!instructions) {
    throw new Error(`"${name}" is not a registry agent — provide instructions`)
  }

  const actors = await rt.actors.find(a => a.session_id === task.session_id && a.name === name)
  const existing = actors[0]

  if (existing) {
    if (existing.type === 'user') throw new Error(`Cannot overwrite user actor: ${name}`)

    const updated = await rt.actors.update(existing.id, {
      status: 'active',
      capabilities: { tools, instructions, webSearch },
    })
    if (!updated) throw new Error(`Failed to update actor: ${name}`)

    log.info(`Updated actor ${name} with tools: ${tools.join(', ')}${webSearch ? ' +web_search' : ''}`)

    return {
      status: 'continue',
      message: `Updated actor ${updated.name}`,
      output: JSON.stringify({ actorId: updated.id, name: updated.name, created: false, tools, webSearch }),
    }
  }

  const created = await rt.actors.add({
    id: uuid(),
    session_id: task.session_id,
    type: 'agent',
    name,
    status: 'active',
    capabilities: { tools, instructions, webSearch },
  })

  log.info(`Created actor ${name} with tools: ${tools.join(', ')}${webSearch ? ' +web_search' : ''}`)

  return {
    status: 'continue',
    message: `Created actor ${created.name}`,
    output: JSON.stringify({ actorId: created.id, name: created.name, created: true, tools, webSearch }),
  }
}
