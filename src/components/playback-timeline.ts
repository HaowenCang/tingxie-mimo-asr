import type { TranscriptSegment } from '../../electron/types'

function segmentStart(segment: TranscriptSegment): number {
  return segment.manualStart ?? segment.start
}

export function findActiveTranscriptSegment(
  segments: TranscriptSegment[],
  duration: number,
  currentTime: number,
): number {
  if (!segments.length || currentTime < segmentStart(segments[0])) return -1
  let low = 0
  let high = segments.length - 1
  let candidate = -1
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    if (segmentStart(segments[middle]) <= currentTime) {
      candidate = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (candidate < 0) return -1
  const segment = segments[candidate]
  const next = segments[candidate + 1]
  const end = segment.end ?? (next ? segmentStart(next) : duration)
  return segment.status !== 'failed' && currentTime < end ? candidate : -1
}
