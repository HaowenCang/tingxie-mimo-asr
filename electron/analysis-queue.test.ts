import { describe, expect, it, vi } from 'vitest'
import { BackgroundAnalysisQueue, type BackgroundAnalysisJob } from './analysis-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function nextTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function job(transcriptId: string, revision = 0): BackgroundAnalysisJob {
  return {
    transcriptId,
    sourceRevision: revision,
    providerId: 'provider',
    origin: 'automatic',
    status: 'queued',
    attempts: 0,
    queuedAt: '2026-07-27T00:00:00.000Z',
  }
}

describe('background analysis queue', () => {
  it('deduplicates transcript revisions and runs one analysis at a time', async () => {
    const first = deferred<void>()
    const active: string[] = []
    let peak = 0
    const started: string[] = []
    const queue = new BackgroundAnalysisQueue({
      run: async (entry) => {
        active.push(entry.transcriptId)
        peak = Math.max(peak, active.length)
        started.push(entry.transcriptId)
        if (entry.transcriptId === 'first') await first.promise
        active.splice(active.indexOf(entry.transcriptId), 1)
      },
    })

    expect(queue.enqueue(job('first'))).toBe(true)
    expect(queue.enqueue(job('first'))).toBe(false)
    expect(queue.enqueue(job('second'))).toBe(true)
    await nextTurn()
    expect(started).toEqual(['first'])

    first.resolve()
    await queue.whenIdle()
    expect(started).toEqual(['first', 'second'])
    expect(peak).toBe(1)
  })

  it('restores interrupted work as queued without automatically retrying terminal failures', async () => {
    const started: string[] = []
    const queue = new BackgroundAnalysisQueue({
      run: async (entry) => { started.push(entry.transcriptId) },
    })

    queue.restore([
      { ...job('interrupted'), status: 'running' },
      { ...job('waiting'), status: 'queued' },
      { ...job('failed'), status: 'failed', error: 'invalid provider' },
    ])
    await queue.whenIdle()

    expect(started).toEqual(['interrupted', 'waiting'])
    expect(queue.snapshot().jobs).toEqual([
      expect.objectContaining({ transcriptId: 'failed', status: 'failed' }),
    ])
  })

  it('retries transient failures with bounded attempts and persists state changes', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { retryable: true }))
      .mockResolvedValue(undefined)
    const snapshots: BackgroundAnalysisJob[][] = []
    const queue = new BackgroundAnalysisQueue({
      run,
      retryDelay: () => 0,
      persist: async (jobs) => { snapshots.push(jobs) },
    })

    queue.enqueue(job('retry'))
    await queue.whenIdle()

    expect(run).toHaveBeenCalledTimes(2)
    expect(queue.snapshot().jobs).toEqual([])
    expect(snapshots.some((items) => items.some((entry) => entry.status === 'retry-wait'))).toBe(true)
  })

  it('pauses automatic backlog while still allowing a manual request to run', async () => {
    const started: string[] = []
    const queue = new BackgroundAnalysisQueue({
      run: async (entry) => { started.push(entry.transcriptId) },
    })
    queue.setAutomaticEnabled(false)
    queue.enqueue(job('automatic'))
    queue.enqueue({ ...job('manual'), origin: 'manual' })

    await queue.whenIdle()
    expect(started).toEqual(['manual'])
    expect(queue.snapshot().jobs).toEqual([
      expect.objectContaining({ transcriptId: 'automatic', status: 'queued' }),
    ])
  })

  it('places a manual request ahead of queued automatic work', async () => {
    const gate = deferred<void>()
    const started: string[] = []
    const queue = new BackgroundAnalysisQueue({
      run: async (entry) => {
        started.push(entry.transcriptId)
        if (entry.transcriptId === 'active') await gate.promise
      },
    })
    queue.enqueue(job('active'))
    queue.enqueue(job('automatic'))
    queue.enqueue({ ...job('manual'), origin: 'manual' }, false, true)
    await nextTurn()
    gate.resolve()
    await queue.whenIdle()

    expect(started).toEqual(['active', 'manual', 'automatic'])
  })

  it('does not replace an active analysis when the user requests the same revision again', async () => {
    const gate = deferred<void>()
    const started: string[] = []
    const queue = new BackgroundAnalysisQueue({
      run: async (entry) => {
        started.push(entry.transcriptId)
        await gate.promise
      },
    })
    queue.enqueue(job('active'))
    await nextTurn()

    expect(queue.enqueue({ ...job('active'), origin: 'manual' }, true, true)).toBe(false)
    expect(queue.snapshot().jobs).toEqual([
      expect.objectContaining({ transcriptId: 'active', status: 'running', attempts: 1 }),
    ])

    gate.resolve()
    await queue.whenIdle()
    expect(started).toEqual(['active'])
  })
})
