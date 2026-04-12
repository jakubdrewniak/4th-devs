import { describe, expect, test } from 'vitest'
import { asToolCallId, type Block } from '../../../../shared/chat'
import { buildBlockRenderItems } from './render-items'

const at = '2026-03-31T08:00:00.000Z'

describe('buildBlockRenderItems', () => {
  test('groups nested delegated activity by source run id', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Switch the music' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Done, Tony switched it.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        content: 'Checking Spotify controls.',
        createdAt: at,
        id: 'thinking:child',
        sourceRunId: 'run_child',
        status: 'done',
        title: 'reasoning',
        type: 'thinking',
      },
      {
        args: { action: 'play_track', query: 'Nora En Pure - Pretoria' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:child_control',
        name: 'spotify__spotify_control',
        output: { ok: true },
        sourceRunId: 'run_child',
        status: 'complete',
        toolCallId: asToolCallId('call_child_control'),
        type: 'tool_interaction',
      },
      {
        args: { agentAlias: 'jenny', task: 'Confirm the playlist' },
        childRunId: 'run_grandchild',
        createdAt: at,
        id: 'tool:child_delegate',
        name: 'delegate_to_agent',
        sourceRunId: 'run_child',
        status: 'running',
        toolCallId: asToolCallId('call_child_delegate'),
        type: 'tool_interaction',
      },
      {
        args: { value: 'hello' },
        confirmation: {
          ownerRunId: 'run_grandchild',
          targetRef: 'mcp.echo',
          waitId: 'wte_grandchild',
          description: 'Need approval before continuing.',
        },
        createdAt: at,
        id: 'tool:grandchild_confirm',
        name: 'mcp.echo',
        sourceRunId: 'run_grandchild',
        status: 'awaiting_confirmation',
        toolCallId: asToolCallId('call_grandchild_confirm'),
        type: 'tool_interaction',
      },
    ]

    const topLevelItems = buildBlockRenderItems(blocks, 'complete')
    expect(topLevelItems).toHaveLength(1)
    expect(topLevelItems[0]).toMatchObject({
      id: 'deleg-tool:delegate_root',
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })

    if (topLevelItems[0]?.kind !== 'delegation') {
      throw new Error('expected top-level delegation render item')
    }

    expect(topLevelItems[0].children.map((child) => child.id)).toEqual([
      'thinking:child',
      'tool:child_control',
      'tool:child_delegate',
      'tool:grandchild_confirm',
    ])

    const nestedItems = buildBlockRenderItems(topLevelItems[0].children, 'complete')
    expect(nestedItems).toHaveLength(3)
    expect(nestedItems[2]).toMatchObject({
      id: 'deleg-tool:child_delegate',
      kind: 'delegation',
      parent: { id: 'tool:child_delegate' },
    })

    if (nestedItems[2]?.kind !== 'delegation') {
      throw new Error('expected nested delegation render item')
    }

    expect(nestedItems[2].children).toMatchObject([
      {
        id: 'tool:grandchild_confirm',
        status: 'awaiting_confirmation',
        type: 'tool_interaction',
      },
    ])
  })

  test('hoists delegated MCP app tool blocks to the top-level transcript', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Open the Linear dashboard' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Opened Linear.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        createdAt: at,
        id: 'thinking:child',
        sourceRunId: 'run_child',
        status: 'done',
        title: 'reasoning',
        content: 'Loading the UI.',
        type: 'thinking',
      },
      {
        appsMeta: {
          resourceUri: 'ui://linear/issues',
          serverId: 'mcs_linear',
        },
        args: {},
        createdAt: at,
        finishedAt: at,
        id: 'tool:child_linear',
        name: 'linear__show_issues_ui',
        output: {
          meta: {
            ui: {
              resourceUri: 'ui://linear/issues',
            },
          },
          ok: true,
        },
        sourceRunId: 'run_child',
        status: 'complete',
        toolCallId: asToolCallId('call_child_linear'),
        type: 'tool_interaction',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'deleg-tool:delegate_root',
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })
    expect(items[1]).toMatchObject({
      id: 'tool:child_linear',
      kind: 'block',
      block: {
        appsMeta: {
          resourceUri: 'ui://linear/issues',
          serverId: 'mcs_linear',
        },
        id: 'tool:child_linear',
        name: 'linear__show_issues_ui',
      },
    })

    if (items[0]?.kind !== 'delegation') {
      throw new Error('expected delegation item')
    }

    expect(items[0].children).toMatchObject([
      {
        id: 'thinking:child',
        type: 'thinking',
      },
    ])
  })

  test('orphaned child blocks with unmatched sourceRunId appear at the top level', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Do work' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Done.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        args: { query: 'test' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:orphaned_tool',
        name: 'some_tool',
        output: { ok: true },
        sourceRunId: 'run_unknown_child',
        status: 'complete',
        toolCallId: asToolCallId('call_orphaned'),
        type: 'tool_interaction',
      },
      {
        content: 'Final text.',
        createdAt: at,
        id: 'text:final',
        renderState: {
          committedSegments: [],
          liveTail: 'Final text.',
          nextSegmentIndex: 0,
          processedContent: 'Final text.',
        },
        streaming: false,
        type: 'text',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    // delegation + orphaned tool + text = 3 top-level items
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })

    if (items[0]?.kind !== 'delegation') {
      throw new Error('expected delegation item')
    }

    // Delegation has no nested children — orphaned block doesn't match
    expect(items[0].children).toEqual([])

    // Orphaned block renders at top level
    expect(items[1]).toMatchObject({
      kind: 'block',
      block: { id: 'tool:orphaned_tool', sourceRunId: 'run_unknown_child' },
    })
    expect(items[2]).toMatchObject({
      kind: 'block',
      block: { id: 'text:final' },
    })
  })
})
