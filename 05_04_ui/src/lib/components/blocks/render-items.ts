import type { Block, MessageStatus, ToolInteractionBlock } from '../../../../shared/chat'

export type RenderItem =
  | { kind: 'block'; block: Block; id: string }
  | { kind: 'chain'; blocks: ToolInteractionBlock[]; id: string }
  | { kind: 'delegation'; parent: ToolInteractionBlock; children: Block[]; id: string }

const isDelegationParentBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' && block.name === 'delegate_to_agent' && Boolean(block.childRunId)

const isAppViewToolBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' && Boolean(block.appsMeta?.resourceUri)

const isCompleteToolBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' && block.status === 'complete'

const buildDelegationGroups = (
  blocks: Block[],
): {
  childrenByParentId: Map<string, Block[]>
  allChildBlockIds: Set<string>
} => {
  const childRunToParent = new Map<string, string>()
  for (const block of blocks) {
    if (isDelegationParentBlock(block) && block.childRunId) {
      childRunToParent.set(block.childRunId, block.id)
    }
  }

  const childrenByParentId = new Map<string, Block[]>()
  const allChildBlockIds = new Set<string>()
  if (childRunToParent.size === 0) {
    return { childrenByParentId, allChildBlockIds }
  }

  for (const block of blocks) {
    const sourceRunId = block.sourceRunId
    if (!sourceRunId) {
      continue
    }

    const parentId = childRunToParent.get(sourceRunId)
    if (!parentId || block.id === parentId) {
      continue
    }

    // Surface MCP app views at the main transcript level instead of burying them inside agent blocks.
    if (isAppViewToolBlock(block)) {
      continue
    }

    allChildBlockIds.add(block.id)

    // Skip child text blocks from rendered children — the delegation summary already shows the output.
    if (block.type === 'text') {
      continue
    }

    const children = childrenByParentId.get(parentId) ?? []
    children.push(block)
    childrenByParentId.set(parentId, children)
  }

  return { childrenByParentId, allChildBlockIds }
}

const buildChainItems = (blocks: Block[]): RenderItem[] => {
  const items: RenderItem[] = []
  let index = 0

  while (index < blocks.length) {
    const block = blocks[index]
    if (isCompleteToolBlock(block)) {
      const chain: ToolInteractionBlock[] = [block]
      let nextIndex = index + 1
      while (nextIndex < blocks.length && isCompleteToolBlock(blocks[nextIndex])) {
        chain.push(blocks[nextIndex] as ToolInteractionBlock)
        nextIndex += 1
      }

      if (chain.length >= 3) {
        items.push({ kind: 'chain', blocks: chain, id: `chain-${chain[0].id}` })
        index = nextIndex
        continue
      }
    }

    items.push({ kind: 'block', block, id: block.id })
    index += 1
  }

  return items
}

export const buildBlockRenderItems = (
  blocks: Block[],
  messageStatus: MessageStatus,
): RenderItem[] => {
  const hasDelegations = blocks.some((block) => isDelegationParentBlock(block))

  if (!hasDelegations) {
    if (messageStatus === 'streaming') {
      return blocks.map((block) => ({ kind: 'block', block, id: block.id }))
    }
    return buildChainItems(blocks)
  }

  const { childrenByParentId, allChildBlockIds } = buildDelegationGroups(blocks)
  const collectDescendants = (parentId: string): Block[] => {
    const directChildren = childrenByParentId.get(parentId) ?? []
    const descendants: Block[] = []
    for (const child of directChildren) {
      descendants.push(child)
      if (isDelegationParentBlock(child)) {
        descendants.push(...collectDescendants(child.id))
      }
    }
    return descendants
  }

  const topLevelBlocks = blocks.filter((block) => !allChildBlockIds.has(block.id))
  const items: RenderItem[] = []

  for (const block of topLevelBlocks) {
    if (isDelegationParentBlock(block)) {
      items.push({
        kind: 'delegation',
        parent: block,
        children: collectDescendants(block.id),
        id: `deleg-${block.id}`,
      })
      continue
    }

    if (messageStatus !== 'streaming' && isCompleteToolBlock(block)) {
      const completeBlock: ToolInteractionBlock = block
      const lastItem = items[items.length - 1]
      if (lastItem?.kind === 'chain') {
        lastItem.blocks.push(completeBlock)
        continue
      }
      items.push({ kind: 'chain', blocks: [completeBlock], id: `chain-${completeBlock.id}` })
      continue
    }

    items.push({ kind: 'block', block, id: block.id })
  }

  if (messageStatus !== 'streaming') {
    return items.flatMap((item) =>
      item.kind === 'chain' && item.blocks.length < 3
        ? item.blocks.map((block) => ({ kind: 'block' as const, block, id: block.id }))
        : [item],
    )
  }

  return items
}
