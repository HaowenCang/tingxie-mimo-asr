import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type TranscriptResult } from '../../electron/types'
import { TranscriptDetail } from './TranscriptDetail'

const transcript: TranscriptResult = {
  id: 'transcript-1',
  fileName: '会议.m4a',
  createdAt: '2026-07-18T00:00:00.000Z',
  text: '会议内容',
  duration: 60,
  segments: [{ id: 'segment-0', start: 0, text: '会议内容' }],
  analysis: {
    status: 'ready',
    overview: '会议概要',
    keywords: ['会议'],
    chapters: [{ id: 'chapter-0', title: '开场', summary: '会议开场内容', startSegmentId: 'segment-0', endSegmentId: 'segment-0' }],
    keyPoints: ['确认议题'],
    speechSummary: ['完成开场'],
    actionItems: [],
    providerId: 'provider-1',
    model: 'model-1',
    generatedAt: '2026-07-18T00:00:00.000Z',
  },
}

describe('smart analysis error state', () => {
  it('renders a retryable inline error instead of a blocking system dialog', () => {
    const markup = renderToStaticMarkup(<TranscriptDetail
      result={transcript}
      preferences={DEFAULT_APP_PREFERENCES}
      onChange={() => undefined}
      onGenerateAnalysis={async () => undefined}
      onExport={() => undefined}
      onOpenChat={() => undefined}
      onNewTranscript={() => undefined}
      analysisBusy={false}
      analysisError="AI 未返回 JSON 对象"
    />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('AI 未返回 JSON 对象')
    expect(markup).toContain('重试')
  })
})

describe('chapter navigation', () => {
  it('renders overview chapters as jump controls with stable transcript targets', () => {
    const markup = renderToStaticMarkup(<TranscriptDetail
      result={transcript}
      preferences={DEFAULT_APP_PREFERENCES}
      onChange={() => undefined}
      onGenerateAnalysis={async () => undefined}
      onExport={() => undefined}
      onOpenChat={() => undefined}
      onNewTranscript={() => undefined}
      analysisBusy={false}
      analysisError=""
    />)

    expect(markup).toContain('aria-label="跳转到原文：开场"')
    expect(markup).toContain('data-segment-id="segment-0"')
    expect(markup).toContain('data-segment-index="0"')
  })
})
