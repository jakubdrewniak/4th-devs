import type { Actor, Task, Item, Artifact } from '../domain.js'
import type { Runtime } from '../runtime.js'
import { shouldAutoRetryTask } from './recovery.js'

// ── Sorting / dedup ─────────────────────────────────────────────────────────

const byNewestArtifact = (a: Artifact, b: Artifact) =>
  b.version - a.version || b.created_at.localeCompare(a.created_at)

const latestArtifacts = (artifacts: Artifact[]): Artifact[] => {
  const byPath = new Map<string, Artifact>()
  for (const a of artifacts.sort(byNewestArtifact)) {
    if (!byPath.has(a.path)) byPath.set(a.path, a)
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
}

// ── Query API ───────────────────────────────────────────────────────────────

export interface GraphQueries {
  areDependenciesMet: (task: Task) => Promise<boolean>
  hasUnfinishedChildren: (task: Task) => Promise<boolean>
  findReadyTasks: (sessionId: string) => Promise<Task[]>
  unblockParents: (completedTask: Task) => Promise<void>
  findAssignedActor: (task: Task) => Promise<Actor | undefined>
  getDependencyTasks: (task: Task) => Promise<Task[]>
  getDependencyArtifacts: (task: Task) => Promise<Artifact[]>
  getArtifactsProducedByTask: (taskId: string) => Promise<Artifact[]>
  getTaskItems: (taskId: string) => Promise<Item[]>
  getSessionActors: (sessionId: string) => Promise<Actor[]>
  getSessionTasks: (sessionId: string) => Promise<Task[]>
}

export function createGraphQueries(rt: Runtime): GraphQueries {
  const areDependenciesMet = async (task: Task): Promise<boolean> => {
    const deps = await rt.relations.find(
      r => r.from_kind === 'task' && r.from_id === task.id && r.relation_type === 'depends_on',
    )
    for (const dep of deps) {
      const depTask = await rt.tasks.getById(dep.to_id)
      if (!depTask || depTask.status !== 'done') return false
    }
    return true
  }

  const hasUnfinishedChildren = async (task: Task): Promise<boolean> => {
    const children = await rt.tasks.find(t => t.parent_task_id === task.id)
    return children.some(t => t.status !== 'done' && t.status !== 'blocked')
  }

  const findReadyTasks = async (sessionId: string): Promise<Task[]> => {
    const candidates = await rt.tasks.find(
      t => t.session_id === sessionId && (
        t.status === 'todo'
        || t.status === 'waiting'
        || t.status === 'blocked'
      ),
    )

    const ready: Task[] = []
    for (const task of candidates) {
      if (task.status === 'todo') {
        if (!await areDependenciesMet(task)) continue
        ready.push(task)
        continue
      }

      if (task.status === 'waiting') {
        if (await areDependenciesMet(task) && !await hasUnfinishedChildren(task)) {
          await rt.tasks.update(task.id, { status: 'todo' })
          ready.push({ ...task, status: 'todo' })
        }
        continue
      }

      if (task.status === 'blocked' && shouldAutoRetryTask(task)) {
        await rt.tasks.update(task.id, { status: 'todo' })
        ready.push({ ...task, status: 'todo' })
      }
    }

    return ready.sort((a, b) => a.priority - b.priority)
  }

  const unblockParents = async (completedTask: Task): Promise<void> => {
    if (!completedTask.parent_task_id) return
    const parent = await rt.tasks.getById(completedTask.parent_task_id)
    if (!parent || parent.status !== 'waiting') return
    if (await hasUnfinishedChildren(parent)) return
    if (!await areDependenciesMet(parent)) return
    await rt.tasks.update(parent.id, { status: 'todo' })
  }

  const findAssignedActor = async (task: Task): Promise<Actor | undefined> => {
    const rels = await rt.relations.find(
      r => r.from_kind === 'task' && r.from_id === task.id && r.relation_type === 'assigned_to',
    )
    if (rels.length === 0) return undefined
    return rt.actors.getById(rels[0].to_id)
  }

  const getDependencyTasks = async (task: Task): Promise<Task[]> => {
    const rels = await rt.relations.find(
      r => r.from_kind === 'task' && r.from_id === task.id && r.relation_type === 'depends_on',
    )
    const tasks = await Promise.all(rels.map(r => rt.tasks.getById(r.to_id)))
    return tasks.filter(Boolean) as Task[]
  }

  const getArtifactsProducedByTask = async (taskId: string): Promise<Artifact[]> => {
    const rels = await rt.relations.find(
      r => r.from_kind === 'task' && r.from_id === taskId
        && r.relation_type === 'produces' && r.to_kind === 'artifact',
    )
    const artifacts = await Promise.all(rels.map(r => rt.artifacts.getById(r.to_id)))
    return latestArtifacts(artifacts.filter(Boolean) as Artifact[])
  }

  const getDependencyArtifacts = async (task: Task): Promise<Artifact[]> => {
    const depTasks = await getDependencyTasks(task)
    const all = (await Promise.all(depTasks.map(t => getArtifactsProducedByTask(t.id)))).flat()
    return latestArtifacts(all)
  }

  const getTaskItems = (taskId: string): Promise<Item[]> =>
    rt.items.find(i => i.task_id === taskId)

  const getSessionActors = (sessionId: string): Promise<Actor[]> =>
    rt.actors.find(a => a.session_id === sessionId)

  const getSessionTasks = (sessionId: string): Promise<Task[]> =>
    rt.tasks.find(t => t.session_id === sessionId)

  return {
    areDependenciesMet,
    hasUnfinishedChildren,
    findReadyTasks,
    unblockParents,
    findAssignedActor,
    getDependencyTasks,
    getDependencyArtifacts,
    getArtifactsProducedByTask,
    getTaskItems,
    getSessionActors,
    getSessionTasks,
  }
}
