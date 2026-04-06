import type { FunctionToolDefinition, ToolCall } from '../ai/index.js'
import type { Actor, Task } from '../domain.js'
import type { Runtime } from '../runtime.js'
import { getAgentDefinition } from '../agents/index.js'
import type { ActorToolName, ActorToolConfig, ToolExecutionOutcome, ToolHandler } from './types.js'
import { isActorToolName } from './types.js'

import { definition as createActorDef,  handle as createActorHandle }  from './actor/create.js'
import { definition as delegateTaskDef, handle as delegateTaskHandle } from './task/delegate.js'
import { definition as completeTaskDef, handle as completeTaskHandle } from './task/complete.js'
import { definition as blockTaskDef,    handle as blockTaskHandle }    from './task/block.js'
import { definition as readArtifactDef, handle as readArtifactHandle } from './artifact/read.js'
import { definition as writeArtifactDef,handle as writeArtifactHandle } from './artifact/write.js'
import { definition as sendEmailDef,   handle as sendEmailHandle }   from './email/send.js'

// ── Registry ────────────────────────────────────────────────────────────────

interface RegisteredTool {
  definition: FunctionToolDefinition
  handler: ToolHandler
}

const registry: Record<ActorToolName, RegisteredTool> = {
  create_actor:   { definition: createActorDef,   handler: createActorHandle },
  delegate_task:  { definition: delegateTaskDef,  handler: delegateTaskHandle },
  complete_task:  { definition: completeTaskDef,  handler: completeTaskHandle },
  block_task:     { definition: blockTaskDef,     handler: blockTaskHandle },
  read_artifact:  { definition: readArtifactDef,  handler: readArtifactHandle },
  write_artifact: { definition: writeArtifactDef, handler: writeArtifactHandle },
  send_email:     { definition: sendEmailDef,     handler: sendEmailHandle },
}

// ── Public API ──────────────────────────────────────────────────────────────

export const toolDefinitions: Record<ActorToolName, FunctionToolDefinition> =
  Object.fromEntries(
    Object.entries(registry).map(([name, tool]) => [name, tool.definition]),
  ) as Record<ActorToolName, FunctionToolDefinition>

export async function executeToolCall(
  call: ToolCall,
  task: Task,
  actor: Actor,
  rt: Runtime,
): Promise<ToolExecutionOutcome> {
  const tool = registry[call.name as ActorToolName]
  if (!tool) throw new Error(`Unknown tool: ${call.name}`)
  return tool.handler({ call, task, actor, rt })
}

export const getActorConfig = (actor: Actor): ActorToolConfig => {
  const capabilities = actor.capabilities ?? {}
  const definition = getAgentDefinition(actor.name)

  const tools = Array.isArray(capabilities.tools)
    ? capabilities.tools.filter(isActorToolName)
    : definition?.tools ?? ['complete_task', 'block_task']

  const webSearch = capabilities.webSearch === true || definition?.webSearch === true

  return {
    instructions:
      typeof capabilities.instructions === 'string'
        ? capabilities.instructions
        : definition?.instructions
          ?? 'Use the available tools to finish the task.',
    tools,
    webSearch,
  }
}

