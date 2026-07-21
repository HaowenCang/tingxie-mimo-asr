import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../electron/types'
import { buildTranscriptSearchIndex, findTranscriptMatches, updateTranscriptSearchIndex } from './searchTranscript'

describe('transcript search', () => {
  const segments: TranscriptSegment[] = [
    { start: 0, text: '项目会议确认了交付日期，会议还讨论了风险。' },
    { start: 32, text: '客户访谈没有出现目标词。' },
  ]

  it('returns every occurrence with its source segment and excerpt', () => {
    const matches = findTranscriptMatches(segments, '会议')
    expect(matches).toHaveLength(2)
    expect(matches.map((item) => item.segmentIndex)).toEqual([0, 0])
    expect(matches[0].excerpt).toContain('会议')
  })

  it('returns an empty collection for blank or unmatched queries', () => {
    expect(findTranscriptMatches(segments, '')).toEqual([])
    expect(findTranscriptMatches(segments, '不存在')).toEqual([])
  })

  it('reuses normalized text for unchanged segments and only replaces an edited entry', () => {
    const initial = buildTranscriptSearchIndex(segments)
    const edited = [segments[0], { ...segments[1], text: '客户访谈新增了会议目标词。' }]
    const next = updateTranscriptSearchIndex(initial, edited)

    expect(next.entries[0]).toBe(initial.entries[0])
    expect(next.entries[1]).not.toBe(initial.entries[1])
    expect(findTranscriptMatches(edited, '会议', next)).toHaveLength(3)
  })
})
