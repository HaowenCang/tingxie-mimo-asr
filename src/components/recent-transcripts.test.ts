import { describe, expect, it } from 'vitest'
import type { TranscriptSummary } from '../../electron/types'
import { addRecentTranscript } from './recent-transcripts'

const summary = (id: string): TranscriptSummary => ({ id, fileName: `${id}.mp3`, createdAt: '2026-07-22T00:00:00.000Z', duration: 10, segmentCount: 1, sourceAvailable: true, preview: id, analysisStatus: 'none' })

describe('recent opened transcripts', () => {
  it('orders items by most recent use, de-duplicates and caps the list', () => {
    let recent: TranscriptSummary[] = []
    for (let index = 0; index < 7; index += 1) recent = addRecentTranscript(recent, summary(String(index)))
    expect(recent.map((item) => item.id)).toEqual(['6', '5', '4', '3', '2'])
    expect(addRecentTranscript(recent, summary('4')).map((item) => item.id)).toEqual(['4', '6', '5', '3', '2'])
  })
})
