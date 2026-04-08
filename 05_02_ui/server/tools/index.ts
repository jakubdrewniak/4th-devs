import { createArtifactTool } from './artifacts'
import { lookupContactContextTool, sendEmailTool } from './email'
import { searchNotesTool } from './notes'
import { getSalesReportTool, renderChartTool } from './sales'
import type { RegisteredTool, ToolContext, ToolExecutionResult } from './types'

const registry: Record<string, RegisteredTool> = {
  [getSalesReportTool.definition.name]: getSalesReportTool,
  [renderChartTool.definition.name]: renderChartTool,
  [lookupContactContextTool.definition.name]: lookupContactContextTool,
  [sendEmailTool.definition.name]: sendEmailTool,
  [createArtifactTool.definition.name]: createArtifactTool,
  [searchNotesTool.definition.name]: searchNotesTool,
}

export const toolDefinitions = Object.values(registry).map(tool => tool.definition)

export const executeMockedTool = async (
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecutionResult> => {
  const tool = registry[name]
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  return tool.handle(args, ctx)
}

export type {
  FunctionToolDefinition,
  RegisteredTool,
  ToolArtifact,
  ToolContext,
  ToolExecutionResult,
} from './types'
