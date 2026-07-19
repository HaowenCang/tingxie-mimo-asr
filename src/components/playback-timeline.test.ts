import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../electron/types'
import { findActiveTranscriptSegment } from './playback-timeline'

describe('playback timeline lookup', () => {
  it('uses binary-searchable boundaries for a long transcript', () => {
    const segments: TranscriptSegment[] = Array.from({ length: 1_200 }, (_, index) => ({
      id: `segment-${index}`,
      start: index * 10,
      end: (index + 1) * 10,
      text: `segment ${index}`,
      status: 'success',
    }))

    expect(findActiveTranscriptSegment(segments, 12_000, 0)).toBe(0)
    expect(findActiveTranscriptSegment(segments, 12_000, 8_765)).toBe(876)
    expect(findActiveTranscriptSegment(segments, 12_000, 11_999.9)).toBe(1_199)
  })

  it('does not highlight a failed gap and honors manual calibration', () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 10, text: 'first', status: 'success' },
      { start: 10, end: 20, text: '', status: 'failed' },
      { start: 20, manualStart: 22, end: 30, text: 'third', status: 'success' },
    ]

    expect(findActiveTranscriptSegment(segments, 30, 15)).toBe(-1)
    expect(findActiveTranscriptSegment(segments, 30, 21)).toBe(-1)
    expect(findActiveTranscriptSegment(segments, 30, 22)).toBe(2)
  })
})
