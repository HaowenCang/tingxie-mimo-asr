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
})
