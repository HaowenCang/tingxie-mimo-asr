import type { TranscriptSummary } from '../../electron/types'

export function addRecentTranscript(current: TranscriptSummary[], item: TranscriptSummary, limit = 5): TranscriptSummary[] {
  return [item, ...current.filter((candidate) => candidate.id !== item.id)].slice(0, limit)
}
