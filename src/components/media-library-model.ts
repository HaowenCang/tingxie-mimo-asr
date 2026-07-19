import type { MediaAsset, MediaLibrarySnapshot, MediaTranscriptStatus, TranscriptSummary } from '../../electron/types'

export type MediaLibraryScope = 'all' | 'unfiled' | 'history' | string
export type MediaLibraryStatusFilter = 'all' | MediaTranscriptStatus

export type MediaLibraryRow =
  | { kind: 'asset'; id: string; asset: MediaAsset }
  | { kind: 'history'; id: string; transcript: TranscriptSummary }

export interface MediaLibraryDerivedIndex {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  assetById: Map<string, MediaAsset>
  transcriptById: Map<string, TranscriptSummary>
  linkedTranscriptIds: Set<string>
  unlinkedHistory: TranscriptSummary[]
  folderCounts: Map<string, number>
  unfiledCount: number
  assetSearchText: Map<string, string>
  historySearchText: Map<string, string>
}

export function buildMediaLibraryIndex(library: MediaLibrarySnapshot, history: TranscriptSummary[]): MediaLibraryDerivedIndex {
  const assetById = new Map<string, MediaAsset>()
  const transcriptById = new Map(history.map((item) => [item.id, item]))
  const linkedTranscriptIds = new Set<string>()
  const folderCounts = new Map<string, number>()
  const assetSearchText = new Map<string, string>()
  const historySearchText = new Map<string, string>()
  let unfiledCount = 0

  for (const asset of library.assets) {
    assetById.set(asset.id, asset)
    if (asset.transcriptId) linkedTranscriptIds.add(asset.transcriptId)
    if (asset.folderId) folderCounts.set(asset.folderId, (folderCounts.get(asset.folderId) || 0) + 1)
    else unfiledCount += 1
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

  if (scope !== 'history') {
    for (const asset of index.library.assets) {
      const inScope = scope === 'all' || (scope === 'unfiled' ? !asset.folderId : asset.folderId === scope)
      if (!inScope || (status !== 'all' && asset.transcriptStatus !== status)) continue
      if (normalizedQuery && !index.assetSearchText.get(asset.id)?.includes(normalizedQuery)) continue
      rows.push({ kind: 'asset', id: asset.id, asset })
    }
  }

  const history = scope === 'history' ? index.history : scope === 'all' ? index.unlinkedHistory : []
  for (const transcript of history) {
    if (status !== 'all' && transcriptStatus(transcript) !== status) continue
    if (normalizedQuery && !index.historySearchText.get(transcript.id)?.includes(normalizedQuery)) continue
    rows.push({ kind: 'history', id: transcript.id, transcript })
  }
  return rows
}
