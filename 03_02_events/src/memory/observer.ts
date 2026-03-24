/**
 * Observer — extracts structured observations from conversation history.
 *
 * Based on Mastra's Observational Memory system.
 * https://mastra.ai/blog/observational-memory
 */

import OpenAI from 'openai'
import { logger } from '../core/logger.js'
import type { Message } from '../types.js'
import { estimateTokens } from '../helpers/tokens.js'

const MAX_SECTION_CHARS = 6_000
const MAX_TOOL_PAYLOAD_CHARS = 3_000
const OBSERVER_MAX_OUTPUT_TOKENS = 8_000

export interface ObserverResult {
  observations: string
  currentTask?: string
  suggestedResponse?: string
  raw: string
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 3)}...`

const getContent = (message: Message): string => {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ('text' in part ? part.text : `[${part.type}]`))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export const serializeMessages = (messages: Message[]): string =>
  messages
    .map((message, index) => {
      const role = 'role' in message ? message.role : 'unknown'

      if (role === 'tool') {
        const content =
          'content' in message && typeof message.content === 'string' ? message.content : ''
        return `**Tool Result (#${index + 1}):**\n${truncate(content, MAX_TOOL_PAYLOAD_CHARS)}`
      }

      if (role === 'assistant' && 'tool_calls' in message && message.tool_calls?.length) {
        const calls = message.tool_calls
          .map((toolCall) => {
            if (!('function' in toolCall)) return '[Tool: custom] [payload omitted]'
            return `[Tool: ${toolCall.function.name}] ${truncate(toolCall.function.arguments, MAX_TOOL_PAYLOAD_CHARS)}`
          })
          .join('\n')
        const text = message.content
          ? `${truncate(getContent(message), MAX_SECTION_CHARS)}\n${calls}`
          : calls
        return `**Assistant (#${index + 1}):**\n${text}`
      }

      const label = role.charAt(0).toUpperCase() + role.slice(1)
      const content = truncate(getContent(message), MAX_SECTION_CHARS)
      return `**${label} (#${index + 1}):**\n${content || '[empty]'}`
    })
    .filter(Boolean)
    .join('\n\n---\n\n')

const SYSTEM_PROMPT = `You are the memory consciousness of an AI assistant.
Your observations will be the ONLY information the assistant has about past interactions.

Extract high-fidelity observations from conversation history.
Do not chat. Do not explain. Output only structured XML.

Rules:
1) Prioritize user assertions as authoritative facts.
2) Priority markers:
   - 🔴 high: explicit user facts, preferences, decisions, completed goals.
   - 🟡 medium: active work, project details, tool outcomes, unresolved blockers.
   - 🟢 low: tentative or minor details.
3) Preserve concrete details: names, numbers, dates, file paths, quoted phrasing.
4) Capture state changes explicitly ("updating previous preference").
5) Keep observations concise but information-dense.
6) Do NOT repeat observations that already exist in previous observations.

Output format (strict):
<observations>
* 🔴 ...
* 🟡 ...
</observations>

<current-task>
Primary: ...
</current-task>

<suggested-response>
...
</suggested-response>`.trim()

const buildPrompt = (previousObservations: string, messageHistory: string): string =>
  [
    '## Previous Observations',
    '',
    previousObservations || '[none]',
    '',
    '---',
    '',
    'Do not repeat these existing observations. Only extract new ones.',
    '',
    '## New Message History',
    '',
    messageHistory || '[none]',
    '',
    '---',
    '',
    'Extract new observations. Return only XML with <observations>, <current-task>, <suggested-response>.',
  ].join('\n')

const extractTag = (text: string, tag: string): string | undefined => {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.trim() || undefined
}

export const parseObserverOutput = (raw: string): ObserverResult => ({
  observations: extractTag(raw, 'observations') ?? raw.trim(),
  currentTask: extractTag(raw, 'current-task'),
  suggestedResponse: extractTag(raw, 'suggested-response'),
  raw,
})

export const runObserver = async (
  openai: OpenAI,
  model: string,
  previousObservations: string,
  messages: Message[],
): Promise<ObserverResult> => {
  const history = serializeMessages(messages)
  if (!history.trim()) {
    return { observations: '', raw: '' }
  }

  logger.info('memory.observer.started', {
    messages: messages.length,
    estimated_tokens: estimateTokens(history),
  })

  const response = await openai.chat.completions.create(
    {
      model,
      temperature: 0.3,
      max_completion_tokens: OBSERVER_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(previousObservations, history) },
      ],
    },
    { signal: AbortSignal.timeout(30_000) },
  )

  const raw = response.choices[0]?.message?.content ?? ''
  const result = parseObserverOutput(raw)
  const lineCount = result.observations.split('\n').filter((line) => line.trim()).length

  logger.info('memory.observer.completed', {
    observation_lines: lineCount,
    estimated_tokens: estimateTokens(result.observations),
  })

  return result
}
