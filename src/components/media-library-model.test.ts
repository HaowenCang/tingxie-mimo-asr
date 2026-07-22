import { describe, expect, it } from 'vitest'
import type { MediaAsset, MediaLibrarySnapshot, TranscriptSummary } from '../../electron/types'
import { buildMediaLibraryIndex, filterMediaLibraryRows, folderIdFromScope, visibleMediaFolderTree } from './media-library-model'

function asset(index: number, folderId?: string): MediaAsset {
  return {
    id: `asset-${index}`,
    displayName: `Recording ${index}.m4a`,
    originalName: `Recording ${index}.m4a`,
    relativePath: `media/asset-${index}.m4a`,
    size: 1024 + index,
    extension: 'M4A',
    ...(folderId ? { folderId } : {}),
    transcriptStatus: index % 2 ? 'transcribed' : 'untranscribed',
    managed: true,
    importedAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  }
}

function summary(index: number, folderId?: string): TranscriptSummary {
  return {
    id: `transcript-${index}`,
    ...(folderId ? { folderId } : {}),
    fileName: `Legacy ${index}.wav`,
    createdAt: '2026-07-19T00:00:00.000Z',
    duration: 60,
    segmentCount: 3,
    sourceAvailable: false,
    preview: `Preview ${index}`,
    analysisStatus: 'none',
  }
}

describe('media library derived index', () => {
  it('only turns a real folder scope into a parent id', () => {
    const folders = [{ id: 'folder-1', name: '项目', createdAt: 'now', updatedAt: 'now' }]

    expect(folderIdFromScope({ kind: 'unfiled' }, folders)).toBeUndefined()
    expect(folderIdFromScope({ kind: 'all' }, folders)).toBeUndefined()
    expect(folderIdFromScope({ kind: 'folder', folderId: 'folder-1' }, folders)).toBe('folder-1')
    expect(folderIdFromScope({ kind: 'folder', folderId: 'stale-folder' }, folders)).toBeUndefined()
  })

  it('builds folder counts and id maps in one reusable pass for 10,000 assets', () => {
    const library: MediaLibrarySnapshot = {
      rootPath: 'D:/library',
      folders: Array.from({ length: 100 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}`, createdAt: 'now', updatedAt: 'now' })),
      assets: Array.from({ length: 10_000 }, (_, index) => asset(index, index % 10 === 0 ? undefined : `folder-${index % 100}`)),
    }
    const history = Array.from({ length: 50 }, (_, index) => summary(index))

    const index = buildMediaLibraryIndex(library, history)

    expect(index.assetById.size).toBe(10_000)
    expect(index.unfiledCount).toBe(1_050)
    expect([...index.folderCounts.values()].reduce((total, count) => total + count, 0)).toBe(9_000)
    expect(index.unlinkedHistory).toHaveLength(50)
  })

  it('searches asset names and legacy summaries without scanning transcript bodies', () => {
    const library: MediaLibrarySnapshot = { rootPath: 'D:/library', folders: [], assets: [asset(1), asset(2)] }
    const history = [summary(1)]
    const index = buildMediaLibraryIndex(library, history)

    expect(filterMediaLibraryRows(index, { kind: 'all' }, 'all', 'recording 2').map((row) => row.id)).toEqual(['asset-2'])
    expect(filterMediaLibraryRows(index, { kind: 'history' }, 'all', 'preview 1').map((row) => row.id)).toEqual(['transcript-1'])
  })

  it('flattens expanded nested folders with stable depth and breadcrumb paths', () => {
    const folders = [
      { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' },
      { id: 'child', name: 'Child', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child', createdAt: 'now', updatedAt: 'now' },
      { id: 'other', name: 'Other', createdAt: 'now', updatedAt: 'now' },
    ]

    expect(visibleMediaFolderTree(folders, new Set(['parent', 'child'])).map((node) => [node.folder.id, node.depth, node.path])).toEqual([
      ['parent', 0, 'Parent'],
      ['child', 1, 'Parent / Child'],
      ['grandchild', 2, 'Parent / Child / Grandchild'],
      ['other', 0, 'Other'],
    ])
    expect(visibleMediaFolderTree(folders, new Set()).map((node) => node.folder.id)).toEqual(['parent', 'other'])
  })

  it('includes descendant media in parent folder counts', () => {
    const library: MediaLibrarySnapshot = {
      rootPath: 'D:/library',
      folders: [
        { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'child', name: 'Child', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
      ],
      assets: [asset(1, 'parent'), asset(2, 'child')],
    }

    const index = buildMediaLibraryIndex(library, [])
    expect(index.folderCounts.get('parent')).toBe(2)
    expect(index.folderCounts.get('child')).toBe(1)
    expect(filterMediaLibraryRows(index, { kind: 'folder', folderId: 'parent' }, 'all', '').map((row) => row.id)).toEqual(['asset-1', 'asset-2'])
  })

  it('treats text-only transcripts as movable library items in folders and unfiled', () => {
    const library: MediaLibrarySnapshot = {
      rootPath: 'D:/library',
      folders: [
        { id: 'parent', name: 'Parent', createdAt: 'now', updatedAt: 'now' },
        { id: 'child', name: 'Child', parentId: 'parent', createdAt: 'now', updatedAt: 'now' },
      ],
      assets: [],
    }
    const index = buildMediaLibraryIndex(library, [summary(1, 'child'), summary(2)])

    expect(index.folderCounts.get('parent')).toBe(1)
    expect(index.folderCounts.get('child')).toBe(1)
    expect(index.unfiledCount).toBe(1)
    expect(filterMediaLibraryRows(index, { kind: 'folder', folderId: 'parent' }, 'all', '').map((row) => row.id)).toEqual(['transcript-1'])
    expect(filterMediaLibraryRows(index, { kind: 'unfiled' }, 'all', '').map((row) => row.id)).toEqual(['transcript-2'])
  })
})
