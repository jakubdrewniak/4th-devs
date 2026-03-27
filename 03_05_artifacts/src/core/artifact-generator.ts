import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { ENV } from '../config.js'
import { logger } from '../logger.js'
import { resolveCapabilityPacks } from './capabilities.js'
import type {
  ArtifactDocument,
  GenerateArtifactInput,
  GenerateArtifactOptions,
  GenerateArtifactProgress,
  ResolvedCapabilityPacks,
} from '../types.js'

const buildCsp = (serverBaseUrl?: string): string => {
  const scriptSrc = serverBaseUrl
    ? `'unsafe-inline' ${serverBaseUrl}`
    : "'unsafe-inline'"
  const connectSrc = serverBaseUrl
    ? `${serverBaseUrl}`
    : "'none'"
  return `default-src 'none'; connect-src ${connectSrc}; frame-src 'none'; img-src data: blob:; media-src data: blob:; script-src ${scriptSrc}; style-src 'unsafe-inline'; font-src data:;`
}

const buildArtifactInstructions = (packManifestForPrompt: string): string => [
  'You generate interactive browser artifacts.',
  'Return JSON only, no markdown, with this shape:',
  '{"title":"string","html":"string"}',
  'Rules for html:',
  '- must be self-contained, no external scripts, no external styles, no network calls',
  '- include semantic markup and clear UI states',
  '- keep JavaScript inline and small',
  '- body must render immediately',
  '- prefer preloaded globals from selected packs when appropriate',
  '- if tailwind pack is selected, use utility classes and optional <style type="text/tailwindcss"> blocks for custom theme/utilities',
  '',
  packManifestForPrompt,
].join('\n')

const GENERIC_SCROLLBAR_STYLES = `
      :root {
        --artifact-scrollbar-size: 11px;
        --artifact-scrollbar-track: color-mix(in srgb, #ffffff 8%, transparent);
        --artifact-scrollbar-thumb: color-mix(in srgb, currentColor 30%, transparent);
        --artifact-scrollbar-thumb-hover: color-mix(in srgb, currentColor 46%, transparent);
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--artifact-scrollbar-thumb) var(--artifact-scrollbar-track);
      }
      *::-webkit-scrollbar {
        width: var(--artifact-scrollbar-size);
        height: var(--artifact-scrollbar-size);
      }
      *::-webkit-scrollbar-track {
        background: var(--artifact-scrollbar-track);
        border-radius: 999px;
      }
      *::-webkit-scrollbar-thumb {
        background: var(--artifact-scrollbar-thumb);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: var(--artifact-scrollbar-thumb-hover);
      }
      *::-webkit-scrollbar-corner {
        background: transparent;
      }
`

interface RawArtifactPayload {
  title: string
  html: string
}

const openai = ENV.apiKey.trim().length > 0
  ? new OpenAI({ apiKey: ENV.apiKey, baseURL: ENV.baseURL, defaultHeaders: ENV.defaultHeaders })
  : null

const emitProgress = (
  options: GenerateArtifactOptions,
  progress: GenerateArtifactProgress,
): void => {
  options.onProgress?.(progress)
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const wrapSnippetAsDocument = (
  snippet: string,
  title: string,
  preludeScriptTag: string,
  csp: string,
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${escapeHtml(title)}</title>
    ${preludeScriptTag}
    <style>
${GENERIC_SCROLLBAR_STYLES}
      body {
        margin: 0;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          Segoe UI,
          Roboto,
          Helvetica,
          Arial,
          sans-serif;
      }
    </style>
  </head>
  <body>
${snippet}
  </body>
</html>
`

const buildHostScrollbarStyleTag = (): string =>
  `<style data-host-scrollbars>\n${GENERIC_SCROLLBAR_STYLES}\n</style>`

const injectIntoHead = (documentHtml: string, injection: string): string => {
  if (!injection) return documentHtml

  if (/<head[\s>]/i.test(documentHtml)) {
    return documentHtml.replace(/<head([^>]*)>/i, `<head$1>\n    ${injection}`)
  }
  if (/<html[\s>]/i.test(documentHtml)) {
    return documentHtml.replace(
      /<html([^>]*)>/i,
      `<html$1>\n  <head>\n    ${injection}\n  </head>`,
    )
  }
  return `<!doctype html>\n<html>\n  <head>\n    ${injection}\n  </head>\n  <body>\n${documentHtml}\n  </body>\n</html>`
}

const injectCsp = (documentHtml: string, csp: string): string => {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(documentHtml)) {
    return documentHtml
  }
  return injectIntoHead(
    documentHtml,
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
  )
}

const toHtmlDocument = (
  html: string,
  title: string,
  preludeScriptTag: string,
  csp: string,
): string => {
  const trimmed = html.trim()
  if (!trimmed) return wrapSnippetAsDocument('<main><p>Artifact content is empty.</p></main>', title, preludeScriptTag, csp)
  
  if (/<html[\s>]/i.test(trimmed) || /<!doctype/i.test(trimmed)) {
    // Inject all three at once so they don't overwrite each other's `<head>` insertions
    // if the document initially had no `<head>`.
    const combinedInjection = [
      `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      buildHostScrollbarStyleTag(),
      preludeScriptTag,
    ].filter(Boolean).join('\n    ')

    let next = trimmed
    if (!/http-equiv=["']Content-Security-Policy["']/i.test(next)) {
      return injectIntoHead(next, combinedInjection)
    }
    
    // If CSP already exists, inject just styles and prelude
    const remainingInjection = [
      buildHostScrollbarStyleTag(),
      preludeScriptTag,
    ].filter(Boolean).join('\n    ')
    
    return injectIntoHead(next, remainingInjection)
  }
  
  return wrapSnippetAsDocument(trimmed, title, preludeScriptTag, csp)
}

const extractJsonCandidates = (text: string): string[] => {
  const candidates = new Set<string>()
  const normalized = text.trim()
  if (normalized) candidates.add(normalized)

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) candidates.add(fencedMatch[1].trim())

  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(normalized.slice(firstBrace, lastBrace + 1))
  }

  return Array.from(candidates)
}

const isRawArtifactPayload = (value: unknown): value is RawArtifactPayload => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string' && typeof record.html === 'string'
}

const parseArtifactPayload = (rawText: string): RawArtifactPayload | null => {
  for (const candidate of extractJsonCandidates(rawText)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (isRawArtifactPayload(parsed)) {
        return parsed
      }
    } catch {
      // Continue to next candidate.
    }
  }
  return null
}

const buildFallbackArtifact = (
  prompt: string,
  packs: ResolvedCapabilityPacks,
  csp: string,
): ArtifactDocument => {
  const title = `Local fallback: ${prompt.slice(0, 48) || 'Untitled'}`
  const escapedPrompt = escapeHtml(prompt)
  const html = wrapSnippetAsDocument(
    `
<main style="display:grid;gap:14px;padding:20px;max-width:780px;margin:0 auto;">
  <h1 style="margin:0;font-size:1.2rem;">${escapeHtml(title)}</h1>
  <p style="margin:0;color:#425466;">
    No API key configured, so this placeholder is rendered by local fallback.
  </p>
  <section style="background:#f4f7fb;border:1px solid #dbe5f0;border-radius:10px;padding:12px;">
    <h2 style="margin:0 0 8px;font-size:0.95rem;">Prompt</h2>
    <pre style="margin:0;white-space:pre-wrap;word-break:break-word;">${escapedPrompt}</pre>
  </section>
  <button id="demo-btn" style="justify-self:start;padding:8px 12px;">Click demo</button>
  <p id="demo-msg" style="margin:0;color:#0a7a42;"></p>
</main>
<script>
  const button = document.getElementById('demo-btn');
  const message = document.getElementById('demo-msg');
  if (button && message) {
    button.addEventListener('click', () => {
      message.textContent = 'Fallback artifact is interactive and connected to live preview.';
    });
  }
</script>
`,
    title,
    packs.preludeScriptTag,
    csp,
  )

  return {
    id: randomUUID(),
    title,
    prompt,
    html,
    model: 'local-fallback',
    packs: packs.loaded.map((pack) => pack.id),
    createdAt: new Date().toISOString(),
  }
}

export const generateArtifact = async (
  input: GenerateArtifactInput,
  options: GenerateArtifactOptions = {},
): Promise<ArtifactDocument> => {
  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new Error('Prompt cannot be empty.')
  }

  emitProgress(options, {
    phase: 'interpreting_request',
    message: 'Resolving capability packs...',
  })

  const serverBaseUrl = input.serverBaseUrl
  const csp = buildCsp(serverBaseUrl)
  const packs = await resolveCapabilityPacks(input.packs, serverBaseUrl)
  if (packs.missing.length > 0) {
    logger.warn('artifact.packs_missing', {
      missing: packs.missing,
    })
  }

  const selectedPackIds = packs.loaded.map((pack) => pack.id)
  const selectedPackList = selectedPackIds.length > 0 ? selectedPackIds.join(', ') : 'core'

  if (!openai) {
    logger.warn('artifact.fallback_used', { reason: 'missing_openai_api_key' })
    emitProgress(options, {
      phase: 'assembling_document',
      message: 'API key missing, rendering local fallback artifact.',
    })
    return buildFallbackArtifact(prompt, packs, csp)
  }

  emitProgress(options, {
    phase: 'calling_model',
    message: `Generating artifact with ${ENV.model} (packs: ${selectedPackList})...`,
  })

  let payload: RawArtifactPayload | null = null
  try {
    const response = await openai.responses.create({
      model: ENV.model,
      reasoning: { effort: ENV.reasoningEffort },
      instructions: buildArtifactInstructions(packs.manifestForPrompt),
      input: [
        `User request:\n${prompt}`,
        `Selected packs: ${selectedPackList}`,
        'Use preloaded globals from selected packs where useful.',
        'Return strict JSON only.',
      ].join('\n\n'),
    })
    payload = parseArtifactPayload(response.output_text ?? '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Model request failed: ${message}`)
  }

  if (!payload) {
    throw new Error('Model returned an invalid payload. Expected JSON with title and html.')
  }

  emitProgress(options, {
    phase: 'assembling_document',
    message: 'Preparing artifact document...',
  })

  const title = payload.title.trim() || 'Untitled artifact'
  const html = toHtmlDocument(payload.html, title, packs.preludeScriptTag, csp)

  if (html.length > 2_000_000) {
    throw new Error('Artifact is too large. Try a smaller request.')
  }

  return {
    id: randomUUID(),
    title,
    prompt,
    html,
    model: ENV.model,
    packs: selectedPackIds,
    createdAt: new Date().toISOString(),
  }
}
