import type {
  Block,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolInteractionBlock,
} from '../../../shared/chat'
import {
  rebuildIncrementalMarkdownView,
  syncIncrementalMarkdownView,
} from './streaming-markdown'

const findLatestOpenThinking = (blocks: Block[]): ThinkingBlock | null => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.type === 'thinking' && block.status === 'thinking') {
      return block
    }
  }

  return null
}

const updateTextRenderState = (block: TextBlock): void => {
  block.renderState = syncIncrementalMarkdownView(block.renderState, {
    blockId: block.id,
    content: block.content,
    streaming: block.streaming,
    allowCompaction: true,
  })
}

const createTextBlock = (
  eventId: string,
  createdAt: string,
  content: string,
): TextBlock => {
  const id = `text:${eventId}`

  return {
    id,
    type: 'text',
    content,
    streaming: true,
    createdAt,
    renderState: rebuildIncrementalMarkdownView({
      blockId: id,
      content,
      streaming: true,
    }),
  }
}

const closeStreamingText = (blocks: Block[]): void => {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type === 'text' && lastBlock.streaming) {
    lastBlock.streaming = false
    updateTextRenderState(lastBlock)
  }
}

/**
 * Full materialization — rebuilds all blocks from an event array.
 * Used for initial hydration from history. O(n) where n = events.length.
 */
export const materializeBlocks = (events: StreamEvent[]): Block[] => {
  const blocks: Block[] = []
  const toolIndexById = new Map<string, number>()

  for (const event of events) {
    applyEvent(blocks, event, toolIndexById)
  }

  return blocks
}

/**
 * Incremental event application — mutates the blocks array in-place for a
 * single event. O(1) per call, enabling streaming updates without rebuilding
 * the full block list on every SSE token.
 */
export const applyEvent = (
  blocks: Block[],
  event: StreamEvent,
  toolIndexById: Map<string, number>,
): void => {
  switch (event.type) {
    case 'assistant_message_start':
      break

    case 'text_delta': {
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock?.type === 'text') {
        lastBlock.content += event.textDelta
        lastBlock.streaming = true
        updateTextRenderState(lastBlock)
        break
      }

      const textBlock = createTextBlock(
        event.id,
        event.at,
        event.textDelta,
      )

      blocks.push(textBlock)
      break
    }

    case 'thinking_start': {
      closeStreamingText(blocks)

      const thinkingBlock: ThinkingBlock = {
        id: `thinking:${event.id}`,
        type: 'thinking',
        title: event.label ?? 'Reasoning',
        content: '',
        status: 'thinking',
        createdAt: event.at,
      }

      blocks.push(thinkingBlock)
      break
    }

    case 'thinking_delta': {
      const thinkingBlock = findLatestOpenThinking(blocks)
      if (thinkingBlock) {
        thinkingBlock.content += event.textDelta
        break
      }

      closeStreamingText(blocks)

      blocks.push({
        id: `thinking:${event.id}`,
        type: 'thinking',
        title: 'Reasoning',
        content: event.textDelta,
        status: 'thinking',
        createdAt: event.at,
      })
      break
    }

    case 'thinking_end': {
      const thinkingBlock = findLatestOpenThinking(blocks)
      if (thinkingBlock) {
        thinkingBlock.status = 'done'
      }
      break
    }

    case 'tool_call': {
      closeStreamingText(blocks)

      const toolBlock: ToolInteractionBlock = {
        id: `tool:${event.toolCallId}`,
        type: 'tool_interaction',
        toolCallId: event.toolCallId,
        name: event.name,
        args: event.args,
        status: 'running',
        createdAt: event.at,
      }

      toolIndexById.set(event.toolCallId, blocks.length)
      blocks.push(toolBlock)
      break
    }

    case 'tool_result': {
      const existingIndex = toolIndexById.get(event.toolCallId)
      if (existingIndex == null) {
        blocks.push({
          id: `tool:${event.toolCallId}`,
          type: 'tool_interaction',
          toolCallId: event.toolCallId,
          name: 'unknown_tool',
          args: {},
          status: event.ok ? 'complete' : 'error',
          output: event.output,
          finishedAt: event.at,
          createdAt: event.at,
        })
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        existingBlock.status = event.ok ? 'complete' : 'error'
        existingBlock.output = event.output
        existingBlock.finishedAt = event.at
      }
      break
    }

    case 'artifact':
      closeStreamingText(blocks)

      blocks.push({
        id: `artifact:${event.artifactId}`,
        type: 'artifact',
        artifactId: event.artifactId,
        kind: event.kind,
        title: event.title,
        description: event.description,
        path: event.path,
        preview: event.preview,
        createdAt: event.at,
      })
      break

    case 'error':
      closeStreamingText(blocks)

      blocks.push({
        id: `error:${event.id}`,
        type: 'error',
        message: event.message,
        createdAt: event.at,
      })
      break

    case 'complete':
      for (const block of blocks) {
        if (block.type === 'text') {
          block.streaming = false
          updateTextRenderState(block)
        }

        if (block.type === 'thinking' && block.status === 'thinking') {
          block.status = 'done'
        }
      }
      break
  }
}
