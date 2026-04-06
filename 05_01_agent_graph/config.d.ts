export interface PrimitivesConfig {
  provider: 'openai' | 'openrouter'
  apiKey: string
  baseUrl: string
  headers: Record<string, string>
  requestedModel: string
  model: string
  supportsReasoning: boolean
  maxOutputTokens: number
  reasoning: {
    effort: 'minimal' | 'low' | 'medium' | 'high'
    summary: 'auto'
  }
}

export const primitivesConfig: PrimitivesConfig
