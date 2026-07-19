import { renderToStaticMarkup } from 'react-dom/server'
import { bench, describe } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type TranscriptResult } from '../electron/types'
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
})
