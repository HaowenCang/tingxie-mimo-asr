import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type BackgroundAnalysisJob, type TranscriptSummary } from '../../electron/types'
import { AnalysisQueuePanel } from './AnalysisQueuePanel'

function summary(id: string, analysisStatus: TranscriptSummary['analysisStatus']): TranscriptSummary {
  return {
    id,
    revision: 1,
    fileName: `${id}.mp3`,
    createdAt: '2026-07-27T08:00:00.000Z',
    duration: 600,
    segmentCount: 12,
    sourceAvailable: true,
    preview: `${id} preview`,
    analysisStatus,
  }
}

function job(transcriptId: string, status: BackgroundAnalysisJob['status']): BackgroundAnalysisJob {
  return {
    transcriptId,
    sourceRevision: 1,
    providerId: 'mimo-payg',
    origin: 'automatic',
    status,
    attempts: status === 'failed' ? 3 : 1,
    queuedAt: '2026-07-27T08:10:00.000Z',
    error: status === 'failed' ? 'JSON 格式无效' : undefined,
  }
}

describe('AnalysisQueuePanel', () => {
  it('shows active jobs and historical records missing a smart overview without duplicating ready records', () => {
    const history = [
      summary('running', 'none'),
      summary('missing', 'none'),
      summary('stale', 'stale'),
      summary('ready', 'ready'),
    ]
    const markup = renderToStaticMarkup(<AnalysisQueuePanel
      snapshot={{ jobs: [job('running', 'running'), job('failed', 'failed')], activeTranscriptId: 'running' }}
      history={history}
      preferences={{ ...DEFAULT_APP_PREFERENCES, autoGenerateAnalysis: true }}
      providerName="MiMo 按量 API"
      providerConfigured
      onClose={vi.fn()}
      onOpen={vi.fn()}
      onGenerate={vi.fn()}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />)

    expect(markup).toContain('智能速览队列')
    expect(markup).toContain('running.mp3')
    expect(markup).toContain('failed')
    expect(markup).toContain('missing.mp3')
    expect(markup).toContain('stale.mp3')
    expect(markup).not.toContain('ready.mp3')
    expect(markup).toContain('历史待生成')
    expect(markup).toContain('自动生成已开启')
  })
})
