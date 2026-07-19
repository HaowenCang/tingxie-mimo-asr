export type RetryDisposition = 'global' | 'rate-limit' | 'pressure' | 'transient' | 'content'

export interface RetryFailure {
  disposition: RetryDisposition
  fingerprint: string
  message: string
  status?: number
  retryAfterMs?: number
  retryable?: boolean
}

export function isPermanentQuotaError(status: number, message: string, code = ''): boolean {
  if (status !== 402 && status !== 429) return false
  return /(quota|credit|balance|insufficient[_ -]?(quota|credit|balance)|额度|配额|余额|套餐).*(exhaust|deplet|insufficient|用尽|耗尽|不足|欠费)|(exhaust|deplet|用尽|耗尽|不足).*(quota|credit|balance|额度|配额|余额|套餐)/i.test(`${code} ${message}`)
}

export type ChunkRetryOutcome<T> =
  | { status: 'success'; value: T; attempts: number; errorAttempts: number; rateLimitWaits: number }
  | { status: 'failed'; error: string; attempts: number; errorAttempts: number; rateLimitWaits: number; failure: RetryFailure }

interface ChunkRetryOptions<T> {
  attempt(attempt: number): Promise<T>
  classify(error: unknown): RetryFailure
  delayFor(attempt: number, retryAfterMs?: number): number
  wait(delayMs: number): Promise<void>
  onFailure?(failure: RetryFailure, attempt: number, delayMs: number): void
  maxAttempts?: number
  identicalErrorLimit?: number
}

export async function runChunkWithRetry<T>({
  attempt,
  classify,
  delayFor,
  wait,
  onFailure,
  maxAttempts = 4,
  identicalErrorLimit = 2,
}: ChunkRetryOptions<T>): Promise<ChunkRetryOutcome<T>> {
  const fingerprints = new Map<string, number>()
  let requestAttempts = 0
  let errorAttempts = 0
  let rateLimitWaits = 0

  while (true) {
    requestAttempts += 1
    try {
      return { status: 'success', value: await attempt(requestAttempts), attempts: requestAttempts, errorAttempts, rateLimitWaits }
    } catch (error) {
      const failure = classify(error)
      if (failure.disposition === 'global') throw error
      if (failure.disposition === 'rate-limit') {
        rateLimitWaits += 1
        const delayMs = delayFor(rateLimitWaits - 1, failure.retryAfterMs)
        onFailure?.(failure, requestAttempts, delayMs)
        await wait(delayMs)
        continue
      }

      errorAttempts += 1
      const occurrences = (fingerprints.get(failure.fingerprint) || 0) + 1
      fingerprints.set(failure.fingerprint, occurrences)
      const exhausted = errorAttempts >= maxAttempts
        || occurrences >= identicalErrorLimit
        || failure.retryable === false
      const delayMs = exhausted ? 0 : delayFor(errorAttempts - 1, failure.retryAfterMs)
      onFailure?.(failure, requestAttempts, delayMs)
      if (exhausted) return { status: 'failed', error: failure.message, attempts: requestAttempts, errorAttempts, rateLimitWaits, failure }
      await wait(delayMs)
    }
  }
}
