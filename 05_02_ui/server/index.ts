import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StreamMode } from '../shared/chat'
import { streamLiveTurn } from './agent/run'
import { ConversationStore } from './conversation/store'
import { createMockStream } from './mock/index'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(SERVER_DIR, '..')
const DATA_DIR = path.join(PROJECT_DIR, '.data')
const DIST_CLIENT_DIR = path.join(PROJECT_DIR, 'dist', 'client')

const MIME_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
}

const conversationStore = new ConversationStore()

const sleep = (delayMs: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, delayMs)
  })

const mimeFor = (filePath: string): string =>
  MIME_TYPES[path.extname(filePath).slice(1)] ?? 'application/octet-stream'

const sendJson = (res: ServerResponse, statusCode: number, value: unknown): void => {
  const body = JSON.stringify(value)
  res.writeHead(statusCode, {
    'content-type': MIME_TYPES.json,
    'content-length': Buffer.byteLength(body).toString(),
  })
  res.end(body)
}

const sendText = (res: ServerResponse, statusCode: number, body: string): void => {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
  })
  res.end(body)
}

const safeResolve = (baseDir: string, requestedPath: string): string | null => {
  const resolvedBase = path.resolve(baseDir)
  const resolvedPath = path.resolve(resolvedBase, requestedPath)

  if (resolvedPath === resolvedBase || resolvedPath.startsWith(`${resolvedBase}${path.sep}`)) {
    return resolvedPath
  }

  return null
}

const serveFile = async (res: ServerResponse, filePath: string): Promise<void> => {
  try {
    const content = await readFile(filePath)
    res.writeHead(200, {
      'content-type': mimeFor(filePath),
      'content-length': content.byteLength.toString(),
    })
    res.end(content)
  } catch {
    sendText(res, 404, 'Not found')
  }
}

const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw || '{}') as T
}

const handleConversation = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { searchParams } = new URL(req.url ?? '/', 'http://localhost')
  const mode = conversationStore.parseStreamMode(searchParams.get('mode'))
  const historyCount = conversationStore.normalizeHistoryCount(Number(searchParams.get('history') ?? '480'))
  conversationStore.ensureMatchesRequest(historyCount, mode)
  sendJson(res, 200, conversationStore.snapshot)
}

const handleReset = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (conversationStore.activeStream) {
    sendJson(res, 409, { error: 'Cannot reset while a stream is active.' })
    return
  }

  const body = await readJsonBody<{ historyCount?: number; mode?: StreamMode }>(req)
  const mode = conversationStore.parseStreamMode(body.mode)
  const historyCount = conversationStore.normalizeHistoryCount(body.historyCount)
  const snapshot = await conversationStore.reset(DATA_DIR, historyCount, mode)
  sendJson(res, 200, snapshot)
}

const handleArtifacts = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const relativePath = decodeURIComponent(pathname.slice('/api/artifacts/'.length))
  const filePath = safeResolve(DATA_DIR, relativePath)

  if (!filePath) {
    sendText(res, 404, 'Not found')
    return
  }

  await serveFile(res, filePath)
}

const handleChat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (conversationStore.activeStream) {
    sendJson(res, 409, { error: 'Only one active stream is supported in this demo server.' })
    return
  }

  const body = await readJsonBody<{ prompt?: string; userMessageId?: string; mode?: StreamMode }>(req)
  const prompt = body.prompt?.trim()
  const mode = conversationStore.parseStreamMode(body.mode)

  if (!prompt) {
    sendJson(res, 400, { error: 'Prompt is required.' })
    return
  }

  conversationStore.switchMode(mode)
  const { assistantMessage, startSeq } = conversationStore.createTurn(prompt, body.userMessageId)
  conversationStore.startStream()

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  res.flushHeaders()

  let closed = false
  const close = () => {
    closed = true
  }

  req.on('aborted', close)
  req.on('close', close)
  res.on('close', close)

  try {
    if (mode === 'live') {
      const stream = streamLiveTurn({
        assistantMessageId: assistantMessage.id,
        conversation: conversationStore.snapshotWithoutLatestAssistant(),
        startSeq,
        dataDir: DATA_DIR,
      })

      for await (const event of stream) {
        if (closed) {
          break
        }

        conversationStore.appendAssistantEvent(assistantMessage, event)
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    } else {
      const built = createMockStream({
        assistantMessageId: assistantMessage.id,
        prompt,
        startSeq,
        dataDir: DATA_DIR,
      })

      for (const step of built.steps) {
        if (closed) {
          break
        }

        if (step.delayMs > 0) {
          await sleep(step.delayMs)
        }

        if (step.sideEffect) {
          await step.sideEffect()
        }

        conversationStore.appendAssistantEvent(assistantMessage, step.event)
        res.write(`data: ${JSON.stringify(step.event)}\n\n`)
      }
    }

    if (closed && assistantMessage.status === 'streaming') {
      conversationStore.appendAssistantEvent(
        assistantMessage,
        conversationStore.createCancelledEvent(assistantMessage.id),
      )
    }

    res.end()
  } finally {
    conversationStore.endStream()
  }
}

const handleStaticRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')

  if (!existsSync(DIST_CLIENT_DIR)) {
    sendText(res, 404, 'Frontend assets are not built. Run "bun run dev" or "bun run build".')
    return
  }

  if (pathname === '/') {
    await serveFile(res, path.join(DIST_CLIENT_DIR, 'index.html'))
    return
  }

  const requestedPath = safeResolve(DIST_CLIENT_DIR, pathname.slice(1))
  if (requestedPath && existsSync(requestedPath)) {
    await serveFile(res, requestedPath)
    return
  }

  await serveFile(res, path.join(DIST_CLIENT_DIR, 'index.html'))
}

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, activeStream: conversationStore.activeStream })
    return
  }

  if (req.method === 'GET' && pathname === '/api/conversation') {
    await handleConversation(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    await handleReset(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    await handleChat(req, res)
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/api/artifacts/')) {
    await handleArtifacts(req, res)
    return
  }

  await handleStaticRequest(req, res)
}

const main = async () => {
  await mkdir(DATA_DIR, { recursive: true })

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch(error => {
      console.error('[05_02_ui] request failed', error)

      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : 'Internal server error',
        })
        return
      }

      res.end()
    })
  })

  const port = Number(process.env.PORT ?? '3300')

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }

    const onListening = () => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port)
  })

  console.log(`[05_02_ui] server listening on http://localhost:${port}`)
}

void main()
