import { App as McpApp } from '@modelcontextprotocol/ext-apps'

type ListKind = 'todo' | 'shopping'

interface ListItem {
  id: string
  text: string
  done: boolean
}

interface MutableListsState {
  todo: ListItem[]
  shopping: ListItem[]
}

interface SavePayload {
  todo: Array<{ text: string; done: boolean }>
  shopping: Array<{ text: string; done: boolean }>
}

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing DOM element: ${id}`)
  }
  return element as T
}

const modePill = byId<HTMLSpanElement>('mode-pill')
const activePill = byId<HTMLSpanElement>('active-pill')
const statusLine = byId<HTMLDivElement>('status-line')
const meta = byId<HTMLDivElement>('meta')
const saveBtn = byId<HTMLButtonElement>('save-btn')
const reloadBtn = byId<HTMLButtonElement>('reload-btn')
const listRows = byId<HTMLDivElement>('list-rows')
const listTitle = byId<HTMLHeadingElement>('list-title')
const addItemBtn = byId<HTMLButtonElement>('add-item-btn')
const todoSwitchBtn = byId<HTMLButtonElement>('todo-switch-btn')
const shoppingSwitchBtn = byId<HTMLButtonElement>('shopping-switch-btn')

let app: McpApp | null = null
let mode: 'local' | 'mcp-host' = 'local'
let saving = false
let dirty = false
let activeKind: ListKind = 'todo'
let state: MutableListsState = {
  todo: [],
  shopping: [],
}
let updatedAt: string | null = null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const createItem = (value: unknown): ListItem | null => {
  if (!isRecord(value)) return null
  const text = normalizeText(value.text)
  if (text.length === 0) return null
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : crypto.randomUUID(),
    text,
    done: value.done === true,
  }
}

const normalizeList = (value: unknown): ListItem[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = createItem(item)
    return normalized ? [normalized] : []
  })
}

const setMode = (value: 'local' | 'mcp-host'): void => {
  mode = value
  modePill.textContent = `mode: ${value}`
}

const setStatus = (value: string): void => {
  statusLine.textContent = value
}

const setActiveKind = (value: ListKind): void => {
  activeKind = value
  renderAll()
}

const toLocalTime = (iso: string | null): string => {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString()
}

const applyIncomingState = (value: unknown): void => {
  if (!isRecord(value)) return

  state = {
    todo: normalizeList(value.todo),
    shopping: normalizeList(value.shopping),
  }

  if (typeof value.updatedAt === 'string') {
    updatedAt = value.updatedAt
  }

  if (value.focus === 'todo' || value.focus === 'shopping') {
    activeKind = value.focus
  }
}

const toSavePayload = (): SavePayload => ({
  todo: state.todo.map((item) => ({ text: item.text, done: item.done })),
  shopping: state.shopping.map((item) => ({ text: item.text, done: item.done })),
})

const ACTIVE_TAB = 'bg-accent text-white shadow-md shadow-accent/25'
const INACTIVE_TAB = 'text-text-secondary hover:text-white'

const renderSwitcher = (): void => {
  const isTodo = activeKind === 'todo'

  todoSwitchBtn.className = `tab-btn rounded-lg px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${isTodo ? ACTIVE_TAB : INACTIVE_TAB}`
  shoppingSwitchBtn.className = `tab-btn rounded-lg px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${isTodo ? INACTIVE_TAB : ACTIVE_TAB}`

  listTitle.textContent = isTodo ? 'Todo' : 'Shopping'
  activePill.textContent = `active: ${activeKind}`
}

const renderRows = (): void => {
  const kind = activeKind
  const items = state[kind]
  listRows.innerHTML = ''

  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'flex items-center justify-center rounded-xl border border-dashed border-border py-12 text-sm text-text-muted'
    empty.textContent = 'No items yet — click "+ Add item" to get started.'
    listRows.appendChild(empty)
    return
  }

  items.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'row-enter group flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3 transition hover:border-border-focus/30 hover:bg-card-hover/50'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = item.done
    checkbox.addEventListener('change', () => {
      state[kind][index] = { ...state[kind][index], done: checkbox.checked }
      dirty = true
      renderAll()
    })

    const input = document.createElement('input')
    input.type = 'text'
    input.value = item.text
    input.className = [
      'flex-1 bg-transparent border-none outline-none text-sm font-medium placeholder:text-text-muted',
      'focus:ring-0',
      item.done ? 'line-through text-text-muted' : 'text-text-primary',
    ].join(' ')
    input.addEventListener('input', () => {
      state[kind][index] = {
        ...state[kind][index],
        text: normalizeText(input.value),
      }
      dirty = true
    })
    input.addEventListener('blur', renderAll)

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'opacity-0 group-hover:opacity-100 rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger/10 cursor-pointer'
    removeBtn.textContent = 'Delete'
    removeBtn.addEventListener('click', () => {
      state[kind] = state[kind].filter((_, i) => i !== index)
      dirty = true
      renderAll()
    })

    row.append(checkbox, input, removeBtn)
    listRows.appendChild(row)
  })
}

const renderMeta = (): void => {
  const todoPending = state.todo.filter((item) => !item.done).length
  const shoppingPending = state.shopping.filter((item) => !item.done).length
  const dirtyMarker = dirty ? ' · unsaved changes' : ''
  meta.textContent =
    `todo: ${state.todo.length} (${todoPending} pending) · ` +
    `shopping: ${state.shopping.length} (${shoppingPending} pending) · ` +
    `updated: ${toLocalTime(updatedAt)}${dirtyMarker}`
}

const renderAll = (): void => {
  renderSwitcher()
  renderRows()
  renderMeta()
  saveBtn.disabled = saving
}

const applyFocusFromUrl = (): void => {
  const params = new URLSearchParams(window.location.search)
  const focus = params.get('focus')
  setActiveKind(focus === 'shopping' ? 'shopping' : 'todo')
}

const loadFromLocalApi = async (): Promise<void> => {
  const response = await fetch('/api/state')
  if (!response.ok) {
    throw new Error(`Failed to load local state: ${response.status}`)
  }
  applyIncomingState(await response.json())
}

const saveToLocalApi = async (): Promise<void> => {
  const response = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toSavePayload()),
  })

  if (!response.ok) {
    throw new Error(`Failed to save local state: ${response.status}`)
  }

  applyIncomingState(await response.json())
}

const loadFromHost = async (): Promise<void> => {
  if (!app) throw new Error('Host app is not connected.')
  const result = await app.callServerTool({
    name: 'get_lists_state',
    arguments: {},
  })
  if (result.isError) {
    throw new Error('Host tool get_lists_state returned an error')
  }
  applyIncomingState(result.structuredContent ?? {})
}

const saveToHost = async (): Promise<void> => {
  if (!app) throw new Error('Host app is not connected.')
  const result = await app.callServerTool({
    name: 'save_lists_state',
    arguments: toSavePayload(),
  })
  if (result.isError) {
    throw new Error('Host tool save_lists_state returned an error')
  }
  applyIncomingState(result.structuredContent ?? {})
}

const loadState = async (): Promise<void> => {
  if (mode === 'mcp-host') {
    await loadFromHost()
    return
  }
  await loadFromLocalApi()
}

const saveState = async (): Promise<void> => {
  if (saving) return
  saving = true
  setStatus('Saving...')
  renderAll()

  try {
    if (mode === 'mcp-host') {
      await saveToHost()
    } else {
      await saveToLocalApi()
    }
    dirty = false
    setStatus('Saved successfully.')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  } finally {
    saving = false
    renderAll()
  }
}

const connectHostMode = async (): Promise<boolean> => {
  if (window.parent === window) return false

  try {
    const hostApp = new McpApp({ name: 'List Manager', version: '1.0.0' })
    hostApp.ontoolresult = (result) => {
      if (!isRecord(result) || !('structuredContent' in result)) return
      applyIncomingState(result.structuredContent)
      dirty = false
      renderAll()
    }
    await hostApp.connect()
    app = hostApp
    setMode('mcp-host')
    return true
  } catch {
    return false
  }
}

addItemBtn.addEventListener('click', () => {
  const seedText = activeKind === 'todo' ? 'New todo item' : 'New shopping item'
  state[activeKind].push({
    id: crypto.randomUUID(),
    text: seedText,
    done: false,
  })
  dirty = true
  renderAll()
})

todoSwitchBtn.addEventListener('click', () => setActiveKind('todo'))
shoppingSwitchBtn.addEventListener('click', () => setActiveKind('shopping'))
saveBtn.addEventListener('click', () => void saveState())
reloadBtn.addEventListener('click', () => {
  void (async () => {
    setStatus('Reloading...')
    try {
      await loadState()
      dirty = false
      setStatus('Reloaded.')
      renderAll()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  })()
})

const boot = async (): Promise<void> => {
  applyFocusFromUrl()
  renderAll()

  const hostConnected = await connectHostMode()
  if (!hostConnected) {
    setMode('local')
  }

  try {
    await loadState()
    dirty = false
    setStatus('Ready.')
    renderAll()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

void boot()
