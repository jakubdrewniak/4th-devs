import { replay, subscribe } from './events.js'
import type { Runtime } from './runtime.js'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(MODULE_DIR, '..')
const DIST_DASHBOARD_DIR = path.join(MODULE_DIR, 'dashboard')
const SRC_DASHBOARD_DIR = path.join(PROJECT_DIR, 'src', 'dashboard')
const DASHBOARD_DIR = existsSync(DIST_DASHBOARD_DIR) ? DIST_DASHBOARD_DIR : SRC_DASHBOARD_DIR
const VENDOR_FILES: Record<string, string> = {
  '/vendor/cytoscape.min.js': path.join(PROJECT_DIR, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
  '/vendor/elk.bundled.js': path.join(PROJECT_DIR, 'node_modules', 'elkjs', 'lib', 'elk.bundled.js'),
  '/vendor/cytoscape-elk.js': path.join(PROJECT_DIR, 'node_modules', 'cytoscape-elk', 'dist', 'cytoscape-elk.js'),
}

const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
}

const mimeFor = (filePath: string): string =>
  MIME_TYPES[filePath.split('.').pop() ?? ''] ?? 'application/octet-stream'

const sendJson = (res: ServerResponse, statusCode: number, data: unknown): void => {
  const body = JSON.stringify(data)
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

async function serveFile(
  res: ServerResponse,
  baseDir: string,
  requestedPath: string,
): Promise<void> {
  const filePath = safeResolve(baseDir, requestedPath)
  if (!filePath) {
    sendText(res, 404, 'Not found')
    return
  }

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

function sseHandler(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  })
  res.flushHeaders()
  res.write(': connected\n\n')

  for (const past of replay()) {
    res.write(`data: ${JSON.stringify(past)}\n\n`)
  }

  const unsubscribe = subscribe(event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    unsubscribe()
  }

  req.on('close', cleanup)
  req.on('aborted', cleanup)
  res.on('close', cleanup)
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')

  if (pathname === '/') {
    await serveFile(res, DASHBOARD_DIR, 'index.html')
    return
  }

  if (pathname.startsWith('/dashboard/')) {
    const file = pathname.slice('/dashboard/'.length)
    await serveFile(res, DASHBOARD_DIR, file)
    return
  }

  if (pathname in VENDOR_FILES) {
    const file = VENDOR_FILES[pathname]
    await serveFile(res, path.dirname(file), path.basename(file))
    return
  }

  if (pathname === '/events') {
    sseHandler(req, res)
    return
  }

  if (pathname === '/api/state') {
    sendJson(res, 200, await getState(rt))
    return
  }

  if (pathname.startsWith('/api/artifact/')) {
    const artPath = decodeURIComponent(pathname.slice('/api/artifact/'.length))
    const filePath = safeResolve(path.join(rt.dataDir, 'files'), artPath)

    if (!filePath) {
      sendJson(res, 404, { path: artPath, content: null, error: 'Not found' })
      return
    }

    try {
      const content = await readFile(filePath, 'utf8')
      sendJson(res, 200, { path: artPath, content })
    } catch {
      sendJson(res, 404, { path: artPath, content: null, error: 'Not found' })
    }
    return
  }

  sendText(res, 404, 'Not found')
}

export async function startServer(rt: Runtime, port = 3300): Promise<{ url: string }> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, rt).catch(error => {
      console.error('[ui] request failed', error)
      if (!res.headersSent) {
        sendText(res, 500, 'Internal server error')
        return
      }
      res.end()
    })
  })

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

  const address = server.address()
  const resolvedPort = typeof address === 'object' && address ? address.port : port
  const url = `http://localhost:${resolvedPort}`
  console.log(`[ui] dashboard at ${url}`)
  return { url }
}

async function getState(rt: Runtime) {
  const [sessions, actors, tasks, items, artifacts, relations] = await Promise.all([
    rt.sessions.all(), rt.actors.all(), rt.tasks.all(),
    rt.items.all(), rt.artifacts.all(), rt.relations.all(),
  ])

  return { sessions, actors, tasks, items, artifacts, relations }
}
