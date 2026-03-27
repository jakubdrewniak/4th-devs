import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '../logger.js'
import type {
  ArtifactPackId,
  CapabilityManifest,
  CapabilityPack,
  ResolvedCapabilityPacks,
} from '../types.js'

interface ArtifactPackDefinition extends CapabilityPack {
  files: string[]
  bootstrapScript?: string
}

export interface PackFileEntry {
  packId: ArtifactPackId
  servePath: string
  nodeModulePath: string
}

const packFileEntries: PackFileEntry[] = []
const packFileContentCache = new Map<string, string>()

const PACKS: Record<ArtifactPackId, ArtifactPackDefinition> = {
  core: {
    id: 'core',
    name: 'Core Runtime',
    description: 'Bridge helpers for state, events, and safe DOM utilities.',
    globals: ['ArtifactKit'],
    files: [],
    bootstrapScript: [
      '(function(){',
      '  if (window.ArtifactKit) return;',
      '  const createStore = (initial) => {',
      '    let value = initial;',
      '    const listeners = new Set();',
      '    return {',
      '      get: () => value,',
      '      set: (next) => {',
      '        value = typeof next === "function" ? next(value) : next;',
      '        listeners.forEach((listener) => listener(value));',
      '      },',
      '      subscribe: (listener) => {',
      '        listeners.add(listener);',
      '        return () => listeners.delete(listener);',
      '      }',
      '    };',
      '  };',
      '  const q = (selector, root) => (root || document).querySelector(selector);',
      '  const qa = (selector, root) => Array.from((root || document).querySelectorAll(selector));',
      '  window.ArtifactKit = { version: "0.1.0", createStore, q, qa };',
      '})();',
    ].join('\n'),
  },
  preact: {
    id: 'preact',
    name: 'Preact + HTM',
    description: 'Small component runtime for interactive UIs.',
    globals: ['preact', 'preactHooks', 'html'],
    files: ['preact/dist/preact.umd.js', 'preact/hooks/dist/hooks.umd.js', 'htm/dist/htm.umd.js'],
    bootstrapScript: [
      '(function(){',
      '  if (window.preact && window.htm && !window.html) {',
      '    window.html = window.htm.bind(window.preact.h);',
      '  }',
      '})();',
    ].join('\n'),
  },
  tailwind: {
    id: 'tailwind',
    name: 'Tailwind CSS (Browser)',
    description:
      'Utility-first styling runtime. Use Tailwind class names directly; for custom tokens/utilities use <style type="text/tailwindcss">.',
    globals: ['(class-based runtime)'],
    files: ['@tailwindcss/browser/dist/index.global.js'],
  },
  validation: {
    id: 'validation',
    name: 'Zod Validation',
    description: 'Schema validation for forms and structured inputs.',
    globals: ['Zod', 'z'],
    files: ['zod/lib/index.umd.js'],
    bootstrapScript: [
      '(function(){',
      '  if (window.Zod && !window.z) window.z = window.Zod;',
      '})();',
    ].join('\n'),
  },
  date: {
    id: 'date',
    name: 'Day.js',
    description: 'Date/time formatting and simple date arithmetic.',
    globals: ['dayjs'],
    files: ['dayjs/dayjs.min.js'],
  },
  sanitize: {
    id: 'sanitize',
    name: 'DOMPurify',
    description: 'HTML sanitization before rendering user input.',
    globals: ['DOMPurify'],
    files: ['dompurify/dist/purify.min.js'],
  },
  charts: {
    id: 'charts',
    name: 'Chart.js',
    description: 'Canvas charts for metrics dashboards.',
    globals: ['Chart'],
    files: ['chart.js/dist/chart.umd.js'],
  },
  viz: {
    id: 'viz',
    name: 'D3',
    description: 'Custom data visualizations and complex SVG layouts.',
    globals: ['d3'],
    files: ['d3/dist/d3.min.js'],
  },
  csv: {
    id: 'csv',
    name: 'PapaParse CSV',
    description: 'Fast CSV parsing and stringifying.',
    globals: ['Papa'],
    files: ['papaparse/papaparse.min.js'],
  },
  xlsx: {
    id: 'xlsx',
    name: 'SheetJS XLSX',
    description: 'Read/write Excel spreadsheet files. Large library — prefer csv pack when CSV suffices.',
    globals: ['XLSX'],
    files: ['xlsx/dist/xlsx.full.min.js'],
  },
}

const PACK_IDS = Object.keys(PACKS) as ArtifactPackId[]
const DEFAULT_PACKS: ArtifactPackId[] = ['core']

const fileCache = new Map<string, Promise<string | null>>()

const readNodeModuleFile = (relativePath: string): Promise<string | null> => {
  const cached = fileCache.get(relativePath)
  if (cached) return cached

  const pending = readFile(join(process.cwd(), 'node_modules', relativePath), 'utf-8')
    .then((value) => value)
    .catch((error) => {
      logger.warn('capabilities.pack_file_missing', {
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })

  fileCache.set(relativePath, pending)
  return pending
}

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items))

const normalizePackIds = (input: string[] | undefined): ArtifactPackId[] => {
  const requested = Array.isArray(input) ? input : []
  const normalized = requested
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ArtifactPackId => PACK_IDS.includes(value as ArtifactPackId))

  const merged = normalized.length > 0 ? normalized : [...DEFAULT_PACKS]
  return dedupe(merged)
}

const formatPackForPrompt = (pack: CapabilityPack): string =>
  `- ${pack.id}: ${pack.description} (globals: ${pack.globals.join(', ')})`

const escapeInlineScript = (value: string): string =>
  value.replace(/<\/(script)/gi, '<\\/$1')

const wrapInlineScriptTag = (code: string, label: string): string =>
  `<script data-pack="${label}">\n${escapeInlineScript(code)}\n</script>`

const wrapSrcScriptTag = (src: string, label: string): string =>
  `<script src="${src}" data-pack="${label}"></script>`

const buildPackServePath = (packId: ArtifactPackId, nodeModulePath: string): string => {
  const filename = nodeModulePath.split('/').pop() ?? `${packId}.js`
  return `/packs/${packId}/${filename}`
}

export const prewarmPackFiles = async (): Promise<void> => {
  packFileEntries.length = 0
  for (const id of PACK_IDS) {
    const pack = PACKS[id]
    for (const relativePath of pack.files) {
      const servePath = buildPackServePath(id, relativePath)
      packFileEntries.push({ packId: id, servePath, nodeModulePath: relativePath })
      const content = await readNodeModuleFile(relativePath)
      if (content != null) {
        packFileContentCache.set(servePath, content)
      }
    }
  }
  logger.info('capabilities.prewarmed', {
    packs: PACK_IDS.length,
    files: packFileContentCache.size,
  })
}

export const servePackFile = (pathname: string): Response | null => {
  const content = packFileContentCache.get(pathname)
  if (content == null) return null
  return new Response(content, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=86400, immutable',
      'access-control-allow-origin': '*',
    },
  })
}

export const CAPABILITY_MANIFEST: CapabilityManifest = {
  defaultPacks: DEFAULT_PACKS,
  constraints: {
    network: 'none',
    maxHtmlBytes: 2_000_000,
  },
  runtime: {
    bridge: ['window.ArtifactKit'],
  },
  packs: PACK_IDS.map((id) => ({
    id,
    name: PACKS[id].name,
    description: PACKS[id].description,
    globals: PACKS[id].globals,
  })),
}

export const artifactPackIds = PACK_IDS

export const getCapabilityManifestForPrompt = (): string => [
  'Capability manifest:',
  `- default packs: ${CAPABILITY_MANIFEST.defaultPacks.join(', ')}`,
  `- network: ${CAPABILITY_MANIFEST.constraints.network}`,
  `- max_html_bytes: ${CAPABILITY_MANIFEST.constraints.maxHtmlBytes}`,
  '- available packs:',
  ...CAPABILITY_MANIFEST.packs.map(formatPackForPrompt),
].join('\n')

export const resolveCapabilityPacks = async (
  requestedPackIds: string[] | undefined,
  serverBaseUrl?: string,
): Promise<ResolvedCapabilityPacks> => {
  const resolvedIds = normalizePackIds(requestedPackIds)
  const missing: ArtifactPackId[] = []
  const loaded: ArtifactPackId[] = []
  const scriptTags: string[] = []

  for (const id of resolvedIds) {
    const pack = PACKS[id]

    if (serverBaseUrl && pack.files.length > 0) {
      const allCached = pack.files.every((relativePath) => {
        const servePath = buildPackServePath(id, relativePath)
        return packFileContentCache.has(servePath)
      })

      if (!allCached) {
        missing.push(id)
        continue
      }

      loaded.push(id)
      for (const relativePath of pack.files) {
        const servePath = buildPackServePath(id, relativePath)
        scriptTags.push(wrapSrcScriptTag(`${serverBaseUrl}${servePath}`, id))
      }
    } else {
      const fileContents = await Promise.all(pack.files.map((relativePath) => readNodeModuleFile(relativePath)))
      const hasMissingFile = fileContents.some((content) => content == null)
      if (hasMissingFile) {
        missing.push(id)
        continue
      }

      loaded.push(id)
      const validFiles = fileContents.filter((content): content is string => typeof content === 'string')
      for (const fileCode of validFiles) {
        scriptTags.push(wrapInlineScriptTag(fileCode, id))
      }
    }

    if (pack.bootstrapScript) {
      scriptTags.push(wrapInlineScriptTag(pack.bootstrapScript, `${id}-bootstrap`))
    }
  }

  if (loaded.length === 0 && !resolvedIds.includes('core')) {
    const core = PACKS.core
    if (core.bootstrapScript) {
      loaded.push('core')
      scriptTags.push(wrapInlineScriptTag(core.bootstrapScript, 'core'))
    }
  }

  const loadedPacks = loaded.map((id) => ({
    id,
    name: PACKS[id].name,
    description: PACKS[id].description,
    globals: PACKS[id].globals,
  }))

  return {
    requested: resolvedIds,
    loaded: loadedPacks,
    missing,
    preludeScriptTag: scriptTags.join('\n'),
    manifestForPrompt: getCapabilityManifestForPrompt(),
  }
}
