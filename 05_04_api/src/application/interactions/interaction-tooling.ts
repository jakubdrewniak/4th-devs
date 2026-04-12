import type {
  AiInteractionRequest,
  AiProviderNativeToolName,
  AiToolDefinition,
} from '../../domain/ai/types'
import type { ToolSpec } from '../../domain/tooling/tool-registry'

const modelVisibleFunctionToolNamePattern = /^[a-zA-Z0-9_-]+$/

export const isModelVisibleFunctionToolName = (name: string): boolean =>
  modelVisibleFunctionToolNamePattern.test(name)

export const toToolDefinitions = (toolSpecs: ToolSpec[]): AiToolDefinition[] =>
  toolSpecs.flatMap((tool) =>
    isModelVisibleFunctionToolName(tool.name)
      ? [
          {
            description: tool.description,
            kind: 'function' as const,
            name: tool.name,
            parameters: tool.inputSchema,
            strict: tool.strict ?? true,
          },
        ]
      : [],
  )

export const buildInteractionToolingRequest = (
  activeTools: ToolSpec[],
  nativeTools: AiProviderNativeToolName[],
): Pick<
  AiInteractionRequest,
  'allowParallelToolCalls' | 'nativeTools' | 'toolChoice' | 'tools'
> => {
  const toolDefinitions = toToolDefinitions(activeTools)

  return {
    ...(toolDefinitions.length > 0
      ? {
          allowParallelToolCalls: true,
          toolChoice: 'auto' as const,
          tools: toolDefinitions,
        }
      : {}),
    ...(nativeTools.length > 0 ? { nativeTools: [...nativeTools] } : {}),
  }
}
