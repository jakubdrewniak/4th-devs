import { TextDecoder } from 'node:util'

import type { AiMessage } from '../../domain/ai/types'
import { createFileRepository, type FileRecord } from '../../domain/files/file-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import type { FileId, RunId, SessionMessageId } from '../../shared/ids'
import { ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'

export interface VisibleFileContextEntry {
  dataUrl: string | null
  fileId: FileId
  messageId: SessionMessageId | null
  mimeType: string | null
  originalFilename: string | null
  textContent: string | null
}

const textDecoder = new TextDecoder()

const isTextLikeMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) {
    return false
  }

  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  )
}

const toTextContent = (text: string) => ({
  text,
  type: 'text' as const,
})

const toInlineText = (file: FileRecord, body: Uint8Array, maxBytes: number): string => {
  const sliced = body.byteLength > maxBytes ? body.slice(0, maxBytes) : body
  const suffix = body.byteLength > maxBytes ? '\n\n[truncated]' : ''
  const label = file.originalFilename ?? file.id

  return `Attached file: ${label}\nMIME: ${file.mimeType ?? 'unknown'}\n\n${textDecoder.decode(sliced)}${suffix}`
}

const toMetadataOnlyText = (file: FileRecord): string => {
  const parts = [
    `Attached file: ${file.originalFilename ?? file.id}`,
    `MIME: ${file.mimeType ?? 'unknown'}`,
  ]

  if (typeof file.sizeBytes === 'number') {
    parts.push(`Bytes: ${file.sizeBytes}`)
  }

  return parts.join('\n')
}

interface LoadedVisibleFile {
  file: FileRecord
  messageId: SessionMessageId | null
}

const loadEntry = async (
  context: CommandContext,
  linkedFile: LoadedVisibleFile,
): Promise<VisibleFileContextEntry> => {
  if (!linkedFile.file.mimeType) {
    return {
      dataUrl: null,
      fileId: linkedFile.file.id,
      messageId: linkedFile.messageId,
      mimeType: linkedFile.file.mimeType,
      originalFilename: linkedFile.file.originalFilename,
      textContent: toMetadataOnlyText(linkedFile.file),
    }
  }

  const blobResult = await context.services.files.blobStore.get(linkedFile.file.storageKey)

  if (!blobResult.ok) {
    return {
      dataUrl: null,
      fileId: linkedFile.file.id,
      messageId: linkedFile.messageId,
      mimeType: linkedFile.file.mimeType,
      originalFilename: linkedFile.file.originalFilename,
      textContent: toMetadataOnlyText(linkedFile.file),
    }
  }

  if (linkedFile.file.mimeType.startsWith('image/')) {
    return {
      dataUrl: `data:${linkedFile.file.mimeType};base64,${Buffer.from(blobResult.value.body).toString('base64')}`,
      fileId: linkedFile.file.id,
      messageId: linkedFile.messageId,
      mimeType: linkedFile.file.mimeType,
      originalFilename: linkedFile.file.originalFilename,
      textContent: null,
    }
  }

  if (isTextLikeMimeType(linkedFile.file.mimeType)) {
    return {
      dataUrl: null,
      fileId: linkedFile.file.id,
      messageId: linkedFile.messageId,
      mimeType: linkedFile.file.mimeType,
      originalFilename: linkedFile.file.originalFilename,
      textContent: toInlineText(
        linkedFile.file,
        blobResult.value.body,
        context.config.files.inlineTextBytes,
      ),
    }
  }

  return {
    dataUrl: null,
    fileId: linkedFile.file.id,
    messageId: linkedFile.messageId,
    mimeType: linkedFile.file.mimeType,
    originalFilename: linkedFile.file.originalFilename,
    textContent: toMetadataOnlyText(linkedFile.file),
  }
}

export const loadVisibleFileContext = async (
  context: CommandContext,
  visibleMessages: SessionMessageRecord[],
  runId: RunId,
): Promise<CommandResult<VisibleFileContextEntry[]>> => {
  const messageIds = visibleMessages.map((message) => message.id)
  const fileRepository = createFileRepository(context.db)
  const linkedFiles = fileRepository.listByMessageIds(context.tenantScope, messageIds)

  if (!linkedFiles.ok) {
    return linkedFiles
  }

  const runLinkedFiles = fileRepository.listByRunId(context.tenantScope, runId)

  if (!runLinkedFiles.ok) {
    return runLinkedFiles
  }

  const loadedFilesById = new Map<FileId, LoadedVisibleFile>()

  for (const linkedFile of runLinkedFiles.value) {
    loadedFilesById.set(linkedFile.id, {
      file: linkedFile,
      messageId: null,
    })
  }

  for (const linkedFile of linkedFiles.value) {
    loadedFilesById.set(linkedFile.file.id, {
      file: linkedFile.file,
      messageId: linkedFile.messageId,
    })
  }

  const entries = await Promise.all(
    [...loadedFilesById.values()].map((linkedFile) => loadEntry(context, linkedFile)),
  )

  return ok(entries)
}

const resolveFileLabel = (entry: VisibleFileContextEntry): string =>
  entry.originalFilename ?? entry.fileId

export const toFileContextMessages = (
  entries: VisibleFileContextEntry[],
  provider: 'openai' | 'google' | null,
  skipFileIds: ReadonlySet<FileId> = new Set<FileId>(),
): AiMessage[] =>
  entries
    .filter((entry) => !skipFileIds.has(entry.fileId))
    .map((entry) => {
      if (entry.dataUrl && provider === 'openai' && entry.mimeType?.startsWith('image/')) {
        return {
          content: [
            toTextContent(`Attached image: ${resolveFileLabel(entry)}`),
            {
              mimeType: entry.mimeType,
              type: 'image_url' as const,
              url: entry.dataUrl,
            },
          ],
          role: 'user' as const,
        }
      }

      return {
        content: [
          toTextContent(
            entry.textContent ??
              `Attached file: ${resolveFileLabel(entry)}\nMIME: ${entry.mimeType ?? 'unknown'}`,
          ),
        ],
        role: 'user' as const,
      }
    })
