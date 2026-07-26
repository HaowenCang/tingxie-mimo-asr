import { describe, expect, it } from 'vitest'
import type { BackgroundAnalysisJob, TranscriptSummary } from '../../electron/types'
import { buildAnalysisQueueView } from './analysis-queue-view-model'

function summary(id: string, analysisStatus: TranscriptSummary['analysisStatus'], revision = 0): TranscriptSummary {
  return {
    id,
    revision,
    fileName: `${id}.mp3`,
    createdAt: `2026-07-2${revision}T00:00:00.000Z`,
    duration: 60,
    segmentCount: 2,
    sourceAvailable: true,
    preview: id,
    analysisStatus,
  }
}

function job(transcriptId: string, status: BackgroundAnalysisJob['status'], revision = 0): BackgroundAnalysisJob {
  return {
    transcriptId,
    sourceRevision: revision,
    providerId: 'provider',
    origin: 'automatic',
    status,
    attempts: status === 'failed' ? 3 : 0,
    queuedAt: '2026-07-27T00:00:00.000Z',
    error: status === 'failed' ? 'invalid JSON' : undefined,
  }
}

describe('smart overview queue view', () => {
  it('merges persisted jobs with missing, stale and legacy error history', () => {
    const items = buildAnalysisQueueView({
      history: [
        summary('ready', 'ready', 1),
        summary('missing', 'none', 2),
        summary('stale', 'stale', 3),
        summary('legacy-error', 'error', 4),
        summary('queued', 'none', 5),
      ],
      jobs: [job('queued', 'queued', 5), job('failed-without-summary', 'failed', 0)],
    })

    expect(items.map((item) => [item.transcriptId, item.status])).toEqual([
      ['queued', 'queued'],
      ['failed-without-summary', 'failed'],
      ['legacy-error', 'history-error'],
      ['stale', 'stale'],
      ['missing', 'missing'],
    ])
    expect(items[0]).toMatchObject({ fileName: 'queued.mp3', queuePosition: 1 })
    expect(items[1]).toMatchObject({ fileName: 'failed-without-summary', error: 'invalid JSON' })
  })

  it('hides a dismissed transcript revision but detects it again after the transcript changes', () => {
    const dismissed = job('record', 'dismissed', 2)
    expect(buildAnalysisQueueView({
      history: [summary('record', 'none', 2)],
      jobs: [dismissed],
    })).toEqual([])

    expect(buildAnalysisQueueView({
      history: [summary('record', 'stale', 3)],
      jobs: [dismissed],
    })).toEqual([
      expect.objectContaining({ transcriptId: 'record', sourceRevision: 3, status: 'stale' }),
    ])
  })
})
