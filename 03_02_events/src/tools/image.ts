import { ENV } from '../config/index.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Tool } from '../types.js'
import {
  asWorkspaceSafePath,
  asWorkspaceSafePaths,
  getImageMimeType,
  IMAGE_ASSETS_DIR,
  toSlug,
  WORKSPACE_DIR,
} from './common.js'

const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image-preview'

interface GeminiImageOutput {
  type: 'image'
  data: string
  mime_type: string
}

interface GeminiTextOutput {
  type: 'text'
  text: string
}

interface GeminiInteractionResponse {
  outputs?: Array<GeminiImageOutput | GeminiTextOutput>
  error?: { message?: string }
}

const getGeminiApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set.')
  return key
}

const buildImagePrompt = (prompt: string, stylePreset: unknown): string => {
  if (stylePreset === 'none') return prompt

  return [
    prompt,
    '',
    'Style constraints:',
    '- Hand-drawn architecture schema style with notebook-like sketch lines.',
    '- Clear labels, directional arrows, and compact visual hierarchy.',
    '- White background, minimal color accents, no photorealism.',
    '- Clean readability for technical presentation slides.',
  ].join('\n')
}

const callGeminiInteractions = async (
  payload: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<GeminiInteractionResponse> => {
  const response = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getGeminiApiKey(),
    },
    body: JSON.stringify(payload),
    signal: abortSignal,
  })

  const data = (await response.json()) as GeminiInteractionResponse
  if (data.error) {
    throw new Error(data.error.message ?? JSON.stringify(data.error))
  }
  return data
}

const extractGeminiImage = (
  response: GeminiInteractionResponse,
): { data: string; mimeType: string } => {
  const imageOutput = response.outputs?.find(
    (output): output is GeminiImageOutput => output.type === 'image',
  )

  if (!imageOutput) {
    const textOutput = response.outputs?.find(
      (output): output is GeminiTextOutput => output.type === 'text',
    )
    if (textOutput) {
      throw new Error(`Gemini returned text instead of image: ${textOutput.text}`)
    }
    throw new Error('No image output received from Gemini.')
  }

  return { data: imageOutput.data, mimeType: imageOutput.mime_type || 'image/png' }
}

const geminiGenerate = async (
  prompt: string,
  options: { aspectRatio?: string; imageSize?: string; abortSignal?: AbortSignal } = {},
): Promise<{ data: string; mimeType: string }> => {
  const payload: Record<string, unknown> = {
    model: GEMINI_IMAGE_MODEL,
    input: prompt,
    response_modalities: ['IMAGE'],
  }

  if (options.aspectRatio || options.imageSize) {
    const imageConfig: Record<string, string> = {}
    if (options.aspectRatio) imageConfig.aspect_ratio = options.aspectRatio
    if (options.imageSize) imageConfig.image_size = options.imageSize
    payload.generation_config = { image_config: imageConfig }
  }

  const response = await callGeminiInteractions(payload, options.abortSignal)
  return extractGeminiImage(response)
}

const geminiEdit = async (
  instructions: string,
  referenceImages: Array<{ data: string; mimeType: string }>,
  options: { aspectRatio?: string; imageSize?: string; abortSignal?: AbortSignal } = {},
): Promise<{ data: string; mimeType: string }> => {
  const input: Array<Record<string, string>> = [{ type: 'text', text: instructions }]
  for (const ref of referenceImages) {
    input.push({ type: 'image', data: ref.data, mime_type: ref.mimeType })
  }

  const payload: Record<string, unknown> = {
    model: GEMINI_IMAGE_MODEL,
    input,
    response_modalities: ['IMAGE'],
  }

  if (options.aspectRatio || options.imageSize) {
    const imageConfig: Record<string, string> = {}
    if (options.aspectRatio) imageConfig.aspect_ratio = options.aspectRatio
    if (options.imageSize) imageConfig.image_size = options.imageSize
    payload.generation_config = { image_config: imageConfig }
  }

  const response = await callGeminiInteractions(payload, options.abortSignal)
  return extractGeminiImage(response)
}

export const imageTools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'create_image',
      description:
        'Generate an image under workspace/project/assets and return the saved path.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed image prompt for the desired diagram.',
          },
          output_name: {
            type: 'string',
            description:
              'Logical output name (without extension). Example: observational-memory-schema.',
          },
          reference_images: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional local reference image paths relative to workspace, used for edit mode.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
            description: 'Preferred output aspect ratio.',
          },
          image_size: {
            type: 'string',
            enum: ['1k', '2k', '4k'],
            description: 'Desired quality preset.',
          },
          style_preset: {
            type: 'string',
            enum: ['hand_drawn_schema', 'none'],
            description: 'Visual style preset. Defaults to hand_drawn_schema.',
          },
        },
        required: ['prompt', 'output_name'],
      },
    },
    handler: async (args, ctx) => {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      const outputName = typeof args.output_name === 'string' ? args.output_name.trim() : ''
      if (!prompt || !outputName) {
        return { kind: 'text', content: 'Error: prompt and output_name are required.' }
      }

      const safeReferences = asWorkspaceSafePaths(args.reference_images)
      const givenReferences = Array.isArray(args.reference_images)
        ? args.reference_images.filter((item): item is string => typeof item === 'string')
        : []
      if (safeReferences.length !== givenReferences.length) {
        return { kind: 'text', content: 'Error: one or more reference image paths are unsafe.' }
      }

      const stylePreset = typeof args.style_preset === 'string' ? args.style_preset : 'hand_drawn_schema'
      const stylizedPrompt = buildImagePrompt(prompt, stylePreset)
      const aspectRatio = typeof args.aspect_ratio === 'string' ? args.aspect_ratio : '16:9'
      const imageSize = typeof args.image_size === 'string' ? args.image_size : '2k'

      const baseNameInput = outputName.replace(/\.(png|jpe?g|webp|gif)$/i, '')
      const safeName = toSlug(baseNameInput) || `image-${Date.now()}`

      try {
        let result: { data: string; mimeType: string }
        if (safeReferences.length > 0) {
          const loaded = await Promise.all(
            safeReferences.map(async (refPath) => {
              const buffer = await readFile(join(WORKSPACE_DIR, refPath))
              return { data: buffer.toString('base64'), mimeType: getImageMimeType(refPath) }
            }),
          )
          result = await geminiEdit(stylizedPrompt, loaded, {
            aspectRatio,
            imageSize,
            abortSignal: ctx.abortSignal,
          })
        } else {
          result = await geminiGenerate(stylizedPrompt, {
            aspectRatio,
            imageSize,
            abortSignal: ctx.abortSignal,
          })
        }

        const imageBuffer = Buffer.from(result.data, 'base64')
        const ext =
          result.mimeType === 'image/jpeg'
            ? '.jpg'
            : result.mimeType === 'image/webp'
              ? '.webp'
              : result.mimeType === 'image/gif'
                ? '.gif'
                : '.png'
        const outputPath = `${IMAGE_ASSETS_DIR}/${safeName}${ext}`
        const absolutePath = join(WORKSPACE_DIR, outputPath)
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, imageBuffer)

        return {
          kind: 'text',
          content: JSON.stringify(
            {
              success: true,
              mode: safeReferences.length > 0 ? 'edit' : 'generate',
              path: outputPath,
              output_path: outputPath,
              absolute_path: absolutePath,
              model: GEMINI_IMAGE_MODEL,
              aspect_ratio: aspectRatio,
              image_size: imageSize,
              reference_images: safeReferences,
            },
            null,
            2,
          ),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'text', content: `Error: image generation failed (${message})` }
      }
    },
  },
  {
    definition: {
      type: 'function',
      name: 'analyze_image',
      description:
        'Analyze a generated local image against its prompt and report quality or mismatch issues.',
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Relative local path to an image file in workspace.',
          },
          original_prompt: {
            type: 'string',
            description: 'Prompt that was used to generate or edit the image.',
          },
          check_aspects: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'prompt_adherence',
                'visual_artifacts',
                'readability',
                'style_consistency',
                'composition',
              ],
            },
            description: 'Optional list of aspects to emphasize during analysis.',
          },
        },
        required: ['image_path', 'original_prompt'],
      },
    },
    handler: async (args, ctx) => {
      const safeImagePath = asWorkspaceSafePath(args.image_path)
      const originalPrompt =
        typeof args.original_prompt === 'string' ? args.original_prompt.trim() : ''
      if (!safeImagePath || !originalPrompt) {
        return {
          kind: 'text',
          content: 'Error: image_path and original_prompt are required and must be safe.',
        }
      }

      const aspects = Array.isArray(args.check_aspects)
        ? args.check_aspects.filter((item): item is string => typeof item === 'string')
        : ['prompt_adherence', 'visual_artifacts', 'readability', 'style_consistency', 'composition']

      try {
        const imageBuffer = await readFile(join(WORKSPACE_DIR, safeImagePath))
        const base64 = imageBuffer.toString('base64')
        const mimeType = getImageMimeType(safeImagePath)

        const response = await ctx.openai.chat.completions.create(
          {
            model: ENV.openaiModel,
            temperature: 0.2,
            max_completion_tokens: 1_000,
            messages: [
              {
                role: 'system',
                content: 'You are an expert reviewer of technical diagrams. Be concise and concrete.',
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: [
                      `Original prompt: ${originalPrompt}`,
                      '',
                      `Check aspects: ${aspects.join(', ')}`,
                      '',
                      'Return:',
                      '1) Quality score (1-10)',
                      '2) Issues list',
                      '3) Whether regeneration is recommended',
                    ].join('\n'),
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${base64}`,
                    },
                  },
                ],
              },
            ],
          },
          ctx.abortSignal ? { signal: ctx.abortSignal } : undefined,
        )

        const analysisText = response.choices[0]?.message?.content ?? 'No analysis text returned.'
        return {
          kind: 'text',
          content: JSON.stringify(
            {
              success: true,
              image_path: safeImagePath,
              aspects_checked: aspects,
              analysis: analysisText,
            },
            null,
            2,
          ),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'text', content: `Error: image analysis failed (${message})` }
      }
    },
  },
]
