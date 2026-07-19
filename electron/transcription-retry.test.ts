import { describe, expect, it, vi } from 'vitest'
import { isPermanentQuotaError, runChunkWithRetry, type RetryFailure } from './transcription-retry'

function failure(fingerprint: string, disposition: RetryFailure['disposition'] = 'transient'): RetryFailure {
  return { disposition, fingerprint, message: fingerprint }
}

describe('chunk transcription retry policy', () => {
  it('distinguishes exhausted account quota from temporary RPM throttling', () => {
    expect(isPermanentQuotaError(429, 'Token Plan 额度已耗尽')).toBe(true)
    expect(isPermanentQuotaError(429, 'Too many requests, please retry later')).toBe(false)
  })

  it('does not spend the chunk error budget on RPM throttling', async () => {
    let requests = 0
    const waits: number[] = []
    const outcome = await runChunkWithRetry({
      attempt: async () => {
        requests += 1
        if (requests <= 2) throw new Error('rate limited')
        return 'transcript'
      },
      classify: () => ({ disposition: 'rate-limit', fingerprint: '429|rate-limit', message: '请求过于频繁', status: 429, retryAfterMs: 2000 }),
      delayFor: (_attempt, retryAfterMs) => retryAfterMs ?? 0,
      wait: async (delayMs) => { waits.push(delayMs) },
    })

    expect(outcome).toEqual({ status: 'success', value: 'transcript', attempts: 3, errorAttempts: 0, rateLimitWaits: 2 })
    expect(requests).toBe(3)
    expect(waits).toEqual([2000, 2000])
  })

  it('counts only real failures when throttling and network errors are interleaved', async () => {
    const sequence: RetryFailure[] = [
      { disposition: 'rate-limit', fingerprint: '429', message: 'rate', status: 429 },
      { disposition: 'transient', fingerprint: 'network-a', message: 'network' },
      { disposition: 'rate-limit', fingerprint: '429', message: 'rate', status: 429 },
    ]
    let request = 0
    const outcome = await runChunkWithRetry({
      attempt: async () => {
        const failure = sequence[request++]
        if (failure) throw failure
        return 'ok'
      },
      classify: (error) => error as RetryFailure,
      delayFor: () => 0,
      wait: async () => undefined,
    })

    expect(outcome).toEqual({ status: 'success', value: 'ok', attempts: 4, errorAttempts: 1, rateLimitWaits: 2 })
  })

  it('stops after the same normalized error occurs twice', async () => {
    const wait = vi.fn(async () => undefined)
    const outcome = await runChunkWithRetry({
      attempt: async () => { throw new Error('same') },
      classify: () => failure('503|busy', 'pressure'),
      delayFor: () => 1000,
      wait,
    })
    expect(outcome).toEqual({ status: 'failed', error: '503|busy', attempts: 2, errorAttempts: 2, rateLimitWaits: 0, failure: failure('503|busy', 'pressure') })
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('returns the terminal failure so the caller can choose a content recovery path', async () => {
    const outcome = await runChunkWithRetry({
      attempt: async () => { throw new Error('loop') },
      classify: () => failure('degenerate-repetition', 'content'),
      delayFor: () => 0,
      wait: async () => undefined,
    })

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: { disposition: 'content', fingerprint: 'degenerate-repetition' },
    })
  })

  it('tries at most four times when failures keep changing', async () => {
    const fingerprints = ['a', 'b', 'c', 'd']
    let attempts = 0
    const outcome = await runChunkWithRetry({
      attempt: async () => { throw new Error(fingerprints[attempts++]) },
      classify: (error) => failure((error as Error).message),
      delayFor: () => 0,
      wait: async () => undefined,
    })
    expect(outcome).toEqual({ status: 'failed', error: 'd', attempts: 4, errorAttempts: 4, rateLimitWaits: 0, failure: failure('d') })
  })

  it('returns a later success with the total attempt count', async () => {
    let attempts = 0
    const outcome = await runChunkWithRetry({
      attempt: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary')
        return '转写成功'
      },
      classify: () => failure('temporary'),
      delayFor: () => 0,
      wait: async () => undefined,
    })
    expect(outcome).toEqual({ status: 'success', value: '转写成功', attempts: 2, errorAttempts: 1, rateLimitWaits: 0 })
  })

  it('rethrows job-wide failures immediately', async () => {
    const error = new Error('API Key 无效')
    await expect(runChunkWithRetry({
      attempt: async () => { throw error },
      classify: () => failure('401|invalid-key', 'global'),
      delayFor: () => 0,
      wait: async () => undefined,
    })).rejects.toBe(error)
  })
})
