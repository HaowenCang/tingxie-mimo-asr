import { describe, expect, it } from 'vitest'
import type { TranscriptResult } from './types'
import { inspectTranscriptDuplicates, repairTranscriptDuplicates } from './transcript-dedup'

function resultWithRepeatedSegments(): TranscriptResult {
  const repeated = '这是一段足够长的脱敏测试文字，用于模拟同一个接口切片连续返回完全相同的长段落，并确保普通短句不会被错误删除。'
  return {
    id: 'duplicate-record',
    fileName: '测试录音.mp4',
    createdAt: 'now',
    duration: 120,
    text: repeated.repeat(3),
    segments: [
      { id: 'first', start: 10, end: 20, text: repeated, status: 'success', estimated: true, chunkIndexes: [1] },
      { id: 'second', start: 20, end: 30, text: repeated, status: 'success', estimated: true, chunkIndexes: [1] },
      { id: 'third', start: 30, end: 40, text: repeated, status: 'success', estimated: true, chunkIndexes: [1] },
      { id: 'next', start: 40, end: 50, text: '下一段内容保持不变。', status: 'success', estimated: true, chunkIndexes: [1] },
    ],
  }
}

describe('historical transcript duplicate repair', () => {
  it('previews and removes only consecutive long duplicates from the same chunk', () => {
    const result = resultWithRepeatedSegments()
    const report = inspectTranscriptDuplicates(result)
    const repaired = repairTranscriptDuplicates(result)

    expect(report).toMatchObject({ duplicateGroups: 1, removableSegments: 2 })
    expect(repaired.removedSegments).toBe(2)
    expect(repaired.result.segments.map((segment) => segment.id)).toEqual(['first', 'next'])
    expect(repaired.result.segments[0].end).toBe(40)
    expect(repaired.result.text).toContain('下一段内容保持不变。')
  })
})
