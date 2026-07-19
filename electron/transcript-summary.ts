import type { TranscriptResult, TranscriptSummary } from './types'

export function summarizeTranscript(result: TranscriptResult): TranscriptSummary {
  return {
    id: result.id,
    fileName: result.fileName,
    createdAt: result.createdAt,
    duration: result.duration,
    outcome: result.outcome,
    failedSegmentCount: result.failedSegmentCount,
    segmentCount: result.segments.length,
    mediaId: result.mediaId,
    sourceAvailable: Boolean(result.sourcePath),
    preview: result.text.replace(/\s+/g, ' ').trim().slice(0, 120),
    analysisStatus: result.analysis?.status ?? 'none',
  }
}
