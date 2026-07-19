import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMediaFolder, importMediaAssets, moveMediaAssets, renameMediaAsset, type MediaLibraryIndex } from './media-library'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('managed media library', () => {
  it('copies an imported recording into managed storage before returning it', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'tingxie-library-test-'))
    tempDirs.push(temp)
    const source = path.join(temp, '过往录音.m4a')
    const root = path.join(temp, 'library')
    await writeFile(source, Buffer.from('original audio bytes'))
    const initial: MediaLibraryIndex = { version: 1, folders: [], assets: [] }

    const result = await importMediaAssets({
      index: initial,
      libraryRoot: root,
      sources: [{ path: source, name: '过往录音.m4a', size: 20 }],
      createId: () => 'asset-1',
      now: () => '2026-07-18T12:00:00.000Z',
    })

    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({
      id: 'asset-1',
      displayName: '过往录音.m4a',
      relativePath: path.join('media', 'asset-1.m4a'),
      managed: true,
    })
    await rm(source)
    expect(await readFile(path.join(root, result.imported[0].relativePath), 'utf8')).toBe('original audio bytes')
  })

  it('groups, renames and batch-moves recordings without changing their managed paths', () => {
    const initial: MediaLibraryIndex = {
      version: 1,
      folders: [],
      assets: [
        { id: 'a', displayName: 'A.m4a', originalName: 'A.m4a', relativePath: 'media/a.m4a', size: 1, extension: 'M4A', transcriptStatus: 'untranscribed', managed: true, importedAt: 'now', updatedAt: 'now' },
        { id: 'b', displayName: 'B.m4a', originalName: 'B.m4a', relativePath: 'media/b.m4a', size: 1, extension: 'M4A', transcriptStatus: 'untranscribed', managed: true, importedAt: 'now', updatedAt: 'now' },
      ],
    }
    const withFolder = createMediaFolder(initial, { id: 'meetings', name: '会议', createdAt: 'now', updatedAt: 'now' })
    const renamed = renameMediaAsset(withFolder, 'a', '项目周会', 'later')
    const moved = moveMediaAssets(renamed, ['a', 'b'], 'meetings', 'later')

    expect(moved.assets.map((asset) => [asset.displayName, asset.folderId, asset.relativePath])).toEqual([
      ['项目周会', 'meetings', 'media/a.m4a'],
      ['B.m4a', 'meetings', 'media/b.m4a'],
    ])
  })

  it('deduplicates a large import batch by a stable source signature', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'tingxie-library-dedupe-'))
    tempDirs.push(temp)
    const source = path.join(temp, 'same.m4a')
    await writeFile(source, Buffer.from('same bytes'))
    const existing: MediaLibraryIndex = {
      version: 1,
      folders: [],
      assets: [{
        id: 'existing', displayName: 'same.m4a', originalName: 'same.m4a', relativePath: 'media/existing.m4a', size: 10,
        extension: 'M4A', transcriptStatus: 'untranscribed', managed: true, importedAt: 'now', updatedAt: 'now', originalPath: source,
      }],
    }

    const result = await importMediaAssets({
      index: existing,
      libraryRoot: path.join(temp, 'library'),
      sources: Array.from({ length: 2_000 }, () => ({ path: source, name: 'same.m4a', size: 10 })),
      createId: () => 'should-not-run',
      now: () => 'now',
    })

    expect(result.imported).toHaveLength(0)
    expect(result.duplicates).toHaveLength(2_000)
  })

  it('reports bounded-copy progress through completion', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'tingxie-library-progress-'))
    tempDirs.push(temp)
    const sources = await Promise.all(['a.m4a', 'b.m4a'].map(async (name) => {
      const file = path.join(temp, name)
      await writeFile(file, Buffer.from(name))
      return { path: file, name, size: Buffer.byteLength(name) }
    }))
    const progress: Array<[number, number]> = []
    let id = 0

    const result = await importMediaAssets({
      index: { version: 1, folders: [], assets: [] },
      libraryRoot: path.join(temp, 'library'),
      sources,
      createId: () => `asset-${id++}`,
      now: () => 'now',
      copyConcurrency: 1,
      onCopyProgress: (completed, total) => progress.push([completed, total]),
    })

    expect(result.imported).toHaveLength(2)
    expect(progress.at(0)).toEqual([0, 2])
    expect(progress.at(-1)).toEqual([2, 2])
  })
})
