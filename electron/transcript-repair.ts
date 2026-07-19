import type { RecoveredTranscriptChunk } from './transcript-quality'
import type { TranscriptChunkRecord } from './types'

export function applyChunkRepairs(
  chunks: TranscriptChunkRecord[],
  replacements: ReadonlyMap<number, RecoveredTranscriptChunk[]>,
): TranscriptChunkRecord[] {
  return chunks
    .flatMap((chunk) => {
      const replacement = replacements.get(chunk.index)
      if (!replacement) return [{ ...chunk }]
      return replacement.map((candidate) => ({
        index: 0,
        start: candidate.start,
        end: candidate.end,
        overlapWithPrevious: candidate.overlapWithPrevious,
        text: candidate.text,
        status: candidate.status,
        ...(candidate.status === 'failed' ? {
          error: candidate.error,
          attempts: candidate.attempts,
          rateLimitWaits: candidate.rateLimitWaits,
        } : {}),
      }))
    })
    .map((chunk, index) => ({ ...chunk, index }))
}
