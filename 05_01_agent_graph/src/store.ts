import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export class FileStore<T extends { id: string }> {
  private items: T[] = []
  private filePath: string
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(name: string, dataDir: string) {
    this.filePath = join(dataDir, `${name}.json`)
  }

  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    this.loadPromise ??= this.doLoad()
    return this.loadPromise
  }

  private async doLoad(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.items = []
        this.loaded = true
        return
      }
      throw err
    }

    try {
      this.items = JSON.parse(raw)
    } catch {
      throw new Error(`Corrupted store file: ${this.filePath}`)
    }
    this.loaded = true
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(this.items, null, 2))
    })
    return this.writeQueue
  }

  async add(item: T): Promise<T> {
    await this.ensureLoaded()
    this.items.push(item)
    await this.persist()
    return item
  }

  async update(id: string, patch: Partial<T>): Promise<T | undefined> {
    await this.ensureLoaded()
    const idx = this.items.findIndex(i => i.id === id)
    if (idx === -1) return undefined
    this.items[idx] = { ...this.items[idx], ...patch }
    await this.persist()
    return this.items[idx]
  }

  async getById(id: string): Promise<T | undefined> {
    await this.ensureLoaded()
    return this.items.find(i => i.id === id)
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    await this.ensureLoaded()
    return this.items.filter(predicate)
  }

  async all(): Promise<T[]> {
    await this.ensureLoaded()
    return [...this.items]
  }
}
