import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type TranscriptResult } from '../../electron/types'
import { TranscriptDetail } from './TranscriptDetail'

describe('long transcript rendering', () => {
  it('only renders a bounded window of a 1,200 segment transcript', () => {
    const segments: TranscriptResult['segments'] = Array.from({ length: 1_200 }, (_, index) => ({
      id: `segment-${index}`,
      start: index * 10,
      end: (index + 1) * 10,
      text: `segment ${index}`,
      status: 'success',
    }))
    const result: TranscriptResult = {
      id: 'long-transcript',
      fileName: 'long.m4a',
      createdAt: '2026-07-19T00:00:00.000Z',
      duration: 12_000,
      text: segments.map((segment) => segment.text).join('\n\n'),
      segments,
    }

    const markup = renderToStaticMarkup(<TranscriptDetail
      result={result}
      preferences={DEFAULT_APP_PREFERENCES}
      onChange={() => undefined}
      onGenerateAnalysis={async () => undefined}
      onExport={() => undefined}
      onOpenChat={() => undefined}
      onNewTranscript={() => undefined}
      analysisBusy={false}
      analysisError=""
    />)
    const renderedRows = markup.match(/aria-label="转写段落/g)?.length || 0

    expect(renderedRows).toBeGreaterThan(0)
    expect(renderedRows).toBeLessThan(100)
    expect(markup).toContain('data-virtualized="true"')
  })
})
