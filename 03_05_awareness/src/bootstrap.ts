import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import matter from 'gray-matter'
import { PATHS } from './config.js'

const exists = async (path: string): Promise<boolean> => {
  try {
    await Bun.file(path).exists()
    return true
  } catch {
    return false
  }
}

const ensureFile = async (path: string, content: string): Promise<void> => {
  if (await exists(path)) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

const validateTemplateFrontmatter = (path: string, raw: string): void => {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  if (typeof data.name !== 'string' || data.name.trim().length === 0) {
    throw new Error(`Template ${path} is missing required frontmatter field: name`)
  }

  if (data.model != null && typeof data.model !== 'string') {
    throw new Error(`Template ${path} has invalid frontmatter field: model must be a string`)
  }

  if (data.tools != null && !Array.isArray(data.tools)) {
    throw new Error(`Template ${path} has invalid frontmatter field: tools must be a string array`)
  }

  if (parsed.content.trim().length === 0) {
    throw new Error(`Template ${path} has empty prompt body`)
  }
}

const loadTemplate = async (path: string): Promise<string> => {
  const raw = await readFile(path, 'utf-8')
  validateTemplateFrontmatter(path, raw)
  return raw
}

const REQUIRED_WORKSPACE_KNOWLEDGE_PATHS = [
  PATHS.identityPath,
  PATHS.preferencesPath,
  PATHS.importantDatesPath,
  PATHS.workspaceIndexPath,
  join(PATHS.profileAgentDir, 'persona.md'),
  join(PATHS.environmentDir, 'context.md'),
  join(PATHS.memoryEpisodicDir, 'E001-example.md'),
  join(PATHS.memoryFactualDir, 'F001-example.md'),
  join(PATHS.memoryProceduralDir, 'P001-example.md'),
] as const

const toProjectRelativePath = (path: string): string => {
  const rel = relative(PATHS.projectRoot, path)
  return rel || path
}

const assertWorkspaceKnowledgeExists = async (): Promise<void> => {
  const checks = await Promise.all(
    REQUIRED_WORKSPACE_KNOWLEDGE_PATHS.map(async (path) => ({
      path,
      ok: await exists(path),
    })),
  )
  const missing = checks.filter((check) => !check.ok).map((check) => toProjectRelativePath(check.path))
  if (missing.length === 0) return

  throw new Error(
    [
      'Missing required workspace knowledge files.',
      'Knowledge must be authored in workspace files (not hardcoded in runtime code).',
      '',
      ...missing.map((path) => `- ${path}`),
    ].join('\n'),
  )
}

const defaultState = JSON.stringify(
  {
    turnsSinceScout: 0,
  },
  null,
  2,
)

export const ensureWorkspaceInitialized = async (): Promise<void> => {
  const dirs = [
    PATHS.workspaceRoot,
    PATHS.profileUserDir,
    PATHS.profileAgentDir,
    PATHS.environmentDir,
    PATHS.memoryEpisodicDir,
    PATHS.memoryFactualDir,
    PATHS.memoryProceduralDir,
    PATHS.notesScoutDir,
    dirname(PATHS.chatHistoryPath),
    dirname(PATHS.awarenessStatePath),
  ]

  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })))

  await Promise.all([
    loadTemplate(PATHS.awarenessTemplatePath),
    loadTemplate(PATHS.scoutTemplatePath),
  ])

  await assertWorkspaceKnowledgeExists()
  await ensureFile(PATHS.chatHistoryPath, '')
  await ensureFile(PATHS.awarenessStatePath, defaultState)
}
