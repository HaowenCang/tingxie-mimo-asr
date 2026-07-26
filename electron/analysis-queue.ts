import type { BackgroundAnalysisJob, BackgroundAnalysisQueueSnapshot } from './types'
export type { BackgroundAnalysisJob, BackgroundAnalysisQueueSnapshot } from './types'

interface BackgroundAnalysisQueueOptions {
  run(job: BackgroundAnalysisJob): Promise<void>
  persist?(jobs: BackgroundAnalysisJob[]): Promise<void>
  onChange?(snapshot: BackgroundAnalysisQueueSnapshot): void
  retryDelay?(attempt: number): number
  maxAttempts?: number
}

function cloneJobs(jobs: BackgroundAnalysisJob[]): BackgroundAnalysisJob[] {
  return jobs.map((job) => ({ ...job }))
}

function isRetryable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'retryable' in error && (error as { retryable?: unknown }).retryable === true)
}

function isBlocked(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'blocked' in error && (error as { blocked?: unknown }).blocked === true)
}

function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return undefined
  const value = Number((error as { retryAfterMs?: unknown }).retryAfterMs)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

export class BackgroundAnalysisQueue {
  private jobs: BackgroundAnalysisJob[] = []
  private running = false
  private automaticEnabled = true
  private idleWaiters = new Set<() => void>()

  constructor(private readonly options: BackgroundAnalysisQueueOptions) {}

  enqueue(input: BackgroundAnalysisJob, force = false, prioritize = false): boolean {
    const existing = this.jobs.find((job) => job.transcriptId === input.transcriptId && job.sourceRevision === input.sourceRevision)
    if (existing?.status === 'running') return false
    if (existing && !force) return false
    if (existing) this.jobs.splice(this.jobs.indexOf(existing), 1)
    const queued = { ...input, status: 'queued' as const, attempts: force ? 0 : input.attempts }
    if (prioritize) {
      const runningIndex = this.jobs.findIndex((job) => job.status !== 'running')
      if (runningIndex < 0) this.jobs.push(queued)
      else this.jobs.splice(runningIndex, 0, queued)
    } else {
      this.jobs.push(queued)
    }
    this.changed()
    this.pump()
    return true
  }

  restore(input: BackgroundAnalysisJob[]): void {
    this.jobs = input.map((job) => job.status === 'running' || job.status === 'retry-wait'
      ? { ...job, status: 'queued', nextRetryAt: undefined }
      : { ...job })
    this.changed()
    this.pump()
  }

  setAutomaticEnabled(enabled: boolean): void {
    this.automaticEnabled = enabled
    if (enabled) this.pump()
    else this.resolveIdle()
  }

  remove(transcriptId: string): void {
    const next = this.jobs.filter((job) => job.transcriptId !== transcriptId || job.status === 'running')
    if (next.length === this.jobs.length) return
    this.jobs = next
    this.changed()
    this.resolveIdle()
  }

  retry(transcriptId: string, origin?: BackgroundAnalysisJob['origin']): boolean {
    const job = this.jobs.find((entry) => entry.transcriptId === transcriptId && (entry.status === 'failed' || entry.status === 'blocked'))
    if (!job) return false
    job.status = 'queued'
    if (origin) job.origin = origin
    job.attempts = 0
    job.error = undefined
    job.nextRetryAt = undefined
    this.changed()
    this.pump()
    return true
  }

  snapshot(): BackgroundAnalysisQueueSnapshot {
    return {
      jobs: cloneJobs(this.jobs),
      activeTranscriptId: this.jobs.find((job) => job.status === 'running')?.transcriptId,
    }
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  private pump(): void {
    if (this.running) {
      this.resolveIdle()
      return
    }
    const job = this.jobs.find((entry) => entry.status === 'queued' && (entry.origin === 'manual' || this.automaticEnabled))
    if (!job) {
      this.resolveIdle()
      return
    }
    this.running = true
    job.status = 'running'
    job.attempts += 1
    this.changed()
    void this.run(job)
  }

  private async run(job: BackgroundAnalysisJob): Promise<void> {
    try {
      await this.options.run({ ...job })
      this.jobs = this.jobs.filter((entry) => entry !== job)
    } catch (error) {
      job.error = error instanceof Error ? error.message : '智能速览生成失败'
      const maxAttempts = this.options.maxAttempts ?? 3
      if (isBlocked(error)) {
        job.status = 'blocked'
      } else if (isRetryable(error) && job.attempts < maxAttempts) {
        const delay = retryAfterMs(error)
          ?? this.options.retryDelay?.(job.attempts)
          ?? Math.min(60_000, 2 ** (job.attempts - 1) * 1_000)
        job.status = 'retry-wait'
        job.nextRetryAt = new Date(Date.now() + delay).toISOString()
        this.changed()
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        if (job.status === 'retry-wait') {
          job.status = 'queued'
          job.nextRetryAt = undefined
        }
      } else {
        job.status = 'failed'
      }
    } finally {
      this.running = false
      this.changed()
      this.pump()
    }
  }

  private changed(): void {
    const snapshot = this.snapshot()
    this.options.onChange?.(snapshot)
    void this.options.persist?.(snapshot.jobs).catch(() => undefined)
  }

  private isIdle(): boolean {
    return !this.running && !this.jobs.some((job) =>
      job.status === 'running'
      || (job.status === 'queued' || job.status === 'retry-wait') && (job.origin === 'manual' || this.automaticEnabled))
  }

  private resolveIdle(): void {
    if (!this.isIdle()) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }
}
