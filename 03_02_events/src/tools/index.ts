import type { Tool } from '../types.js'
import { humanTools } from './human.js'
import { imageTools } from './image.js'
import { renderHtmlTools } from './render-html.js'
import { webSearchTools } from './web-search.js'

export const tools: Tool[] = [...webSearchTools, ...imageTools, ...humanTools, ...renderHtmlTools]

export const findTool = (name: string): Tool | undefined =>
  tools.find((tool) => tool.definition.name === name)
