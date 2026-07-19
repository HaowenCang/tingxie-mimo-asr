import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaLibraryStore } from './media-library-store'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('media library index store', () => {
  it('caches reads, writes through atomically and invalidates when the root changes', async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'tingxie-media-store-a-'))
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'tingxie-media-store-b-'))
    tempDirs.push(firstRoot, secondRoot)
    let reads = 0
    const store = new MediaLibraryStore({ onDiskRead: () => { reads += 1 } })

    expect((await store.read(firstRoot)).assets).toHaveLength(0)
    expect((await store.read(firstRoot)).assets).toHaveLength(0)
    expect(reads).toBe(1)

    const next = { version: 1 as const, folders: [], assets: [] }
    await store.write(firstRoot, next)
    expect(JSON.parse(await readFile(path.join(firstRoot, 'index.json'), 'utf8'))).toEqual(next)
    expect(await store.read(firstRoot)).toBe(next)
    const replacement = { version: 1 as const, folders: [{ id: 'folder', name: 'Folder', createdAt: 'now', updatedAt: 'now' }], assets: [] }
    await store.write(firstRoot, replacement)
    expect(JSON.parse(await readFile(path.join(firstRoot, 'index.json'), 'utf8'))).toEqual(replacement)
    expect(await store.read(firstRoot)).toBe(replacement)

    await store.read(secondRoot)
    expect(reads).toBe(2)
    store.invalidate()
    await store.read(secondRoot)
    expect(reads).toBe(3)
  })
})
