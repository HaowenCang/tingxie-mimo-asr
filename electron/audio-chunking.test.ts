import { describe, expect, it } from 'vitest'
import {
  collapseRepeatedTranscriptBlocks,
  HARD_CHUNK_BYTES,
  estimateTranscriptSegments,
  mergeChunkTranscripts,
  parseSilenceDetectOutput,
  planAudioChunks,
  selectAudioEncoding,
  splitOversizedChunk,
  trimOverlappingPrefix,
} from './audio-chunking'

describe('silence-aware chunk planning', () => {
  it('uses high-quality MP3 for oversized non-MP3 sources so chunks can span minutes', () => {
    const encoding = selectAudioEncoding({ codec: 'aac', sourceBitRate: 128_000, channels: 2 })
    const chunks = planAudioChunks(600, encoding.estimatedBytesPerSecond, [])

    expect(encoding).toMatchObject({ outputExt: 'mp3', copy: false })
    expect(encoding.codecArgs).toEqual(['-c:a', 'libmp3lame', '-q:a', '0'])
    expect(chunks.length).toBeLessThanOrEqual(4)
    expect(chunks[0].end - chunks[0].start).toBeGreaterThan(150)
  })

  it('parses complete and trailing silence intervals', () => {
    const output = '[silencedetect] silence_start: 12.8\n[silencedetect] silence_end: 13.32 | silence_duration: 0.52\n[silencedetect] silence_start: 29.5'
    expect(parseSilenceDetectOutput(output, 30)).toEqual([{ start: 12.8, end: 13.32 }, { start: 29.5, end: 30 }])
  })

  it('moves a target boundary into nearby silence without overlap', () => {
    const chunks = planAudioChunks(60, 200_000, [{ start: 25.8, end: 26.4 }])
    expect(chunks[0].end).toBeCloseTo(26.1)
    expect(chunks[0].boundaryAtEnd).toBe('silence')
    expect(chunks[1].start).toBeCloseTo(26.1)
    expect(chunks[1].overlapWithPrevious).toBe(0)
  })

  it('prefers a paragraph-like pause over a slightly closer brief pause', () => {
    const chunks = planAudioChunks(60, 1_000, [
      { start: 24.8, end: 25.1 },
      { start: 27, end: 28.2 },
    ], { targetBytes: 25_000, hardBytes: 50_000, silenceSearchSeconds: 5 })

    expect(chunks[0].end).toBeCloseTo(27.6)
    expect(chunks[0].boundaryAtEnd).toBe('silence')
  })

  it('adds overlap when no silence is available', () => {
    const chunks = planAudioChunks(60, 200_000, [])
    expect(chunks[0].boundaryAtEnd).toBe('overlap')
    expect(chunks[1].start).toBeLessThan(chunks[0].end)
    expect(chunks[1].overlapWithPrevious).toBeGreaterThan(0)
  })

  it('permits sub-five-second chunks for very high bandwidth audio', () => {
    const bytesPerSecond = 192_000 * 8 * 3
    const chunks = planAudioChunks(10, bytesPerSecond, [])
    expect(chunks[0].end - chunks[0].start).toBeLessThan(5)
    expect((chunks[0].end - chunks[0].start) * bytesPerSecond).toBeLessThanOrEqual(HARD_CHUNK_BYTES)
  })

  it('splits an oversized chunk near an internal silence', () => {
    const [left, right] = splitOversizedChunk({ start: 0, end: 20, logicalStart: 0, overlapWithPrevious: 0, boundaryAtEnd: 'end' }, [{ start: 8.8, end: 9.2 }])
    expect(left.end).toBeGreaterThan(9)
    expect(right.start).toBeLessThan(9)
    expect(right.overlapWithPrevious).toBeGreaterThan(0)
  })
})

describe('fuzzy transcript timing', () => {
  it('collapses a long block repeated three times inside one API chunk', () => {
    const block = [
      '这是用于测试的第一句长文本，包含足够多的有效字符来避免把普通口头禅当作重复。',
      '这是同一段中的第二句话，用于模拟接口偶尔连续返回整段相同内容的情况。',
      '这是同一段中的最后一句，修复后整段应该只保留一份。',
    ].join('')

    const result = collapseRepeatedTranscriptBlocks(block.repeat(3))

    expect(result.text).toBe(block)
    expect(result.repeatGroups).toBe(1)
    expect(result.removedCharacters).toBe(block.length * 2)
  })

  it('uses the collapsed chunk text when building paragraph timestamps', () => {
    const block = '第一句包含足够多的测试文字，用于模拟接口重复返回内容。第二句继续补充上下文和必要信息。第三句结束这一段测试内容。'
    const segments = estimateTranscriptSegments([
      { start: 0, end: 90, text: block.repeat(3), overlapWithPrevious: 0, status: 'success' },
    ], 90, 'long')

    expect(segments.map((segment) => segment.text).join('')).toBe(block)
  })

  it('keeps short or non-adjacent repeated phrases to avoid deleting legitimate speech', () => {
    expect(collapseRepeatedTranscriptBlocks('好的。好的。接下来继续。').text).toBe('好的。好的。接下来继续。')
    const long = '这是一个可能在访谈开头和结尾都会自然出现的较长总结句，因此只要中间存在其他内容就不应被当成接口循环删除。'
    const separated = `${long}中间讨论了完全不同的议题和具体执行过程。${long}`
    expect(collapseRepeatedTranscriptBlocks(separated).text).toBe(separated)
  })

  it('groups sentence-sized units into standard readable paragraphs', () => {
    const text = [
      '第一项工作已经完成需求评审并确认了交付范围。',
      '设计团队同步更新了页面结构和主要交互细节。',
      '开发团队已经开始处理核心接口和数据迁移工作。',
      '测试团队补充了回归清单并准备第一轮验证环境。',
      '增长团队上线了新的落地页并开始观察转化数据。',
      '运营团队整理了用户反馈和下阶段的沟通计划。',
      '项目负责人确认下周进入集成测试和缺陷修复。',
      '各团队将在周五以前同步风险和需要支持的事项。',
    ].join('')
    const segments = estimateTranscriptSegments([
      { start: 0, end: 160, text, overlapWithPrevious: 0, status: 'success' },
    ], 160)

    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => (segment.text.match(/。/g)?.length || 0) >= 2)).toBe(true)
  })

  it('treats semicolons as soft punctuation instead of paragraph boundaries', () => {
    const segments = estimateTranscriptSegments([
      { start: 0, end: 30, text: '第一部分已经完成；第二部分正在进行；第三部分将在下周开始。', overlapWithPrevious: 0, status: 'success' },
    ], 30, 'compact')

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toContain('完成；第二部分')
  })

  it('applies compact and long paragraph preferences to new transcripts', () => {
    const text = Array.from({ length: 8 }, (_, index) => `这是第${index + 1}项工作安排，包含当前进度、后续计划和注意事项。`).join('')
    const chunks = [{ start: 0, end: 160, text, overlapWithPrevious: 0, status: 'success' as const }]

    expect(estimateTranscriptSegments(chunks, 160, 'compact').length).toBeGreaterThan(
      estimateTranscriptSegments(chunks, 160, 'long').length,
    )
  })

  it('allocates paragraph timestamps by relative text weight', () => {
    const firstParagraph = Array.from({ length: 3 }, () => `${'较长内容'.repeat(14)}。`).join('')
    const secondParagraph = Array.from({ length: 3 }, () => `${'短内容'.repeat(10)}。`).join('')
    const segments = estimateTranscriptSegments([
      { start: 10, end: 40, text: firstParagraph + secondParagraph, overlapWithPrevious: 0, status: 'success' },
    ], 60)
    expect(segments).toHaveLength(2)
    expect(segments[0].start).toBe(10)
    expect(segments[0].end).toBeGreaterThan(28)
    expect(segments[0].end).toBeLessThan(31)
    expect(segments[1].end).toBe(40)
    expect(segments.every((segment) => segment.estimated)).toBe(true)
  })

  it('keeps estimates monotonic, bounded and leaves failed chunk holes', () => {
    const segments = estimateTranscriptSegments([
      { start: 0, end: 20, text: '第一段。第二段。', overlapWithPrevious: 0, status: 'success' },
      { start: 20, end: 40, text: '', overlapWithPrevious: 0, status: 'failed', error: '超时', attempts: 2 },
      { start: 40, end: 70, text: 'Last section continues.', overlapWithPrevious: 0, status: 'success' },
    ], 60)
    expect(segments.find((segment) => segment.status === 'failed')).toMatchObject({ start: 20, end: 40, error: '超时' })
    expect(segments.at(-1)?.end).toBe(60)
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].start).toBeGreaterThanOrEqual(segments[index - 1].end || 0)
    }
  })

  it('merges a continued sentence across an overlapped boundary', () => {
    const segments = estimateTranscriptSegments([
      { start: 0, end: 20, text: '今天讨论新版本的发布计划', overlapWithPrevious: 0, status: 'success' },
      { start: 20, end: 40, text: '新版本的发布计划，预计下周开始。下一项。', overlapWithPrevious: 1.6, status: 'success' },
    ], 40)
    expect(segments[0].text).toContain('预计下周开始。')
    expect(segments[0].chunkIndexes).toEqual([0, 1])
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toContain('下一项。')
  })
})

describe('overlapping transcript merge', () => {
  it('removes an exact overlap while ignoring punctuation', () => {
    const result = trimOverlappingPrefix('今天讨论新版本的发布计划。', '新版本的发布计划，预计下周开始。')
    expect(result.similarity).toBe(1)
    expect(result.text).toBe('，预计下周开始。')
  })

  it('merges an unsafe boundary into one logical segment', () => {
    const segments = mergeChunkTranscripts([
      { start: 0, text: '今天讨论新版本的发布计划', overlapWithPrevious: 0 },
      { start: 26, text: '新版本的发布计划，预计下周开始。', overlapWithPrevious: 1.6 },
    ])
    expect(segments).toEqual([{ start: 0, text: '今天讨论新版本的发布计划，预计下周开始。' }])
  })

  it('keeps a safe sentence boundary as a logical segment', () => {
    const segments = mergeChunkTranscripts([
      { start: 0, text: '第一项工作已经完成。', overlapWithPrevious: 0 },
      { start: 25, text: '下面讨论第二项工作。', overlapWithPrevious: 0 },
    ])
    expect(segments).toHaveLength(2)
  })

  it('keeps a failed chunk in timeline order and does not merge across the gap', () => {
    const segments = mergeChunkTranscripts([
      { start: 0, end: 20, text: '第一段没有句号', overlapWithPrevious: 0, status: 'success' },
      { start: 20, end: 40, text: '', overlapWithPrevious: 0, status: 'failed', error: '服务超时', attempts: 2 },
      { start: 40, end: 60, text: '第三段继续。', overlapWithPrevious: 0, status: 'success' },
    ])
    expect(segments).toEqual([
      { start: 0, end: 20, text: '第一段没有句号', status: 'success' },
      { start: 20, end: 40, text: '', status: 'failed', error: '服务超时', attempts: 2 },
      { start: 40, end: 60, text: '第三段继续。', status: 'success' },
    ])
  })
})
