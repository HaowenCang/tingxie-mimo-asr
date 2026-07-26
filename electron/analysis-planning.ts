import type { AIProvider, BackgroundAnalysisJob, TranscriptSummary } from './types'

interface MissingAnalysisPlanInput {
  summaries: TranscriptSummary[]
  existingJobs: BackgroundAnalysisJob[]
  provider?: AIProvider
  tokenPlanAcknowledged: boolean
  now?: string
}

export function planMissingAnalysisJobs({
  summaries,
  existingJobs,
  provider,
  tokenPlanAcknowledged,
  now = new Date().toISOString(),
}: MissingAnalysisPlanInput): BackgroundAnalysisJob[] {
  if (!provider?.hasApiKey) return []
  if (provider.kind === 'mimo-token-plan' && !tokenPlanAcknowledged) return []
  const existing = new Set(existingJobs.map((job) => `${job.transcriptId}\0${job.sourceRevision}`))
  return summaries.flatMap((summary) => {
    const sourceRevision = summary.revision ?? 0
    if (summary.analysisStatus !== 'none'
      || summary.outcome === 'failed'
      || summary.segmentCount <= 0
      || existing.has(`${summary.id}\0${sourceRevision}`)) return []
    return [{
      transcriptId: summary.id,
      sourceRevision,
      providerId: provider.id,
      origin: 'automatic' as const,
      status: 'queued' as const,
      attempts: 0,
      queuedAt: now,
    }]
  })
}
