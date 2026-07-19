import { describe, expect, it } from 'vitest'
import type { TranscriptChunkRecord } from './types'
import { applyChunkRepairs } from './transcript-repair'

describe('stored transcript repair', () => {
  it('replaces only selected chunks and reindexes the resulting sequence', () => {
    const original: TranscriptChunkRecord[] = [
      { index: 0, start: 0, end: 180, overlapWithPrevious: 0, text: 'bad loop', status: 'success' },
      { index: 1, start: 180, end: 360, overlapWithPrevious: 1.6, text: 'keep this exactly', status: 'success' },
      { index: 2, start: 360, end: 540, overlapWithPrevious: 1.6, text: 'also unchanged', status: 'success' },
    ]

    const repaired = applyChunkRepairs(original, new Map([
      [0, [
        { start: 0, end: 90, overlapWithPrevious: 0, text: 'recovered left', status: 'success' as const },
        { start: 90, end: 180, overlapWithPrevious: 1.6, text: 'recovered right', status: 'success' as const },
      ]],
    ]))

    expect(repaired).toEqual([
      { index: 0, start: 0, end: 90, overlapWithPrevious: 0, text: 'recovered left', status: 'success' },
      { index: 1, start: 90, end: 180, overlapWithPrevious: 1.6, text: 'recovered right', status: 'success' },
      { index: 2, start: 180, end: 360, overlapWithPrevious: 1.6, text: 'keep this exactly', status: 'success' },
      { index: 3, start: 360, end: 540, overlapWithPrevious: 1.6, text: 'also unchanged', status: 'success' },
    ])
  })

  it('persists an unrecoverable replacement as an explicit failed chunk', () => {
    const original: TranscriptChunkRecord[] = [
      { index: 0, start: 0, end: 90, overlapWithPrevious: 0, text: 'bad loop', status: 'success' },
    ]
    const repaired = applyChunkRepairs(original, new Map([
      [0, [{
        start: 0,
        end: 90,
        overlapWithPrevious: 0,
        text: '',
        status: 'failed' as const,
        error: '自动恢复失败',
        attempts: 2,
        rateLimitWaits: 1,
      }]],
    ]))

    expect(repaired[0]).toMatchObject({
      index: 0,
      status: 'failed',
      error: '自动恢复失败',
      attempts: 2,
      rateLimitWaits: 1,
    })
  })
})
