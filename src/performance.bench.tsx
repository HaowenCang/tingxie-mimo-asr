import { renderToStaticMarkup } from 'react-dom/server'
import { bench, describe } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type MediaLibrarySnapshot, type TranscriptResult, type TranscriptSummary } from '../electron/types'
import { MediaLibraryView } from './components/MediaLibraryView'
import { buildMediaLibraryIndex, filterMediaLibraryRows } from './components/media-library-model'
import { TranscriptDetail } from './components/TranscriptDetail'
import { findTranscriptMatches } from './components/searchTranscript'

const segmentCount = 1_200
const sentence = '这是用于性能基线的合成转写段落，包含产品进展、行动事项与后续计划。'
const segments: TranscriptResult['segments'] = Array.from({ length: segmentCount }, (_, index) => ({
  id: `segment-${index}`,
  start: index * 12,
  end: (index + 1) * 12,
  status: 'success',
  text: `${sentence}第 ${index + 1} 段需要核对性能基线。`,
}))

const transcript: TranscriptResult = {
  id: 'performance-fixture',
  fileName: 'performance-fixture.m4a',
  createdAt: '2026-07-19T00:00:00.000Z',
  duration: segmentCount * 12,
  text: segments.map((segment) => segment.text).join('\n\n'),
  segments,
  outcome: 'complete',
}

const noChange = () => undefined
const noAsyncChange = async () => undefined

const mediaLibrary: MediaLibrarySnapshot = {
  rootPath: 'D:/performance-library',
  folders: Array.from({ length: 100 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}`, createdAt: 'now', updatedAt: 'now' })),
  assets: Array.from({ length: 10_000 }, (_, index) => ({
    id: `asset-${index}`,
    displayName: `Recording ${index}.m4a`,
    originalName: `Recording ${index}.m4a`,
    relativePath: `media/asset-${index}.m4a`,
    size: 1024 + index,
    extension: 'M4A',
    folderId: index % 10 ? `folder-${index % 100}` : undefined,
    transcriptStatus: index % 2 ? 'transcribed' as const : 'untranscribed' as const,
    managed: true,
    importedAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  })),
}
const mediaHistory: TranscriptSummary[] = Array.from({ length: 250 }, (_, index) => ({
  id: `history-${index}`, fileName: `Legacy ${index}.wav`, createdAt: '2026-07-19T00:00:00.000Z', duration: 60,
  segmentCount: 2, sourceAvailable: false, preview: `Legacy preview ${index}`, analysisStatus: 'none',
}))

function legacyMediaLibraryDerivation() {
  const linked = new Set(mediaLibrary.assets.map((asset) => asset.transcriptId).filter(Boolean))
  const unlinked = mediaHistory.filter((item) => !linked.has(item.id))
  const visible = mediaLibrary.assets.filter((asset) => `${asset.displayName} ${asset.originalName} ${asset.extension}`.toLocaleLowerCase().includes('recording 999'))
  const unfiled = mediaLibrary.assets.filter((asset) => !asset.folderId).length
  const folderCounts = mediaLibrary.folders.map((folder) => mediaLibrary.assets.filter((asset) => asset.folderId === folder.id).length)
  return { unlinked, visible, unfiled, folderCounts }
}

describe('performance baseline', () => {
  bench('searches 1,200 transcript segments', () => {
    findTranscriptMatches(segments, '性能基线')
  }, { iterations: 10, time: 200, warmupIterations: 2, warmupTime: 50 })

  bench('server-renders a 1,200 segment transcript detail', () => {
    renderToStaticMarkup(<TranscriptDetail
      result={transcript}
      preferences={DEFAULT_APP_PREFERENCES}
      onChange={noChange}
      onGenerateAnalysis={noAsyncChange}
      onExport={noChange}
      onOpenChat={noChange}
      onNewTranscript={noChange}
      analysisBusy={false}
      analysisError=""
    />)
  }, { iterations: 3, time: 100, warmupIterations: 1, warmupTime: 50 })

  bench('derives legacy media state for 10,000 assets', () => {
    legacyMediaLibraryDerivation()
  }, { iterations: 5, time: 300, warmupIterations: 2, warmupTime: 50 })

  bench('derives indexed media state for 10,000 assets', () => {
    const index = buildMediaLibraryIndex(mediaLibrary, mediaHistory)
    filterMediaLibraryRows(index, 'all', 'all', 'recording 999')
  }, { iterations: 5, time: 300, warmupIterations: 2, warmupTime: 50 })

  bench('server-renders a virtualized 10,000 asset media library', () => {
    renderToStaticMarkup(<MediaLibraryView
      library={mediaLibrary}
      history={mediaHistory}
      onLibraryChange={noChange}
      onOpenTranscript={noChange}
      onTranscribe={noChange}
      onImportFiles={noChange}
      onImportFolder={noChange}
    />)
  }, { iterations: 3, time: 100, warmupIterations: 1, warmupTime: 50 })
})
