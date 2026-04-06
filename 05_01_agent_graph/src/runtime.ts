import { FileStore } from './store.js'
import type {
  Session, Actor, Task, Item, Artifact, Relation,
  ItemType, ArtifactKind, EntityKind, RelationType,
} from './domain.js'
import { uuid, now } from './domain.js'

// ── Runtime Context ─────────────────────────────────────────────────────────

export interface Runtime {
  readonly dataDir: string
  readonly sessions: FileStore<Session>
  readonly actors: FileStore<Actor>
  readonly tasks: FileStore<Task>
  readonly items: FileStore<Item>
  readonly artifacts: FileStore<Artifact>
  readonly relations: FileStore<Relation>
  nextSequence: () => Promise<number>
}

export async function createRuntime(dataDir = '.data'): Promise<Runtime> {
  const items = new FileStore<Item>('items', dataDir)

  const existing = await items.all()
  let seq = existing.reduce((max, i) => Math.max(max, i.sequence), 0)

  return {
    dataDir,
    sessions: new FileStore<Session>('sessions', dataDir),
    actors: new FileStore<Actor>('actors', dataDir),
    tasks: new FileStore<Task>('tasks', dataDir),
    items,
    artifacts: new FileStore<Artifact>('artifacts', dataDir),
    relations: new FileStore<Relation>('relations', dataDir),
    nextSequence: async () => ++seq,
  }
}

// ── Entity creation helpers ─────────────────────────────────────────────────

export const addItem = async (
  rt: Runtime,
  sessionId: string,
  type: ItemType,
  content: Record<string, unknown>,
  opts?: { taskId?: string; actorId?: string },
): Promise<Item> =>
  rt.items.add({
    id: uuid(),
    session_id: sessionId,
    task_id: opts?.taskId,
    actor_id: opts?.actorId,
    type,
    content,
    sequence: await rt.nextSequence(),
    created_at: now(),
  })

export const addRelation = (
  rt: Runtime,
  sessionId: string,
  fromKind: EntityKind,
  fromId: string,
  relationType: RelationType,
  toKind: EntityKind,
  toId: string,
) =>
  rt.relations.add({
    id: uuid(),
    session_id: sessionId,
    from_kind: fromKind,
    from_id: fromId,
    relation_type: relationType,
    to_kind: toKind,
    to_id: toId,
    created_at: now(),
  })

export const addArtifact = (
  rt: Runtime,
  sessionId: string,
  kind: ArtifactKind,
  artifactPath: string,
  opts?: { metadata?: Record<string, unknown>; taskId?: string },
) =>
  rt.artifacts.add({
    id: uuid(),
    session_id: sessionId,
    task_id: opts?.taskId,
    kind,
    path: artifactPath,
    version: 1,
    metadata: opts?.metadata,
    created_at: now(),
  })

export const ensureRelation = async (
  rt: Runtime,
  sessionId: string,
  fromKind: EntityKind,
  fromId: string,
  relationType: RelationType,
  toKind: EntityKind,
  toId: string,
): Promise<Relation> => {
  const existing = await rt.relations.find(
    r =>
      r.session_id === sessionId
      && r.from_kind === fromKind
      && r.from_id === fromId
      && r.relation_type === relationType
      && r.to_kind === toKind
      && r.to_id === toId,
  )

  return existing[0] ?? addRelation(rt, sessionId, fromKind, fromId, relationType, toKind, toId)
}
