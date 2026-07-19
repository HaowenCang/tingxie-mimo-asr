import type { TranscriptSegment } from '../../electron/types'

export interface TranscriptMatch {
  id: string
  segmentIndex: number
  start: number
  length: number
  excerpt: string
  excerptMatchStart: number
}

export function findTranscriptMatches(segments: TranscriptSegment[], rawQuery: string): TranscriptMatch[] {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return []
  const matches: TranscriptMatch[] = []
  segments.forEach((segment, segmentIndex) => {
    const normalized = segment.text.toLocaleLowerCase()
    let from = 0
    while (from <= normalized.length - query.length) {
      const start = normalized.indexOf(query, from)
      if (start < 0) break
      const excerptStart = Math.max(0, start - 28)
      const excerptEnd = Math.min(segment.text.length, start + rawQuery.trim().length + 42)
      matches.push({
        id: `${segmentIndex}-${start}`,
        segmentIndex,
        start,
        length: rawQuery.trim().length,
        excerpt: `${excerptStart > 0 ? '…' : ''}${segment.text.slice(excerptStart, excerptEnd)}${excerptEnd < segment.text.length ? '…' : ''}`,
        excerptMatchStart: start - excerptStart + (excerptStart > 0 ? 1 : 0),
      })
      from = start + Math.max(1, query.length)
    }
  })
  return matches
}
