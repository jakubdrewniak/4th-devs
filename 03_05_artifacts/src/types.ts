export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PreviewPhase =
  | 'idle'
  | 'interpreting_request'
  | 'calling_model'
  | 'assembling_document'
  | 'completed'
  | 'failed'

export interface ArtifactDocument {
  id: string
  title: string
  prompt: string
  html: string
  model: string
  packs: string[]
  createdAt: string
}

export interface PreviewState {
  status: PreviewStatus
  phase: PreviewPhase
  message: string
  lastPrompt: string | null
  lastAssistantMessage: string | null
  artifact: ArtifactDocument | null
  error: string | null
  updatedAt: string
}

export interface GenerateArtifactProgress {
  phase: PreviewPhase
  message: string
}

export interface GenerateArtifactInput {
  prompt: string
  packs?: string[]
  serverBaseUrl?: string
}

export interface GenerateArtifactOptions {
  onProgress?: (progress: GenerateArtifactProgress) => void
}

export interface SearchReplaceOperation {
  search: string
  replace: string
  replaceAll?: boolean
  useRegex?: boolean
  caseSensitive?: boolean
  regexFlags?: string
}

export type ArtifactPackId =
  | 'core'
  | 'preact'
  | 'validation'
  | 'date'
  | 'sanitize'
  | 'charts'
  | 'viz'
  | 'csv'
  | 'xlsx'
  | 'tailwind'

export interface CapabilityPack {
  id: ArtifactPackId
  name: string
  description: string
  globals: string[]
}

export interface CapabilityManifest {
  defaultPacks: ArtifactPackId[]
  constraints: {
    network: 'none'
    maxHtmlBytes: number
  }
  runtime: {
    bridge: string[]
  }
  packs: CapabilityPack[]
}

export interface ResolvedCapabilityPacks {
  requested: ArtifactPackId[]
  loaded: CapabilityPack[]
  missing: ArtifactPackId[]
  preludeScriptTag: string
  manifestForPrompt: string
}

export type AgentTurnResult =
  | {
      kind: 'chat'
      text: string
    }
  | {
      kind: 'artifact'
      action: 'created' | 'edited'
      text: string
      artifact: ArtifactDocument
    }
