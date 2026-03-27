import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ListItem, ListsState } from '../types.js'

export interface ListsFilePaths {
  todoFilePath: string
  shoppingFilePath: string
}

const CHECKBOX_LINE_RE = /^-\s*\[([ xX])\]\s+(.*)$/
const BULLET_LINE_RE = /^-\s+(.*)$/

const nowIso = (): string => new Date().toISOString()

const createId = (): string => crypto.randomUUID()

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

const normalizeItem = (value: unknown): ListItem | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const text = normalizeText(record.text)
  if (text.length === 0) return null
  return {
    id: typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : createId(),
    text,
    done: record.done === true,
  }
}

const normalizeItems = (value: unknown): ListItem[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = normalizeItem(item)
    return normalized ? [normalized] : []
  })
}

const parseMarkdownList = (raw: string): ListItem[] =>
  raw
    .split(/\r?\n/)
    .flatMap((line) => {
      const checkboxMatch = line.match(CHECKBOX_LINE_RE)
      if (checkboxMatch) {
        const text = normalizeText(checkboxMatch[2])
        if (!text) return []
        return [{
          id: createId(),
          text,
          done: checkboxMatch[1].toLowerCase() === 'x',
        }]
      }

      const bulletMatch = line.match(BULLET_LINE_RE)
      if (bulletMatch) {
        const text = normalizeText(bulletMatch[1])
        if (!text) return []
        return [{
          id: createId(),
          text,
          done: false,
        }]
      }

      return []
    })

const toMarkdown = (title: string, items: ListItem[]): string => {
  const body = items
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
    .join('\n')
  return `# ${title}\n\n${body}\n`
}

const readListFromFile = async (path: string): Promise<ListItem[]> => {
  try {
    const raw = await readFile(path, 'utf-8')
    return parseMarkdownList(raw)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

const writeListToFile = async (path: string, title: string, items: ListItem[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, toMarkdown(title, items), 'utf-8')
}

export const ensureListFiles = async (paths: ListsFilePaths): Promise<void> => {
  const state = await readListsState(paths)
  await writeListsState(paths, state)
}

export const readListsState = async (paths: ListsFilePaths): Promise<ListsState> => {
  const [todo, shopping] = await Promise.all([
    readListFromFile(paths.todoFilePath),
    readListFromFile(paths.shoppingFilePath),
  ])
  return {
    todo,
    shopping,
    updatedAt: nowIso(),
  }
}

export const writeListsState = async (
  paths: ListsFilePaths,
  input: {
    todo: unknown
    shopping: unknown
  },
): Promise<ListsState> => {
  const todo = normalizeItems(input.todo)
  const shopping = normalizeItems(input.shopping)

  await Promise.all([
    writeListToFile(paths.todoFilePath, 'Todo', todo),
    writeListToFile(paths.shoppingFilePath, 'Shopping', shopping),
  ])

  return {
    todo,
    shopping,
    updatedAt: nowIso(),
  }
}

export const summarizeLists = (state: ListsState): string => {
  const todoPending = state.todo.filter((item) => !item.done).length
  const shoppingPending = state.shopping.filter((item) => !item.done).length

  return [
    `Todo items: ${state.todo.length} total (${todoPending} pending).`,
    `Shopping items: ${state.shopping.length} total (${shoppingPending} pending).`,
  ].join(' ')
}
