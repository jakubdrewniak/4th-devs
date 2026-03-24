import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import matter from 'gray-matter'
import { PATHS } from './config/index.js'
import { createTask } from './features/tasks/index.js'
import { exists } from './helpers/fs.js'
import { resolveWorkflow } from './workflows/registry.js'
import type { WorkflowDefinition } from './workflows/types.js'

const ensureFile = async (path: string, content: string): Promise<void> => {
  if (await exists(path)) return
  await writeFile(path, content, 'utf-8')
}

const assertAgentTemplatesExist = async (workflow: WorkflowDefinition): Promise<void> => {
  const requiredAgents = [...new Set(workflow.agentOrder)]
  for (const agent of requiredAgents) {
    const filename = `${agent}.agent.md`
    const path = join(PATHS.AGENTS_DIR, filename)
    if (!(await exists(path))) {
      throw new Error(
        `Missing required template ${filename} for ${agent} in workspace/agents. Restore this file before running.`,
      )
    }
  }
}

const ensureProjectFile = async (workflow: WorkflowDefinition): Promise<void> => {
  await ensureFile(
    PATHS.PROJECT_PATH,
    matter.stringify(
      [workflow.project.title, '', workflow.project.description].join('\n'),
      {
        id: workflow.project.id,
        workflow_id: workflow.id,
        status: 'active',
        deliverable_path: workflow.project.deliverablePath,
        ...(workflow.project.goalId ? { goal_id: workflow.project.goalId } : {}),
        ...(workflow.project.planVersion != null ? { plan_version: workflow.project.planVersion } : {}),
        created_at: new Date().toISOString(),
      },
    ),
  )
}

const PROJECT_README_PATH = join(PATHS.WORKSPACE_DIR, 'README.md')

const ensureProjectReadme = async (): Promise<void> => {
  await ensureFile(
    PROJECT_README_PATH,
    [
      '# Project Workspace',
      '',
      'This folder contains one project run context.',
      '',
      '- `goal.md` (linked alias of `../goal.md`; canonical goal is at workspace root)',
      '- `project.md` project metadata and status',
      '- `tasks/` executable task files',
      '- `work/` intermediate outputs',
      '- `deliverables/` final artifacts',
      '- `notes/` research notes and evidence',
      '- `assets/` generated images and media',
      '- `report/` report-style outputs',
      '- `system/` runtime internals (`events`, `waits`, `memory`, `plan`)',
      '',
    ].join('\n'),
  )
}

const syncGoalAliasToProjectWorkspace = async (): Promise<void> => {
  if (!(await exists(PATHS.GOAL_PATH))) return
  try {
    await rm(PATHS.PROJECT_GOAL_PATH, { force: true })
  } catch {
    // Best effort.
  }

  try {
    await link(PATHS.GOAL_PATH, PATHS.PROJECT_GOAL_PATH)
  } catch {
    // Fallback for filesystems that disallow hard links.
    const rawGoal = await readFile(PATHS.GOAL_PATH, 'utf-8')
    await writeFile(PATHS.PROJECT_GOAL_PATH, rawGoal, 'utf-8')
  }
}

const seedTasksIfNeeded = async (workflow: WorkflowDefinition): Promise<void> => {
  const taskFiles = (await readdir(PATHS.TASKS_DIR)).filter((file) => file.endsWith('.md'))
  if (taskFiles.length > 0) return

  for (const seed of workflow.tasks) {
    await createTask({
      filename: seed.filename,
      id: seed.id,
      title: seed.title,
      project: workflow.project.id,
      owner: seed.owner,
      requiredCapabilities: seed.requiredCapabilities,
      priority: seed.priority,
      dependsOn: seed.dependsOn,
      outputPath: seed.outputPath,
      body: seed.body,
      createdBy: 'system',
      goalId: seed.goalId,
      planVersion: seed.planVersion,
    })
  }
}

export const ensureWorkspaceInitialized = async (
  workflow: WorkflowDefinition = resolveWorkflow(),
): Promise<void> => {
  const coreDirectories = [
    PATHS.WORKSPACE_ROOT_DIR,
    PATHS.WORKSPACE_DIR,
    PATHS.AGENTS_DIR,
    PATHS.TASKS_DIR,
    PATHS.EVENTS_DIR,
    PATHS.WAITS_DIR,
    PATHS.MEMORY_DIR,
    PATHS.PLAN_DIR,
  ]

  const workflowDirectories = [
    dirname(workflow.project.deliverablePath),
    ...workflow.tasks.map((task) => dirname(task.outputPath)),
  ]
    .filter((dir) => dir !== '.')
    .map((dir) => join(PATHS.WORKSPACE_DIR, dir))

  const directories = [...new Set([...coreDirectories, ...workflowDirectories])]

  await Promise.all(directories.map((dir) => mkdir(dir, { recursive: true })))
  await syncGoalAliasToProjectWorkspace()
  await assertAgentTemplatesExist(workflow)
  await ensureProjectReadme()
  await ensureProjectFile(workflow)
  await seedTasksIfNeeded(workflow)
}
