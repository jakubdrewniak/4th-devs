import { ENV } from '../config/index.js'
import { logger } from '../core/logger.js'
import { getOpenAI } from '../core/openai.js'
import { loadAgentTemplate } from '../helpers/agent-template.js'
import type { AgentName, TaskPriority } from '../types.js'
import type {
  CapabilityMap,
  GoalContract,
  PlanDecision,
  PlanSpec,
  PlanTaskSpec,
  ReplanDecision,
  ReplanPatch,
} from './types.js'

const parseJsonFromModelOutput = (raw: string): Record<string, unknown> => {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // Try to extract the largest JSON object.
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first >= 0 && last > first) {
      const maybeJson = trimmed.slice(first, last + 1)
      return JSON.parse(maybeJson) as Record<string, unknown>
    }
    throw new Error('Planner output is not valid JSON.')
  }
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

const asTaskPriority = (value: unknown): TaskPriority =>
  value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium'

const parsePlanTask = (value: unknown): PlanTaskSpec | null => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>

  const filename = typeof data.filename === 'string' ? data.filename.trim() : ''
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  const owner = typeof data.owner === 'string' ? data.owner.trim() : ''
  const outputPath = typeof data.outputPath === 'string' ? data.outputPath.trim() : ''
  const body = typeof data.body === 'string' ? data.body.trim() : ''
  const successCriteria = asStringArray(data.successCriteria)
  if (!filename || !id || !title || !owner || !outputPath || !body || successCriteria.length === 0) return null

  return {
    filename,
    id,
    title,
    owner: owner as AgentName,
    requiredCapabilities: asStringArray(data.requiredCapabilities),
    priority: asTaskPriority(data.priority),
    dependsOn: asStringArray(data.dependsOn),
    outputPath,
    body,
    successCriteria,
  }
}

const parsePlanSpec = (value: unknown): PlanSpec | null => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const project = data.project as Record<string, unknown> | undefined
  if (!project) return null

  const projectId = typeof project.id === 'string' ? project.id.trim() : ''
  const projectTitle = typeof project.title === 'string' ? project.title.trim() : ''
  const projectDescription =
    typeof project.description === 'string' ? project.description.trim() : ''
  const deliverablePath =
    typeof project.deliverablePath === 'string' ? project.deliverablePath.trim() : ''
  if (!projectId || !projectTitle || !projectDescription || !deliverablePath) return null

  const tasksRaw = Array.isArray(data.tasks) ? data.tasks : []
  const parsedTasks: Array<{ index: number; task: PlanTaskSpec | null }> = tasksRaw.map(
    (raw, index) => ({ index, task: parsePlanTask(raw) }),
  )

  const droppedIndices = parsedTasks
    .filter((entry) => entry.task === null)
    .map((entry) => entry.index)
  if (droppedIndices.length > 0) {
    logger.warn('plan.parse.tasks-dropped', {
      dropped_count: droppedIndices.length,
      total_raw: tasksRaw.length,
      dropped_indices: droppedIndices,
    })
  }

  const tasks = parsedTasks
    .map((entry) => entry.task)
    .filter((task): task is PlanTaskSpec => task != null)
  if (tasks.length === 0) return null

  const ids = tasks.map((task) => task.id)
  const filenames = tasks.map((task) => task.filename)
  if (new Set(ids).size !== ids.length) {
    logger.warn('plan.parse.duplicate-ids', { ids })
  }
  if (new Set(filenames).size !== filenames.length) {
    logger.warn('plan.parse.duplicate-filenames', { filenames })
  }

  return {
    project: {
      id: projectId,
      title: projectTitle,
      description: projectDescription,
      deliverablePath,
    },
    agentOrder: asStringArray(data.agentOrder) as AgentName[],
    tasks,
    assumptions: asStringArray(data.assumptions),
    risks: asStringArray(data.risks),
    mustHaveCoverage:
      data.mustHaveCoverage && typeof data.mustHaveCoverage === 'object'
        ? Object.fromEntries(
            Object.entries(data.mustHaveCoverage as Record<string, unknown>).map(([key, val]) => [
              key,
              asStringArray(val),
            ]),
          )
        : {},
  }
}

const VALID_PLAN_STATUSES = new Set(['viable', 'no-go'])

const parsePlanDecision = (data: Record<string, unknown>): PlanDecision => {
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : ''

  if (!VALID_PLAN_STATUSES.has(status)) {
    throw new Error(
      `Planner returned invalid status "${status || '(empty)'}". Must be "viable" or "no-go".`,
    )
  }

  if (status === 'no-go') {
    const reasons = asStringArray(data.reasons)
    if (reasons.length === 0) {
      throw new Error('Planner returned no-go without any reasons.')
    }
    return {
      status: 'no-go',
      reasons,
      missingCapabilities: asStringArray(data.missingCapabilities),
      suggestedActions: asStringArray(data.suggestedActions),
    }
  }

  const plan = parsePlanSpec(data.plan)
  if (!plan) {
    throw new Error('Planner returned status "viable" but plan payload is missing or invalid.')
  }

  return {
    status: 'viable',
    plan,
  }
}

const formatCapabilityMap = (capabilityMap: CapabilityMap): string =>
  JSON.stringify(
    [...capabilityMap.entries()].map(([agent, snapshot]) => ({
      agent,
      capabilities: snapshot.capabilities,
      tools: snapshot.tools,
    })),
    null,
    2,
  )

const buildGoalPayload = (goal: GoalContract): Record<string, unknown> => {
  const { context, ...structured } = goal
  return structured
}

const ANALYTICAL_GOAL_KEYWORDS = [
  'report',
  'note',
  'analysis',
  'compare',
  'comparison',
  'benchmark',
  'developer',
  'trade-off',
]

const isAnalyticalGoal = (goal: GoalContract): boolean => {
  const corpus = [goal.objective, goal.context, ...goal.must_have, ...goal.forbidden]
    .join('\n')
    .toLowerCase()

  return ANALYTICAL_GOAL_KEYWORDS.some((keyword) => corpus.includes(keyword))
}

const buildQualityConstraints = (goal: GoalContract): string => {
  const baseRules = [
    '- Every task must include concrete, testable successCriteria (no vague wording).',
    '- Plan tasks as a dependency graph where downstream tasks consume specific upstream artifacts.',
    '- Task body instructions must name the exact artifact to produce and how it will be used by the next task.',
  ]

  if (!isAnalyticalGoal(goal)) return baseRules.join('\n')

  const analyticalRules = [
    '- For analytical/report goals, include distinct phases: evidence collection -> synthesis/draft -> editorial quality gate -> final assembly.',
    '- Include at least one task that produces structured evidence with source traceability.',
    '- Include at least one downstream writing/synthesis task that depends on evidence outputs.',
    '- Include at least one editorial quality-gate task that depends on the draft and verifies citation integrity and caveats for non-comparable metrics.',
    '- If the goal is comparative, include an explicit comparison artifact (matrix/table or equivalent normalized section) and mark source-specific claims clearly.',
  ]

  return [...baseRules, ...analyticalRules].join('\n')
}

const OUTPUT_CONTRACT_SCHEMA = JSON.stringify(
  {
    status: 'viable | no-go',
    plan: {
      project: {
        id: 'string (derived from goal id)',
        title: 'string',
        description: 'string',
        deliverablePath: 'path/to/final-deliverable.md',
      },
      agentOrder: ['<agent_name_from_capability_map>', '...'],
      tasks: [
        {
          filename: 'NN-slug.md',
          id: 'unique-task-id',
          title: 'Task title',
          owner: '<agent_name_from_capability_map>',
          requiredCapabilities: ['<capability>'],
          priority: 'high | medium | low | critical',
          dependsOn: [],
          outputPath: '<workspace-relative path>',
          body: 'markdown task body with instructions',
          successCriteria: ['criterion 1'],
        },
      ],
      assumptions: ['...'],
      risks: ['...'],
      mustHaveCoverage: {
        '<exact must_have text>': ['task-id-1'],
      },
    },
    reasons: ['if no-go only'],
    missingCapabilities: ['if no-go only'],
    suggestedActions: ['if no-go only'],
  },
  null,
  2,
)

const buildPlanPrompt = (goal: GoalContract, capabilityMap: CapabilityMap): string => {
  const contextBlock = goal.context
    ? `\nGoal context (additional background, source material, or instructions):\n${goal.context}\n`
    : ''
  const qualityConstraints = buildQualityConstraints(goal)

  return `You are an autonomous planning compiler.
Return ONLY JSON (status must be exactly "viable" or "no-go"). No markdown. No explanations.

Goal contract (structured fields):
${JSON.stringify(buildGoalPayload(goal), null, 2)}
${contextBlock}
Current team capability map JSON:
${formatCapabilityMap(capabilityMap)}

Output contract (JSON object):
${OUTPUT_CONTRACT_SCHEMA}

Hard constraints:
- status MUST be exactly "viable" or "no-go". No other values.
- If the team cannot satisfy the goal with constraints, return status="no-go".
- Respect max_total_tasks and step_budget_rounds.
- Include all must_have items in mustHaveCoverage (for viable).
- Never include forbidden constraints in plan content.
- Choose agent names and capabilities only from the provided capability map.
- deliverablePath and outputPath are workspace-relative (no leading slash).
${qualityConstraints}`
}

const buildRepairPrompt = (
  goal: GoalContract,
  capabilityMap: CapabilityMap,
  previousRaw: string,
  validationErrors: string[],
): string => {
  const contextBlock = goal.context
    ? `\nGoal context (additional background):\n${goal.context}\n`
    : ''
  const qualityConstraints = buildQualityConstraints(goal)

  const errorsList = validationErrors.map((error) => `- ${error}`).join('\n')

  return `Repair the previous plan output.
Return ONLY valid JSON object with the exact same output contract.
status MUST be exactly "viable" or "no-go".

Goal contract (structured fields):
${JSON.stringify(buildGoalPayload(goal), null, 2)}
${contextBlock}
Current team capability map JSON:
${formatCapabilityMap(capabilityMap)}

Output contract (JSON object):
${OUTPUT_CONTRACT_SCHEMA}

Hard constraints:
- status MUST be exactly "viable" or "no-go". No other values.
- If the team cannot satisfy the goal with constraints, return status="no-go".
- Respect max_total_tasks and step_budget_rounds.
- Include all must_have items in mustHaveCoverage (for viable).
- Never include forbidden constraints in plan content.
- Choose agent names and capabilities only from the provided capability map.
- deliverablePath and outputPath are workspace-relative (no leading slash).
${qualityConstraints}

Previous planner output:
${previousRaw}

Validation errors to fix:
${errorsList}`
}

const getPlannerModel = async (): Promise<string> => {
  try {
    const plannerTemplate = await loadAgentTemplate('planner')
    return plannerTemplate.model
  } catch {
    return ENV.openaiModel
  }
}

const callPlanner = async (prompt: string): Promise<string> => {
  const openai = getOpenAI()
  const model = await getPlannerModel()

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_completion_tokens: 6_000,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict JSON planning compiler. Output exactly one JSON object and nothing else.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const content = response.choices[0]?.message?.content as unknown
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk: unknown) => {
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          const text = (chunk as { text?: unknown }).text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .join('\n')
  }
  return ''
}

export const generatePlanDecision = async (
  goal: GoalContract,
  capabilityMap: CapabilityMap,
): Promise<{ decision: PlanDecision; raw: string }> => {
  const prompt = buildPlanPrompt(goal, capabilityMap)
  const raw = await callPlanner(prompt)
  const parsed = parseJsonFromModelOutput(raw)
  const decision = parsePlanDecision(parsed)
  logger.info('plan.generated', { status: decision.status, task_count: decision.status === 'viable' ? decision.plan.tasks.length : 0 })
  return { decision, raw }
}

export const repairPlanDecision = async (
  goal: GoalContract,
  capabilityMap: CapabilityMap,
  previousRaw: string,
  validationErrors: string[],
): Promise<{ decision: PlanDecision; raw: string }> => {
  const prompt = buildRepairPrompt(goal, capabilityMap, previousRaw, validationErrors)
  const raw = await callPlanner(prompt)
  const parsed = parseJsonFromModelOutput(raw)
  const decision = parsePlanDecision(parsed)
  return { decision, raw }
}

const parseReplanPatch = (value: unknown): ReplanPatch | null => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const op = typeof data.op === 'string' ? data.op : ''
  const reason = typeof data.reason === 'string' ? data.reason.trim() : 'No reason provided.'

  if (op === 'add_task') {
    const task = parsePlanTask(data.task)
    if (!task) return null
    return { op, task, reason }
  }
  if (op === 'split_task') {
    const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
    const replacement = Array.isArray(data.replacement)
      ? data.replacement.map(parsePlanTask).filter((task): task is PlanTaskSpec => task != null)
      : []
    if (!taskId || replacement.length === 0) return null
    return { op, task_id: taskId, replacement, reason }
  }
  if (op === 'reassign_owner') {
    const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
    const owner = typeof data.owner === 'string' ? data.owner.trim() : ''
    if (!taskId || !owner) return null
    return { op, task_id: taskId, owner: owner as AgentName, reason }
  }
  if (op === 'change_dependencies') {
    const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
    if (!taskId) return null
    return { op, task_id: taskId, dependsOn: asStringArray(data.dependsOn), reason }
  }
  if (op === 'de_scope_task') {
    const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
    const note = typeof data.note === 'string' ? data.note.trim() : ''
    if (!taskId || !note) return null
    return { op, task_id: taskId, note, reason }
  }
  if (op === 'cancel_open_task') {
    const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
    if (!taskId) return null
    return { op, task_id: taskId, reason }
  }

  return null
}

const parseReplanDecision = (data: Record<string, unknown>): ReplanDecision => {
  const rationale = typeof data.rationale === 'string' ? data.rationale.trim() : 'No rationale.'
  const patches = Array.isArray(data.patches)
    ? data.patches.map(parseReplanPatch).filter((patch): patch is ReplanPatch => patch != null)
    : []
  return { rationale, patches }
}

export const generateReplanDecision = async ({
  goal,
  capabilityMap,
  tasksSnapshot,
  triggerReason,
  maxNewTasksPerReplan,
}: {
  goal: GoalContract
  capabilityMap: CapabilityMap
  tasksSnapshot: Array<{
    id: string
    title: string
    owner: string
    status: string
    attempt: number
    depends_on: string[]
  }>
  triggerReason: string
  maxNewTasksPerReplan: number
}): Promise<ReplanDecision> => {
  const patchSchema = JSON.stringify(
    {
      rationale: 'string',
      patches: [
        {
          op: 'add_task | split_task | reassign_owner | change_dependencies | de_scope_task | cancel_open_task',
          reason: 'string',
        },
      ],
    },
    null,
    2,
  )

  const prompt = `Propose a bounded replan patch set.
Return ONLY JSON object: { "rationale": string, "patches": ReplanPatch[] }

Goal contract:
${JSON.stringify(goal, null, 2)}

Capability map:
${formatCapabilityMap(capabilityMap)}

Trigger reason: ${triggerReason}
Hard limit: at most ${maxNewTasksPerReplan} add_task operations.

Current task snapshot:
${JSON.stringify(tasksSnapshot, null, 2)}

Patch schema:
${patchSchema}

Rules:
- Do not patch completed tasks.
- Prefer minimal patch set.
- If no changes are needed, return patches as [].`

  const raw = await callPlanner(prompt)
  const parsed = parseJsonFromModelOutput(raw)
  return parseReplanDecision(parsed)
}
