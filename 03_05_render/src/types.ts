export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PreviewPhase =
  | 'idle'
  | 'interpreting_request'
  | 'calling_model'
  | 'assembling_document'
  | 'completed'
  | 'failed'

export type RenderPackId =
  | 'analytics-core'
  | 'analytics-viz'
  | 'analytics-table'
  | 'analytics-insight'
  | 'analytics-controls'

export type RenderComponentId =
  | 'Stack'
  | 'Grid'
  | 'Card'
  | 'Heading'
  | 'Text'
  | 'Badge'
  | 'Separator'
  | 'Metric'
  | 'LineChart'
  | 'BarChart'
  | 'Table'
  | 'Alert'
  | 'Callout'
  | 'Accordion'
  | 'Input'
  | 'Select'
  | 'RadioGroup'
  | 'Switch'
  | 'Button'

export interface RenderComponentDefinition {
  id: RenderComponentId
  description: string
  propsGuide: string[]
}

export interface RenderPackDefinition {
  id: RenderPackId
  name: string
  description: string
  components: RenderComponentId[]
}

export interface RenderCatalogManifest {
  defaultPacks: RenderPackId[]
  constraints: {
    network: 'none'
    maxElements: number
  }
  packs: RenderPackDefinition[]
  components: RenderComponentDefinition[]
}

export interface RenderSpecElement {
  type: RenderComponentId
  props?: Record<string, unknown>
  children?: string[]
}

export interface RenderSpec {
  root: string
  elements: Record<string, RenderSpecElement>
}

export interface RenderDocument {
  id: string
  title: string
  prompt: string
  summary: string | null
  spec: RenderSpec
  state: Record<string, unknown>
  html: string
  model: string
  packs: RenderPackId[]
  createdAt: string
}

export interface PreviewState {
  status: PreviewStatus
  phase: PreviewPhase
  message: string
  lastPrompt: string | null
  lastAssistantMessage: string | null
  document: RenderDocument | null
  error: string | null
  updatedAt: string
}

export interface GenerateRenderProgress {
  phase: PreviewPhase
  message: string
}

export interface GenerateRenderInput {
  prompt: string
  packs?: string[]
}

export interface GenerateRenderOptions {
  onProgress?: (progress: GenerateRenderProgress) => void
}

export interface ResolvedRenderPacks {
  requested: RenderPackId[]
  loaded: RenderPackDefinition[]
  missing: string[]
  allowedComponents: RenderComponentId[]
  manifestForPrompt: string
}

// --- Conversation ---

export type TextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type FunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type Message = TextMessage | FunctionCallItem | FunctionCallOutputItem

// --- Tools ---

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: boolean
}

export interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>) => Promise<string>
}

// --- Agent ---

export interface AgentContext {
  getCurrentDocument: () => RenderDocument | null
  onDocumentChanged: (document: RenderDocument) => void
  onProgress?: (progress: GenerateRenderProgress) => void
}

export interface AgentResult {
  text: string
  turns: number
}
