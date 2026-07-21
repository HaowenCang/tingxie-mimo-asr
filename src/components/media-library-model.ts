import type { MediaAsset, MediaFolder, MediaLibrarySnapshot, MediaTranscriptStatus, TranscriptSummary } from '../../electron/types'

export type MediaLibraryScope =
  | { kind: 'all' | 'unfiled' | 'history' }
  | { kind: 'folder'; folderId: string }
export type MediaLibraryStatusFilter = 'all' | MediaTranscriptStatus

export function folderIdFromScope(scope: MediaLibraryScope, folders: MediaFolder[]): string | undefined {
  if (scope.kind !== 'folder') return undefined
  return folders.some((folder) => folder.id === scope.folderId) ? scope.folderId : undefined
}

export type MediaLibraryRow =
  | { kind: 'asset'; id: string; asset: MediaAsset }
  | { kind: 'history'; id: string; transcript: TranscriptSummary }

export interface MediaFolderTreeNode {
  folder: MediaFolder
  depth: number
  path: string
  hasChildren: boolean
}

export function visibleMediaFolderTree(folders: MediaFolder[], expandedIds: Set<string>): MediaFolderTreeNode[] {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const childrenByParent = new Map<string | undefined, MediaFolder[]>()
  for (const folder of folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : undefined
    const children = childrenByParent.get(parentId) || []
    children.push(folder)
    childrenByParent.set(parentId, children)
  }
  const visible: MediaFolderTreeNode[] = []
  const visited = new Set<string>()
  function append(folder: MediaFolder, depth: number, parentPath: string) {
    if (visited.has(folder.id)) return
    visited.add(folder.id)
    const children = childrenByParent.get(folder.id) || []
    const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name
    visible.push({ folder, depth, path, hasChildren: children.length > 0 })
    if (expandedIds.has(folder.id)) children.forEach((child) => append(child, depth + 1, path))
  }
  for (const root of childrenByParent.get(undefined) || []) append(root, 0, '')
  return visible
}

export interface MediaLibraryDerivedIndex {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  assetById: Map<string, MediaAsset>
  transcriptById: Map<string, TranscriptSummary>
  linkedTranscriptIds: Set<string>
  unlinkedHistory: TranscriptSummary[]
  folderCounts: Map<string, number>
  folderDescendantIds: Map<string, Set<string>>
  unfiledCount: number
  assetSearchText: Map<string, string>
  historySearchText: Map<string, string>
}

export function buildMediaLibraryIndex(library: MediaLibrarySnapshot, history: TranscriptSummary[]): MediaLibraryDerivedIndex {
  const assetById = new Map<string, MediaAsset>()
  const transcriptById = new Map(history.map((item) => [item.id, item]))
  const linkedTranscriptIds = new Set<string>()
  const folderCounts = new Map<string, number>()
  const folderById = new Map(library.folders.map((folder) => [folder.id, folder]))
  const folderDescendantIds = new Map<string, Set<string>>(library.folders.map((folder) => [folder.id, new Set([folder.id])]))
  for (const folder of library.folders) {
    const visited = new Set<string>()
    let parentId = folder.parentId
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      folderDescendantIds.get(parentId)?.add(folder.id)
      parentId = folderById.get(parentId)?.parentId
    }
  }
  const assetSearchText = new Map<string, string>()
  const historySearchText = new Map<string, string>()
  let unfiledCount = 0

  for (const asset of library.assets) {
    assetById.set(asset.id, asset)
    if (asset.transcriptId) linkedTranscriptIds.add(asset.transcriptId)
    if (asset.folderId) {
      const visited = new Set<string>()
      let folderId: string | undefined = asset.folderId
      while (folderId && !visited.has(folderId)) {
        visited.add(folderId)
        folderCounts.set(folderId, (folderCounts.get(folderId) || 0) + 1)
        folderId = folderById.get(folderId)?.parentId
      }
    } else unfiledCount += 1
    assetSearchText.set(asset.id, `${asset.displayName}\0${asset.originalName}\0${asset.extension}`.toLocaleLowerCase())
  }
  for (const transcript of history) {
    historySearchText.set(transcript.id, `${transcript.fileName}\0${transcript.preview}`.toLocaleLowerCase())
  }

  return {
    library,
    history,
    assetById,
    transcriptById,
    linkedTranscriptIds,
    unlinkedHistory: history.filter((item) => !linkedTranscriptIds.has(item.id)),
    folderCounts,
    folderDescendantIds,
    unfiledCount,
    assetSearchText,
    historySearchText,
  }
}

function transcriptStatus(item: TranscriptSummary): MediaTranscriptStatus {
  if (item.outcome === 'failed') return 'failed'
  if (item.outcome === 'partial') return 'partial'
  return 'transcribed'
}

export function filterMediaLibraryRows(
  index: MediaLibraryDerivedIndex,
  scope: MediaLibraryScope,
  status: MediaLibraryStatusFilter,
  query: string,
): MediaLibraryRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const rows: MediaLibraryRow[] = []
  const folderScopeId = scope.kind === 'folder' ? scope.folderId : undefined

  if (scope.kind !== 'history') {
    for (const asset of index.library.assets) {
      const inScope = scope.kind === 'all'
        || (scope.kind === 'unfiled' ? !asset.folderId : Boolean(folderScopeId && asset.folderId && index.folderDescendantIds.get(folderScopeId)?.has(asset.folderId)))
      if (!inScope || (status !== 'all' && asset.transcriptStatus !== status)) continue
      if (normalizedQuery && !index.assetSearchText.get(asset.id)?.includes(normalizedQuery)) continue
      rows.push({ kind: 'asset', id: asset.id, asset })
    }
  }

  const history = scope.kind === 'history' ? index.history : scope.kind === 'all' ? index.unlinkedHistory : []
  for (const transcript of history) {
    if (status !== 'all' && transcriptStatus(transcript) !== status) continue
    if (normalizedQuery && !index.historySearchText.get(transcript.id)?.includes(normalizedQuery)) continue
    rows.push({ kind: 'history', id: transcript.id, transcript })
  }
  return rows
}
