import { describe, expect, it } from 'vitest'
import type { AIProvider, TranscriptSummary } from './types'
import { planMissingAnalysisJobs } from './analysis-planning'

function summary(id: string, overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
  return {
    id,
    fileName: `${id}.mp3`,
    createdAt: '2026-07-27T00:00:00.000Z',
    duration: 60,
    segmentCount: 3,
    sourceAvailable: true,
    preview: id,
    analysisStatus: 'none',
    revision: 0,
    ...overrides,
  }
}

const provider: AIProvider = {
  id: 'provider',
  name: 'Provider',
  kind: 'mimo-payg',
  baseUrl: 'https://example.com/v1',
  model: 'mimo-v2.5',
  contextWindow: 1_000_000,
  maxOutputTokens: 8192,
  systemPrompt: '',
  hasApiKey: true,
  builtIn: true,
}

describe('missing analysis planning', () => {
  it('queues only useful transcripts without a ready analysis and deduplicates persisted jobs', () => {
    const jobs = planMissingAnalysisJobs({
      summaries: [
        summary('missing', { revision: 2 }),
        summary('partial', { outcome: 'partial' }),
        summary('ready', { analysisStatus: 'ready' }),
        summary('failed', { outcome: 'failed' }),
        summary('empty', { segmentCount: 0 }),
      ],
      existingJobs: [{
        transcriptId: 'partial',
        sourceRevision: 0,
        providerId: 'provider',
        origin: 'automatic',
        status: 'queued',
        attempts: 0,
        queuedAt: '2026-07-27T00:00:00.000Z',
      }],
      provider,
      tokenPlanAcknowledged: true,
      now: '2026-07-27T01:00:00.000Z',
    })

    expect(jobs).toEqual([expect.objectContaining({
      transcriptId: 'missing',
      sourceRevision: 2,
      providerId: 'provider',
      status: 'queued',
    })])
  })

  it('does not create billable work without a configured provider or token plan acknowledgement', () => {
    expect(planMissingAnalysisJobs({
      summaries: [summary('missing')],
      existingJobs: [],
      provider: { ...provider, hasApiKey: false },
      tokenPlanAcknowledged: true,
    })).toEqual([])
    expect(planMissingAnalysisJobs({
      summaries: [summary('missing')],
      existingJobs: [],
      provider: { ...provider, kind: 'mimo-token-plan' },
      tokenPlanAcknowledged: false,
    })).toEqual([])
  })
})
