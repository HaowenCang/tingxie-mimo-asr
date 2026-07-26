export interface TranscriptionPipelineJob {
  id: string
}

export type TranscriptionPipelineStatus =
  | 'waiting-preparation'
  | 'preparing'
  | 'ready'
  | 'transcribing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface TranscriptionPipelineEvent<Job, Result> {
  job: Job
  status: TranscriptionPipelineStatus
  result?: Result
  error?: unknown
}

interface TranscriptionPipelineOptions<Job extends TranscriptionPipelineJob, Prepared, Result> {
  preparationConcurrency: number
  preparationWindow?: number
  prepare(job: Job, signal: AbortSignal): Promise<Prepared>
  transcribe(job: Job, prepared: Prepared, signal: AbortSignal): Promise<Result>
  discardPrepared?(job: Job, prepared: Prepared): void | Promise<void>
  onEvent?(event: TranscriptionPipelineEvent<Job, Result>): void
}

interface PipelineTask<Job, Prepared> {
  job: Job
  status: TranscriptionPipelineStatus
  prepared?: Prepared
  controller: AbortController
}

const TERMINAL_STATUSES = new Set<TranscriptionPipelineStatus>(['done', 'error', 'cancelled'])

export class TranscriptionPipeline<Job extends TranscriptionPipelineJob, Prepared, Result> {
  private readonly tasks: Array<PipelineTask<Job, Prepared>> = []
  private readonly idleWaiters = new Set<() => void>()
  private preparing = 0
  private transcribing = false
  private preparationConcurrency: number
  private preparationWindow: number

  constructor(private readonly options: TranscriptionPipelineOptions<Job, Prepared, Result>) {
    this.preparationConcurrency = Math.max(1, Math.floor(options.preparationConcurrency))
    this.preparationWindow = Math.max(this.preparationConcurrency, Math.floor(options.preparationWindow ?? this.preparationConcurrency))
  }

  enqueue(jobs: Job[]): void {
    for (const job of jobs) {
      const task: PipelineTask<Job, Prepared> = {
        job,
        status: 'waiting-preparation',
        controller: new AbortController(),
      }
      this.tasks.push(task)
      this.emit(task)
    }
    this.pumpPreparation()
    this.pumpTranscription()
  }

  cancel(jobId: string): boolean {
    const task = this.tasks.find((candidate) => candidate.job.id === jobId && !TERMINAL_STATUSES.has(candidate.status))
    if (!task) return false
    const prepared = task.prepared
    task.status = 'cancelled'
    task.controller.abort()
    this.emit(task)
    if (prepared !== undefined && this.options.discardPrepared) {
      void Promise.resolve(this.options.discardPrepared(task.job, prepared)).catch(() => undefined)
      task.prepared = undefined
    }
    this.pumpPreparation()
    this.pumpTranscription()
    this.resolveIdle()
    return true
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  setPreparationPolicy(concurrency: number, window = concurrency): void {
    this.preparationConcurrency = Math.max(1, Math.floor(concurrency))
    this.preparationWindow = Math.max(this.preparationConcurrency, Math.floor(window))
    this.pumpPreparation()
  }

  private emit(task: PipelineTask<Job, Prepared>, result?: Result, error?: unknown) {
    this.options.onEvent?.({ job: task.job, status: task.status, result, error })
  }

  private pumpPreparation() {
    const limit = this.preparationConcurrency
    const windowSize = this.preparationWindow
    while (this.preparing < limit) {
      const task = this.tasks
        .filter((candidate) => !TERMINAL_STATUSES.has(candidate.status))
        .slice(0, windowSize)
        .find((candidate) => candidate.status === 'waiting-preparation')
      if (!task) break
      task.status = 'preparing'
      this.preparing += 1
      this.emit(task)
      void this.runPreparation(task)
    }
  }

  private async runPreparation(task: PipelineTask<Job, Prepared>) {
    try {
      task.prepared = await this.options.prepare(task.job, task.controller.signal)
      if (task.status === 'cancelled') return
      task.status = 'ready'
      this.emit(task)
    } catch (error) {
      if (task.status !== 'cancelled') {
        task.status = 'error'
        this.emit(task, undefined, error)
      }
    } finally {
      this.preparing -= 1
      this.pumpPreparation()
      this.pumpTranscription()
      this.resolveIdle()
    }
  }

  private pumpTranscription() {
    if (this.transcribing) return
    const task = this.tasks.find((candidate) => !TERMINAL_STATUSES.has(candidate.status))
    if (!task || task.status !== 'ready' || task.prepared === undefined) {
      this.resolveIdle()
      return
    }
    task.status = 'transcribing'
    this.transcribing = true
    this.emit(task)
    void this.runTranscription(task, task.prepared)
  }

  private async runTranscription(task: PipelineTask<Job, Prepared>, prepared: Prepared) {
    try {
      const result = await this.options.transcribe(task.job, prepared, task.controller.signal)
      if (task.status === 'cancelled') return
      task.status = 'done'
      this.emit(task, result)
    } catch (error) {
      if (task.status !== 'cancelled') {
        task.status = 'error'
        this.emit(task, undefined, error)
      }
    } finally {
      this.transcribing = false
      this.pumpPreparation()
      this.pumpTranscription()
      this.resolveIdle()
    }
  }

  private isIdle(): boolean {
    return this.preparing === 0
      && !this.transcribing
      && this.tasks.every((task) => TERMINAL_STATUSES.has(task.status))
  }

  private resolveIdle() {
    if (!this.isIdle()) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }
}
