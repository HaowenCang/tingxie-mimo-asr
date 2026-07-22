import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMediaFolder, deleteMediaFolder, importMediaAssets, moveMediaAssets, moveMediaFolder, normalizeMediaFolderParentId, renameMediaAsset, type MediaLibraryIndex } from './media-library'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('managed media library', () => {
  it('treats only known legacy root sentinels as the root folder', () => {
    expect(normalizeMediaFolderParentId(undefined)).toBeUndefined()
    expect(normalizeMediaFolderParentId('')).toBeUndefined()
    expect(normalizeMediaFolderParentId('__root')).toBeUndefined()
    expect(normalizeMediaFolderParentId('unfiled')).toBeUndefined()
    expect(normalizeMediaFolderParentId('folder-1')).toBe('folder-1')
  })

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

  it('supports nested folders while preventing a folder from moving into its own descendant', () => {
    const initial: MediaLibraryIndex = { version: 1, folders: [], assets: [] }
    const parent = createMediaFolder(initial, { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' })
    const nested = createMediaFolder(parent, { id: 'child', name: 'Child', parentId: 'parent', createdAt: 'now', updatedAt: 'now' })

    expect(() => moveMediaFolder(nested, 'parent', 'child', 'later')).toThrow(/后代|descendant/i)
    expect(moveMediaFolder(nested, 'child', undefined, 'later').folders.find((folder) => folder.id === 'child')?.parentId).toBeUndefined()
  })

  it('deletes a folder safely by moving its direct contents to the parent', () => {
    const index: MediaLibraryIndex = {
      version: 1,
      folders: [
        { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'deleted', name: 'Deleted', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'child', name: 'Child', parentId: 'deleted', createdAt: 'now', updatedAt: 'now' },
      ],
      assets: [{
        id: 'asset', displayName: 'Audio.m4a', originalName: 'Audio.m4a', relativePath: 'media/asset.m4a', size: 1,
        extension: 'M4A', folderId: 'deleted', transcriptStatus: 'transcribed', managed: true, importedAt: 'now', updatedAt: 'now',
      }],
    }

    const result = deleteMediaFolder(index, 'deleted', 'preserve-content', 'later')

    expect(result.deletedAssets).toEqual([])
    expect(result.removedFolderIds).toEqual(['deleted'])
    expect(result.contentDestinationFolderId).toBe('parent')
    expect(result.index.folders.map((folder) => [folder.id, folder.parentId])).toEqual([
      ['parent', undefined],
      ['child', 'parent'],
    ])
    expect(result.index.assets[0].folderId).toBe('parent')
  })

  it('refuses a preserve-content delete that would create duplicate sibling names', () => {
    const index: MediaLibraryIndex = {
      version: 1,
      folders: [
        { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'target', name: 'Target', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'existing', name: 'Archive', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'child', name: 'Archive', parentId: 'target', createdAt: 'now', updatedAt: 'now' },
      ],
      assets: [],
    }

    expect(() => deleteMediaFolder(index, 'target', 'preserve-content', 'later')).toThrow('同名')
  })

  it('recursively removes descendant folders and returns their media for explicit deletion', () => {
    const index: MediaLibraryIndex = {
      version: 1,
      folders: [
        { id: 'kept', name: 'Kept', createdAt: 'now', updatedAt: 'now' },
        { id: 'deleted', name: 'Deleted', createdAt: 'now', updatedAt: 'now' },
        { id: 'child', name: 'Child', parentId: 'deleted', createdAt: 'now', updatedAt: 'now' },
      ],
      assets: [
        { id: 'kept-asset', displayName: 'Kept.m4a', originalName: 'Kept.m4a', relativePath: 'media/kept.m4a', size: 1, extension: 'M4A', folderId: 'kept', transcriptStatus: 'transcribed', managed: true, importedAt: 'now', updatedAt: 'now' },
        { id: 'deleted-asset', displayName: 'Deleted.m4a', originalName: 'Deleted.m4a', relativePath: 'media/deleted.m4a', size: 1, extension: 'M4A', folderId: 'child', transcriptStatus: 'transcribed', managed: true, importedAt: 'now', updatedAt: 'now' },
      ],
    }

    const result = deleteMediaFolder(index, 'deleted', 'delete-media', 'later')

    expect(result.index.folders.map((folder) => folder.id)).toEqual(['kept'])
    expect(result.index.assets.map((asset) => asset.id)).toEqual(['kept-asset'])
    expect(result.deletedAssets.map((asset) => asset.id)).toEqual(['deleted-asset'])
    expect(new Set(result.removedFolderIds)).toEqual(new Set(['deleted', 'child']))
    expect(result.contentDestinationFolderId).toBeUndefined()
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
