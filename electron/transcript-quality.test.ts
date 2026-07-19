import { describe, expect, it } from 'vitest'
import { inspectTranscriptQuality, planTranscriptQualityRecovery, recoverTranscriptChunk, type RecoverableAudioChunk } from './transcript-quality'

describe('ASR transcript quality guard', () => {
  it('rejects the degenerate repetition captured from the affected first chunk', () => {
    const phrase = '我们的讲座马上就要开始了，各位同学尽快就座。'
    const transcript = Array.from({ length: 157 }, (_, index) => `${index % 2 ? '嗯。' : ''}${phrase}`).join('')

    const quality = inspectTranscriptQuality(transcript, 183.5008)

    expect(quality.suspicious).toBe(true)
    expect(quality.reason).toBe('degenerate-repetition')
    expect(quality.maxRepeatCount).toBeGreaterThanOrEqual(100)
    expect(quality.repetitionCoverage).toBeGreaterThan(0.8)
  })

  it('keeps a legitimately repeated announcement', () => {
    const transcript = '请各位同学尽快就座。请各位同学尽快就座。请各位同学尽快就座。随后主持人介绍了今晚讲座的主题和嘉宾。'

    expect(inspectTranscriptQuality(transcript, 45).suspicious).toBe(false)
  })

  it('detects a periodic loop even when the ASR response has no punctuation', () => {
    const loop = '欢迎大家参加今天的专题讲座请大家尽快就座'
    const quality = inspectTranscriptQuality(loop.repeat(30), 90)

    expect(quality.suspicious).toBe(true)
    expect(quality.maxRepeatCount).toBeGreaterThanOrEqual(20)
  })
})

describe('transcript quality recovery planning', () => {
  it('splits an anomalous chunk at the nearest usable silence', () => {
    const plan = planTranscriptQualityRecovery(0, 183.5008, [
      { start: 70, end: 71 },
      { start: 91, end: 93 },
      { start: 140, end: 141 },
    ], 0)

    expect(plan).toEqual({ splitAt: 92, overlapPadding: 0 })
  })

  it('retranscribes ordered child chunks after a repeated quality failure', async () => {
    const parent: RecoverableAudioChunk = { file: 'parent.mp3', start: 0, end: 120, overlapWithPrevious: 0 }
    const requests: string[] = []
    const recovered = await recoverTranscriptChunk({
      chunk: parent,
      silences: [{ start: 59, end: 61 }],
      transcribe: async (chunk) => {
        requests.push(chunk.file)
        if (chunk.file === 'parent.mp3') return {
          status: 'failed' as const,
          error: '识别结果出现异常循环',
          attempts: 2,
          errorAttempts: 2,
          rateLimitWaits: 0,
          failure: { disposition: 'content' as const, fingerprint: 'degenerate-repetition', message: '识别结果出现异常循环' },
        }
        return { status: 'success' as const, value: chunk.file === 'left.mp3' ? '左半段。' : '右半段。', attempts: 1, errorAttempts: 0, rateLimitWaits: 0 }
      },
      split: async (_chunk, plan) => [
        { file: 'left.mp3', start: 0, end: plan.splitAt, overlapWithPrevious: 0 },
        { file: 'right.mp3', start: plan.splitAt, end: 120, overlapWithPrevious: plan.overlapPadding * 2 },
      ],
    })

    expect(requests).toEqual(['parent.mp3', 'left.mp3', 'right.mp3'])
    expect(recovered.map((chunk) => chunk.text)).toEqual(['左半段。', '右半段。'])
    expect(recovered.map((chunk) => chunk.start)).toEqual([0, 60])
  })

  it('keeps an unrecoverable quality failure local after reaching the split-depth limit', async () => {
    const chunk: RecoverableAudioChunk = { file: 'leaf.mp3', start: 0, end: 90, overlapWithPrevious: 0 }
    let splitCalls = 0
    const recovered = await recoverTranscriptChunk({
      chunk,
      depth: 2,
      silences: [{ start: 44, end: 46 }],
      transcribe: async () => ({
        status: 'failed' as const,
        error: '识别结果出现异常循环',
        attempts: 2,
        errorAttempts: 2,
        rateLimitWaits: 0,
        failure: {
          disposition: 'content' as const,
          fingerprint: 'degenerate-repetition',
          message: '识别结果出现异常循环',
        },
      }),
      split: async () => {
        splitCalls += 1
        throw new Error('should not split past the recovery depth limit')
      },
    })

    expect(splitCalls).toBe(0)
    expect(recovered).toEqual([{
      start: 0,
      end: 90,
      overlapWithPrevious: 0,
      text: '',
      status: 'failed',
      error: '识别结果出现异常循环，自动重试和重新切分后仍未恢复',
      attempts: 2,
      rateLimitWaits: 0,
    }])
  })
})
