import { getContext, hasContext, setContext } from 'svelte'
import type { LightboxController } from './lightbox-controller.svelte'

const LIGHTBOX_CONTEXT = Symbol('lightbox-controller')

export const setLightboxContext = (controller: LightboxController): LightboxController => {
  setContext(LIGHTBOX_CONTEXT, controller)
  return controller
}

export const getLightboxContext = (): LightboxController =>
  getContext<LightboxController>(LIGHTBOX_CONTEXT)

export const tryGetLightboxContext = (): LightboxController | undefined =>
  hasContext(LIGHTBOX_CONTEXT) ? getContext<LightboxController>(LIGHTBOX_CONTEXT) : undefined
