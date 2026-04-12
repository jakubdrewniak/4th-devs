/**
 * Lightbox payload — images only. Panels moved to inline view store.
 */
export type LightboxItem = {
  kind: 'image'
  /** Backend path, absolute URL, or public URL — not a transient object URL from virtualized tiles. */
  sourceUrl: string
  alt: string
  caption?: string | null
}

export const isImageLightboxItem = (
  item: LightboxItem,
): item is Extract<LightboxItem, { kind: 'image' }> => item.kind === 'image'

/** @deprecated MCP/Agent panels are now inline views, not lightbox items. */
export const isMcpPanelLightboxItem = (_item: LightboxItem): boolean => false

/** @deprecated MCP/Agent panels are now inline views, not lightbox items. */
export const isAgentPanelLightboxItem = (_item: LightboxItem): boolean => false
