import { apiFetch } from './backend'

const AUTHENTICATED_FILE_PATH_PREFIX = '/v1/files/'

const isAbsoluteHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value)

const readPathname = (value: string): string | null => {
  if (!value.trim()) {
    return null
  }

  if (value.startsWith('/')) {
    return value
  }

  if (!isAbsoluteHttpUrl(value) || typeof window === 'undefined') {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.origin === window.location.origin ? parsed.pathname : null
  } catch {
    return null
  }
}

export const isAuthenticatedAssetUrl = (value: string | null | undefined): boolean => {
  const pathname = value ? readPathname(value) : null
  return pathname?.startsWith(AUTHENTICATED_FILE_PATH_PREFIX) ?? false
}

export const fetchAuthenticatedAssetObjectUrl = async (
  assetUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await apiFetch(assetUrl, { signal })

  if (!response.ok) {
    throw new Error(`Failed to load asset: ${response.status}`)
  }

  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export interface ResolvedImageDisplayUrl {
  displayUrl: string
  dispose: () => void
}

interface BlobCacheEntry {
  objectUrl: string
  refCount: number
  pending?: Promise<string>
}

const GRACE_MS = 2_000
const blobCache = new Map<string, BlobCacheEntry>()

const releaseCacheEntry = (src: string, entry: BlobCacheEntry) => {
  entry.refCount -= 1
  if (entry.refCount > 0) return
  setTimeout(() => {
    if (entry.refCount <= 0 && blobCache.get(src) === entry) {
      blobCache.delete(src)
      URL.revokeObjectURL(entry.objectUrl)
    }
  }, GRACE_MS)
}

/** Synchronously returns a cached blob URL for `src`, or `null` if not cached. */
export const peekCachedDisplayUrl = (src: string): string | null => {
  const entry = blobCache.get(src)
  return entry?.objectUrl || null
}

/** Resolves a URL for display in `<img src>`; authenticated `/v1/files/` URLs are fetched and turned into object URLs. */
export const resolveImageDisplayUrl = async (
  src: string,
  signal?: AbortSignal,
): Promise<ResolvedImageDisplayUrl> => {
  if (!isAuthenticatedAssetUrl(src)) {
    return { displayUrl: src, dispose: () => undefined }
  }

  const cached = blobCache.get(src)

  if (cached?.objectUrl) {
    cached.refCount += 1
    return { displayUrl: cached.objectUrl, dispose: () => releaseCacheEntry(src, cached) }
  }

  if (cached?.pending) {
    const objectUrl = await cached.pending
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    cached.refCount += 1
    return { displayUrl: objectUrl, dispose: () => releaseCacheEntry(src, cached) }
  }

  const entry: BlobCacheEntry = { objectUrl: '', refCount: 0 }
  entry.pending = fetchAuthenticatedAssetObjectUrl(src, signal)
  blobCache.set(src, entry)

  try {
    const objectUrl = await entry.pending
    entry.objectUrl = objectUrl
    entry.pending = undefined
    entry.refCount += 1
    return { displayUrl: objectUrl, dispose: () => releaseCacheEntry(src, entry) }
  } catch (error) {
    entry.pending = undefined
    if (entry.refCount <= 0) blobCache.delete(src)
    throw error
  }
}
