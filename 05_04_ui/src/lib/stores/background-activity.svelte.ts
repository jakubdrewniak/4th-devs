import type { ThreadActivityState } from '../../../shared/chat'
import { getThreadsActivity } from '../services/api'

export interface ActivityThread {
  id: string
  title: string
  state: ThreadActivityState
  label: string
}

const POLL_INTERVAL_MS = 8_000
const DISMISSED_STORAGE_KEY = 'bg-activity-dismissed'

const loadDismissed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

const saveDismissed = (ids: Set<string>) => {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch { /* ignore */ }
}

const clearDismissed = () => {
  try {
    localStorage.removeItem(DISMISSED_STORAGE_KEY)
  } catch { /* ignore */ }
}

export const createBackgroundActivityStore = (deps: {
  currentThreadId: () => string | null
  sessionId: () => string | null
}) => {
  let threads = $state<ActivityThread[]>([])
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let boundSessionId: string | null = null

  const dismissedThreadIds = loadDismissed()

  const poll = async () => {
    if (disposed) return

    const session = deps.sessionId()
    if (!session) {
      threads = []
      return
    }

    if (session !== boundSessionId) {
      threads = []
      dismissedThreadIds.clear()
      boundSessionId = session
    }

    try {
      const result = await getThreadsActivity()

      // Guard: session might have changed while awaiting
      if (disposed || deps.sessionId() !== session) return

      const currentId = deps.currentThreadId()

      // The thread the user is looking at right now is "seen"
      if (currentId) {
        dismissedThreadIds.add(currentId)
        saveDismissed(dismissedThreadIds)
      }

      threads = result
        .filter((t) => t.id !== currentId)
        .filter((t) => !(t.activity.state === 'completed' && dismissedThreadIds.has(t.id)))
        .map((t) => ({
          id: t.id,
          title: t.title?.trim() || 'Untitled',
          state: t.activity.state as ThreadActivityState,
          label: t.activity.label,
        }))
    } catch {
      // Swallow — don't disrupt the UI on transient failures
    }
  }

  const schedulePoll = () => {
    if (disposed) return
    pollTimer = setTimeout(async () => {
      await poll()
      schedulePoll()
    }, POLL_INTERVAL_MS)
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    } else {
      void poll()
      schedulePoll()
    }
  }

  const start = () => {
    disposed = false
    boundSessionId = deps.sessionId()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void poll()
    schedulePoll()
  }

  const stop = () => {
    disposed = true
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    threads = []
    dismissedThreadIds.clear()
    clearDismissed()
    boundSessionId = null
  }

  const reset = () => {
    threads = []
    dismissedThreadIds.clear()
    clearDismissed()
    boundSessionId = null
    if (!disposed) {
      void poll()
    }
  }

  const markSeen = (threadId: string) => {
    dismissedThreadIds.add(threadId)
    saveDismissed(dismissedThreadIds)
    threads = threads.filter((t) => t.id !== threadId)
  }

  return {
    get threads() {
      return threads
    },
    start,
    stop,
    reset,
    markSeen,
  }
}
