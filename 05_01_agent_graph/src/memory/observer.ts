/**
 * Observer — extracts structured observations from session items.
 *
 * Adapted from Mastra's Observational Memory system for multi-agent task graphs.
 * https://mastra.ai/blog/observational-memory
 */

import type { Item, TokenUsage } from '../domain.js'
import { emptyUsage } from '../domain.js'
import { generateText } from '../ai/index.js'

const MAX_SECTION_CHARS = 6_000
const MAX_TOOL_CHARS = 3_000

export interface ObserverResult {
  observations: string
  raw: string
  usage: TokenUsage
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 3)}…`

export const serializeItems = (
  items: Item[],
  actorNames: Map<string, string>,
): string =>
  items
    .sort((a, b) => a.sequence - b.sequence)
    .map(item => {
      const actor = item.actor_id ? actorNames.get(item.actor_id) ?? 'unknown' : 'system'
      switch (item.type) {
        case 'message':
          return `[${actor}] ${truncate(String(item.content.text ?? item.content.role ?? ''), MAX_SECTION_CHARS)}`
        case 'decision':
          return `[${actor}] decided: ${truncate(String(item.content.text ?? ''), MAX_SECTION_CHARS)}`
        case 'invocation':
          return `[${actor}] called ${item.content.tool}(${truncate(JSON.stringify(item.content.input ?? {}), MAX_TOOL_CHARS)})`
        case 'result':
          return `[${actor}] ${item.content.tool} → ${truncate(String(item.content.output ?? ''), MAX_TOOL_CHARS)}`
      }
    })
    .join('\n')

const SYSTEM_PROMPT = `You are the memory consciousness of a multi-agent task system.
Your observations will be the ONLY historical context actors have about past work.

Extract high-fidelity observations from the task execution log below.
Do not chat. Do not explain. Output only structured XML.

Rules:
1) Prioritize user goals, completed deliverables, and key decisions.
2) Priority markers:
   - 🔴 high: user goals, completed artifacts, critical decisions, final outcomes.
   - 🟡 medium: active work, research findings, tool results, delegation patterns.
   - 🟢 low: tentative details, intermediate steps.
3) Preserve concrete details: artifact paths, task titles, actor names, specific findings.
4) Capture inter-task relationships: delegations, dependencies, artifact usage.
5) Keep observations concise but information-dense.
6) Do NOT repeat observations that already exist in previous observations.

Output format (strict):
<observations>
* 🔴 ...
* 🟡 ...
</observations>

<current-focus>
Primary: ...
</current-focus>`.trim()

const buildPrompt = (previousObservations: string, itemHistory: string): string =>
  [
    '## Previous Observations',
    '',
    previousObservations || '[none]',
    '',
    '---',
    '',
    'Do not repeat these existing observations. Only extract new ones.',
    '',
    '## New Task Execution Log',
    '',
    itemHistory || '[none]',
    '',
    '---',
    '',
    'Extract new observations. Return only XML with <observations> and <current-focus>.',
  ].join('\n')

const extractTag = (text: string, tag: string): string | undefined => {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.trim() || undefined
}

export const parseObserverOutput = (raw: string): Omit<ObserverResult, 'usage'> => ({
  observations: extractTag(raw, 'observations') ?? raw.trim(),
  raw,
})

export const runObserver = async (
  previousObservations: string,
  items: Item[],
  actorNames: Map<string, string>,
): Promise<ObserverResult> => {
  const history = serializeItems(items, actorNames)
  if (!history.trim()) {
    return { observations: '', raw: '', usage: emptyUsage() }
  }

  const result = await generateText({
    instructions: SYSTEM_PROMPT,
    input: buildPrompt(previousObservations, history),
  })

  const parsed = parseObserverOutput(result.text)

  return { ...parsed, usage: result.usage ?? emptyUsage() }
}

const CHARS_PER_TOKEN = 3.5
const SAFETY_MARGIN = 1.15

export const estimateTokens = (text: string): number =>
  Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_MARGIN)
