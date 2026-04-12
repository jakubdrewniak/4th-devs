import { getContext, setContext } from 'svelte'
import type { ShortcutScope } from '../shortcuts/types'

const SHORTCUT_LAYER_STACK_CONTEXT = Symbol('shortcut-layer-stack')

type LayeredShortcutScope = Exclude<ShortcutScope, 'global'>

interface ShortcutLayerEntry {
  id: string
  scope: LayeredShortcutScope
}

export interface ShortcutLayerStack {
  getActiveScope: () => ShortcutScope
  getLayers: () => readonly ShortcutLayerEntry[]
  pushLayer: (scope: LayeredShortcutScope, id?: string) => () => void
}

export const createShortcutLayerStack = (): ShortcutLayerStack => {
  const layers: ShortcutLayerEntry[] = []
  let nextLayerId = 0

  return {
    getActiveScope() {
      return layers[layers.length - 1]?.scope ?? 'global'
    },

    getLayers() {
      return layers.slice()
    },

    pushLayer(scope, id = `layer:${scope}:${nextLayerId += 1}`) {
      const entry: ShortcutLayerEntry = {
        id,
        scope,
      }

      layers.push(entry)

      return () => {
        const index = layers.findIndex((layer) => layer.id === id)
        if (index >= 0) {
          layers.splice(index, 1)
        }
      }
    },
  }
}

export const setShortcutLayerStackContext = (layerStack: ShortcutLayerStack): ShortcutLayerStack => {
  setContext(SHORTCUT_LAYER_STACK_CONTEXT, layerStack)
  return layerStack
}

export const getShortcutLayerStackContext = (): ShortcutLayerStack =>
  getContext<ShortcutLayerStack>(SHORTCUT_LAYER_STACK_CONTEXT)
