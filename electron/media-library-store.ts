import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MediaLibraryIndex } from './media-library'

const EMPTY_LIBRARY: MediaLibraryIndex = { version: 1, folders: [], assets: [] }

export interface MediaLibraryStoreOptions {
  onDiskRead?(): void
}

export class MediaLibraryStore {
  private cachedRoot: string | undefined
  private cachedIndex: MediaLibraryIndex | undefined

  constructor(private readonly options: MediaLibraryStoreOptions = {}) {}

  async read(libraryRoot: string): Promise<MediaLibraryIndex> {
    const root = path.resolve(libraryRoot)
    if (this.cachedRoot === root && this.cachedIndex) return this.cachedIndex
    this.options.onDiskRead?.()
    const file = path.join(root, 'index.json')
    let index: MediaLibraryIndex
    try {
      index = JSON.parse(await fs.readFile(file, 'utf8')) as MediaLibraryIndex
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      index = EMPTY_LIBRARY
    }
    this.cachedRoot = root
    this.cachedIndex = index
    return index
  }

  async write(libraryRoot: string, index: MediaLibraryIndex): Promise<void> {
    const root = path.resolve(libraryRoot)
    const file = path.join(root, 'index.json')
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    await fs.mkdir(root, { recursive: true })
    try {
      await fs.writeFile(temporary, JSON.stringify(index, null, 2), 'utf8')
      await fs.rename(temporary, file)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    this.cachedRoot = root
    this.cachedIndex = index
  }

  invalidate(): void {
    this.cachedRoot = undefined
    this.cachedIndex = undefined
  }
}
