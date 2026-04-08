import type { ConversationSnapshot } from '../../shared/chat'

export interface PendingToolCall {
  callId: string
  name: string
  argumentsText: string
}

export interface LiveTurnOptions {
  conversation: ConversationSnapshot
  assistantMessageId: string
  startSeq: number
  dataDir: string
}

export type KnownStreamEvent =
  | {
      type: 'response.output_item.added'
      output_index: number
      item: {
        type: string
        call_id?: string
        name?: string
        arguments?: string
      }
    }
  | {
      type: 'response.output_item.done'
      item: {
        type: string
        call_id?: string
        name?: string
        arguments?: string
      }
    }
  | {
      type: 'response.output_text.delta'
      delta: string
    }
  | {
      type: 'response.refusal.delta'
      delta: string
    }
  | {
      type: 'response.reasoning_summary_text.delta'
      delta: string
    }
  | {
      type: 'response.reasoning_summary_part.done'
    }
  | {
      type: 'response.function_call_arguments.delta'
      output_index: number
      delta: string
    }
  | {
      type: 'response.function_call_arguments.done'
      output_index: number
      arguments: string
    }
  | {
      type: 'response.failed'
      response: {
        error?: {
          message?: string
        }
      }
    }
