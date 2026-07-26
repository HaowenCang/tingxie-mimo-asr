import type { BackgroundAnalysisJob, TranscriptSummary } from '../../electron/types'

export type AnalysisQueueViewStatus =
  | Exclude<BackgroundAnalysisJob['status'], 'dismissed'>
  | 'missing'
  | 'stale'
  | 'history-error'

export interface AnalysisQueueViewItem {
  transcriptId: string
  sourceRevision: number
  fileName: string
  createdAt: string
  status: AnalysisQueueViewStatus
  origin?: BackgroundAnalysisJob['origin']
  providerId?: string
  attempts: number
  queuePosition?: number
  nextRetryAt?: string
  error?: string
}

interface BuildAnalysisQueueViewInput {
  history: TranscriptSummary[]
  jobs: BackgroundAnalysisJob[]
}

function historyStatus(status: TranscriptSummary['analysisStatus']): AnalysisQueueViewStatus | undefined {
  if (status === 'none') return 'missing'
  if (status === 'stale') return 'stale'
  if (status === 'error') return 'history-error'
  return undefined
}

export function buildAnalysisQueueView({ history, jobs }: BuildAnalysisQueueViewInput): AnalysisQueueViewItem[] {
  const summaryById = new Map(history.map((summary) => [summary.id, summary]))
  const dismissed = new Set(jobs
    .filter((job) => job.status === 'dismissed')
    .map((job) => `${job.transcriptId}\0${job.sourceRevision}`))
  let queuePosition = 0
  const activeJobs = jobs.flatMap((job): AnalysisQueueViewItem[] => {
    if (job.status === 'dismissed') return []
    const summary = summaryById.get(job.transcriptId)
    if (job.status === 'running' || job.status === 'queued' || job.status === 'retry-wait') queuePosition += 1
    return [{
      transcriptId: job.transcriptId,
      sourceRevision: job.sourceRevision,
      fileName: summary?.fileName || job.transcriptId,
      createdAt: summary?.createdAt || job.queuedAt,
      status: job.status,
      origin: job.origin,
      providerId: job.providerId,
      attempts: job.attempts,
      queuePosition: job.status === 'running' || job.status === 'queued' || job.status === 'retry-wait'
        ? queuePosition
        : undefined,
      nextRetryAt: job.nextRetryAt,
      error: job.error,
    }]
  })
  const activeIds = new Set(jobs
    .filter((job) => job.status !== 'dismissed')
    .map((job) => `${job.transcriptId}\0${job.sourceRevision}`))
  const discovered = history
    .flatMap((summary): AnalysisQueueViewItem[] => {
      const sourceRevision = summary.revision ?? 0
      const status = historyStatus(summary.analysisStatus)
      const key = `${summary.id}\0${sourceRevision}`
      if (!status || dismissed.has(key) || activeIds.has(key) || summary.outcome === 'failed' || summary.segmentCount <= 0) return []
      return [{
        transcriptId: summary.id,
        sourceRevision,
        fileName: summary.fileName,
        createdAt: summary.createdAt,
        status,
        attempts: 0,
      }]
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return [...activeJobs, ...discovered]
}
