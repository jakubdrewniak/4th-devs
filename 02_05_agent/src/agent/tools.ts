import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, relative, dirname } from 'node:path'
import type { Tool, ResolvedTool } from '../types.js'
import { WORKSPACE } from '../config.js'
import { formatError } from '../helpers/utils.js'

const isPathSafe = (path: string): boolean => {
  const fullPath = resolve(join(WORKSPACE, path))
  const rel = relative(resolve(WORKSPACE), fullPath)
  return !rel.startsWith('..')
}

export const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'read_file',
      description: 'Read a file from the workspace directory. Path is relative to workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
        },
        required: ['path'],
      },
    },
    handler: async (args) => {
      const path = typeof args.path === 'string' ? args.path : ''
      if (!path || !isPathSafe(path)) return 'Error: invalid or unsafe path'
      try {
        return await readFile(join(WORKSPACE, path), 'utf-8')
      } catch (err) {
        return `Error: ${formatError(err)}`
      }
    },
  },
  {
    definition: {
      type: 'function',
      name: 'write_file',
      description: 'Write content to a file in the workspace directory. Creates directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
    handler: async (args) => {
      const path = typeof args.path === 'string' ? args.path : ''
      const content = typeof args.content === 'string' ? args.content : ''
      if (!path || !isPathSafe(path)) return 'Error: invalid or unsafe path'
      try {
        const fullPath = join(WORKSPACE, path)
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, content, 'utf-8')
        return `Wrote ${path}`
      } catch (err) {
        return `Error: ${formatError(err)}`
      }
    },
  },
]

const toolsByName = new Map(tools.map((tool) => [tool.definition.name, tool] as const))

const toResolvedTool = (tool: Tool): ResolvedTool => ({
  type: 'function',
  name: tool.definition.name,
  description: tool.definition.description,
  parameters: tool.definition.parameters,
  strict: false,
})

export const findTool = (name: string): Tool | undefined =>
  toolsByName.get(name)

export const resolveAgentTools = (toolNames: string[]): ResolvedTool[] => {
  const resolved: ResolvedTool[] = []

  for (const toolName of toolNames) {
    const tool = toolsByName.get(toolName)
    if (!tool) continue

    resolved.push(toResolvedTool(tool))
  }

  return resolved
}
