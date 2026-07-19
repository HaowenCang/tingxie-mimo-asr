export const DOCUMENTED_ASR_RPM = 100
export const SAFE_ASR_RPM = 90

export class AdaptiveConcurrencyController {
  private cooldownUntil = 0
  private concurrency: number
  private readonly latencySamples: number[] = []

  constructor(private readonly enabled: boolean, initialConcurrency = 10) {
    this.concurrency = enabled ? Math.max(1, Math.floor(initialConcurrency)) : 1
  }

  get current(): number {
    return this.enabled ? this.concurrency : 1
  }

  reportSuccess(latencyMs: number, requestsPerMinute: number, now = Date.now()): void {
    if (!this.enabled || now < this.cooldownUntil) return
    if (Number.isFinite(latencyMs) && latencyMs > 0) {
      this.latencySamples.push(latencyMs)
      if (this.latencySamples.length > 20) this.latencySamples.shift()
    }
    const ordered = [...this.latencySamples].sort((left, right) => left - right)
    const p90 = ordered[Math.max(0, Math.ceil(ordered.length * 0.9) - 1)] || latencyMs
    const desired = Math.max(1, Math.ceil(Math.max(1, requestsPerMinute) * Math.max(1, p90) / 60_000) + 1)
    if (desired > this.concurrency) {
      this.concurrency += Math.max(2, Math.ceil((desired - this.concurrency) / 2))
    }
  }

  reportTransientFailure(): void {
    if (!this.enabled) return
    this.concurrency = Math.max(1, this.concurrency - 1)
  }

  reportPressure(cooldownMs: number, now = Date.now()): void {
    if (!this.enabled) return
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2))
    this.cooldownUntil = Math.max(this.cooldownUntil, now + Math.max(0, cooldownMs))
  }
}

export class RequestRateLimiter {
  private nextStartAt = 0
  private blockedUntil = 0
  private requestsPerMinute: number
  private lastIncreaseAt: number

  constructor(
    requestsPerMinute = SAFE_ASR_RPM,
    private readonly maximumRpm = 92,
    now = Date.now(),
  ) {
    this.requestsPerMinute = Math.min(maximumRpm, Math.max(1, Math.floor(requestsPerMinute)))
    this.lastIncreaseAt = now
  }

  get currentRpm(): number {
    return this.requestsPerMinute
  }

  get intervalMs(): number {
    return Math.ceil(60_000 / this.requestsPerMinute)
  }

  reportSuccess(now = Date.now()): void {
    if (now < this.blockedUntil || now - this.lastIncreaseAt < 30_000) return
    this.requestsPerMinute = Math.min(this.maximumRpm, this.requestsPerMinute + 2)
    this.lastIncreaseAt = now
  }

  reportRateLimit(cooldownMs: number, now = Date.now()): void {
    this.requestsPerMinute = Math.max(1, Math.round(this.requestsPerMinute * 0.7))
    this.blockedUntil = Math.max(this.blockedUntil, now + Math.max(0, cooldownMs))
    this.lastIncreaseAt = this.blockedUntil
  }

  reportServicePressure(cooldownMs: number, now = Date.now()): void {
    this.requestsPerMinute = Math.max(1, Math.round(this.requestsPerMinute * 0.85))
    this.blockedUntil = Math.max(this.blockedUntil, now + Math.max(0, cooldownMs))
    this.lastIncreaseAt = this.blockedUntil
  }

  isBlocked(now = Date.now()): boolean {
    return now < this.blockedUntil
  }

  reserve(now = Date.now()): number {
    const startAt = Math.max(now, this.nextStartAt, this.blockedUntil)
    this.nextStartAt = startAt + this.intervalMs
    return Math.max(0, startAt - now)
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - now)
}

export function retryDelay(attempt: number, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined) return retryAfterMs
  const exponential = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt))
  return exponential + Math.floor(random() * 500)
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal.aborted) return Promise.reject(new Error('任务已取消'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('任务已取消'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function runAdaptivePool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  controller: AdaptiveConcurrencyController,
  onProgress?: (completed: number, total: number, concurrency: number) => void,
): Promise<R[]> {
  if (!items.length) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let active = 0
  let completed = 0
  let failure: unknown

  return new Promise<R[]>((resolve, reject) => {
    const settle = () => {
      if (failure && active === 0) reject(failure)
      else if (!failure && completed === items.length) resolve(results)
    }

    const pump = () => {
      if (failure) {
        settle()
        return
      }
      while (active < controller.current && nextIndex < items.length) {
        const index = nextIndex++
        active += 1
        void worker(items[index], index).then((result) => {
          results[index] = result
          completed += 1
          onProgress?.(completed, items.length, controller.current)
        }).catch((error: unknown) => {
          failure ??= error
        }).finally(() => {
          active -= 1
          pump()
          settle()
        })
      }
      settle()
    }

    pump()
  })
}
