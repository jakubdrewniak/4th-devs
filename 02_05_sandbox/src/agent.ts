import type OpenAI from 'openai'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { findTool, tools } from './tools.js'
import { openai, resolveModelForProvider } from './config.js'
const MAX_DEPTH = 3
const MAX_TURNS = 15
const WORKSPACE = join(process.cwd(), 'workspace')

const truncate = (s: string, max = 100): string =>
  s.length > max ? s.slice(0, max) + '…' : s

interface AgentTemplate {
  name: string
  model: string
  tools: string[]
  systemPrompt: string
}

async function loadAgent(name: string): Promise<AgentTemplate> {
  const filePath = join(WORKSPACE, 'agents', `${name}.agent.md`)
  const raw = await readFile(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return {
    name: data.name ?? name,
    model: typeof data.model === 'string' ? data.model : 'openai:gpt-4.1-mini',
    tools: Array.isArray(data.tools) ? data.tools : [],
    systemPrompt: content.trim(),
  }
}

export async function runAgent(
  agentName: string,
  task: string,
  depth: number = 0
): Promise<string> {
  try {
    if (depth > MAX_DEPTH) {
      return 'Max agent depth exceeded'
    }

    console.log(`\n[${agentName}] Starting (depth: ${depth})`)

    const template = await loadAgent(agentName)
    const rawModel = template.model.startsWith('openai:')
      ? template.model.slice(7)
      : template.model
    const model = resolveModelForProvider(rawModel) as string

    const agentTools = template.tools
      .map((name) => tools.find((t) => t.definition.name === name))
      .filter((t): t is NonNullable<typeof t> => t != null)

    const openaiTools = agentTools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }))

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: template.systemPrompt },
      { role: 'user', content: task },
    ]

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await openai.chat.completions.create({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
      })

      const message = response.choices[0]?.message
      if (!message) return 'Agent error: No response from model'

      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      })

      if (!message.tool_calls || message.tool_calls.length === 0) {
        console.log(`[${agentName}] Completed`)
        return message.content ?? ''
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue

        const name = toolCall.function.name
        let args: Record<string, unknown> = {}
        try {
          const raw = toolCall.function.arguments
          args = typeof raw === 'string' && raw.trim()
            ? (JSON.parse(raw) as Record<string, unknown>)
            : {}
        } catch {
          args = {}
        }

        console.log(`[${agentName}] Tool: ${name}(${truncate(JSON.stringify(args))})`)

        const tool = findTool(name)
        const result = tool
          ? await tool.handler(args)
          : `Unknown tool: ${name}`

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
    }

    return 'Agent exceeded maximum turns'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${agentName}] Error:`, msg)
    return `Agent error: ${msg}`
  }
}
