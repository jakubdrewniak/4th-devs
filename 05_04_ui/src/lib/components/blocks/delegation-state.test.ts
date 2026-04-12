import { describe, expect, test } from 'vitest'
import { asToolCallId, type Block, type ToolInteractionBlock } from '../../../../shared/chat'
import { getDelegationStatus, getWaitingFooterLabel, getWaitingFooterState } from './delegation-state'

const at = '2026-04-03T00:00:00.000Z'

const delegateBlock = (overrides: Partial<ToolInteractionBlock> = {}): ToolInteractionBlock => ({
  args: { agentAlias: 'tony', task: 'Handle the clarification' },
  childRunId: 'run_child_1',
  createdAt: at,
  id: 'tool:delegate_1',
  name: 'delegate_to_agent',
  status: 'running',
  toolCallId: asToolCallId('call_delegate_1'),
  type: 'tool_interaction',
  ...overrides,
})

describe('delegation-state', () => {
  test('treats suspended delegate output as suspended instead of completed', () => {
    const parent = delegateBlock({
      finishedAt: at,
      output: {
        childRunId: 'run_child_1',
        kind: 'suspended',
        summary: 'Tony needs the exact track name.',
        waits: [
          {
            args: null,
            description: 'Which track?',
            targetKind: 'human_response',
            targetRef: 'user_response',
            tool: 'suspend_run',
            type: 'human',
            waitId: 'wte_child_1',
          },
        ],
      },
      status: 'complete',
    })

    expect(getDelegationStatus(parent, [])).toBe('suspended')
  })

  test('treats a running suspend_run child as suspended', () => {
    const parent = delegateBlock()
    const children: Block[] = [
      {
        args: {
          reason: 'Need the exact track before continuing.',
          targetKind: 'human_response',
        },
        createdAt: at,
        id: 'tool:suspend_1',
        name: 'suspend_run',
        sourceRunId: 'run_child_1',
        status: 'running',
        toolCallId: asToolCallId('call_suspend_1'),
        type: 'tool_interaction',
      },
    ]

    expect(getDelegationStatus(parent, children)).toBe('suspended')
  })

  test('builds a reply-specific waiting footer for suspended delegated work', () => {
    const blocks: Block[] = [
      delegateBlock({
        finishedAt: at,
        output: {
          childRunId: 'run_child_1',
          kind: 'suspended',
          summary: 'Tony needs clarification.',
          waits: [
            {
              args: null,
              description: 'Which track?',
              targetKind: 'human_response',
              targetRef: 'user_response',
              tool: 'suspend_run',
              type: 'human',
              waitId: 'wte_child_1',
            },
          ],
        },
        status: 'complete',
      }),
    ]

    expect(getWaitingFooterLabel(blocks)).toBe('Waiting for your reply before tony can continue.')
    expect(getWaitingFooterState(blocks).kind).toBe('reply')
  })
})
