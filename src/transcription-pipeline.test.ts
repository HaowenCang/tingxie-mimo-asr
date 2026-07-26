import { describe, expect, it } from 'vitest'
import { TranscriptionPipeline } from './transcription-pipeline'

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

describe('transcription pipeline', () => {
  it('prepares three media in parallel but transcribes them one at a time in queue order', async () => {
    const preparations = new Map(['1', '2', '3'].map((id) => [id, deferred<string>()]))
    const transcriptions = new Map(['1', '2', '3'].map((id) => [id, deferred<string>()]))
    const preparing: string[] = []
    const transcribing: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 3,
      prepare: async (job) => {
        preparing.push(job.id)
        return preparations.get(job.id)!.promise
      },
      transcribe: async (job) => {
        transcribing.push(job.id)
        return transcriptions.get(job.id)!.promise
      },
    })

    pipeline.enqueue([{ id: '1' }, { id: '2' }, { id: '3' }])
    await nextTurn()
    expect(preparing).toEqual(['1', '2', '3'])

    preparations.get('3')!.resolve('prepared-3')
    preparations.get('2')!.resolve('prepared-2')
    await nextTurn()
    expect(transcribing).toEqual([])

    preparations.get('1')!.resolve('prepared-1')
    await nextTurn()
    expect(transcribing).toEqual(['1'])

    transcriptions.get('1')!.resolve('result-1')
    await nextTurn()
    expect(transcribing).toEqual(['1', '2'])

    transcriptions.get('2')!.resolve('result-2')
    await nextTurn()
    expect(transcribing).toEqual(['1', '2', '3'])

    transcriptions.get('3')!.resolve('result-3')
    await pipeline.whenIdle()
  })

  it('cancels waiting and preparing jobs without allowing them to reach the API stage', async () => {
    const started: string[] = []
    const transcribed: string[] = []
    const preparation = deferred<string>()
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 1,
      prepare: async (job, signal) => {
        started.push(job.id)
        signal.addEventListener('abort', () => preparation.reject(new DOMException('cancelled', 'AbortError')), { once: true })
        return preparation.promise
      },
      transcribe: async (job) => {
        transcribed.push(job.id)
        return 'done'
      },
    })

    pipeline.enqueue([{ id: '1' }, { id: '2' }])
    await nextTurn()
    expect(started).toEqual(['1'])
    expect(pipeline.cancel('2')).toBe(true)
    expect(pipeline.cancel('1')).toBe(true)
    await pipeline.whenIdle()

    expect(started).toEqual(['1'])
    expect(transcribed).toEqual([])
  })

  it('discards prepared artifacts when a ready job is cancelled', async () => {
    const firstTranscription = deferred<string>()
    const discarded: string[] = []
    const transcribed: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 2,
      prepare: async (job) => `prepared-${job.id}`,
      transcribe: async (job) => {
        transcribed.push(job.id)
        return job.id === '1' ? firstTranscription.promise : `result-${job.id}`
      },
      discardPrepared: async (job) => { discarded.push(job.id) },
    })

    pipeline.enqueue([{ id: '1' }, { id: '2' }])
    await nextTurn()
    expect(transcribed).toEqual(['1'])
    expect(pipeline.cancel('2')).toBe(true)
    expect(discarded).toEqual(['2'])

    firstTranscription.resolve('result-1')
    await pipeline.whenIdle()
    expect(transcribed).toEqual(['1'])
  })

  it('keeps only the current API job and the next two jobs prepared', async () => {
    const firstTranscription = deferred<string>()
    const preparing: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 3,
      preparationWindow: 3,
      prepare: async (job) => {
        preparing.push(job.id)
        return `prepared-${job.id}`
      },
      transcribe: async (job) => job.id === '1' ? firstTranscription.promise : `result-${job.id}`,
    })

    pipeline.enqueue([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }])
    await nextTurn()
    expect(preparing).toEqual(['1', '2', '3'])

    firstTranscription.resolve('result-1')
    await nextTurn()
    expect(preparing).toContain('4')
    await pipeline.whenIdle()
  })

  it('applies a changed preparation policy to waiting jobs immediately', async () => {
    const gates = new Map(['1', '2', '3'].map((id) => [id, deferred<string>()]))
    const preparing: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 1,
      prepare: async (job) => {
        preparing.push(job.id)
        return gates.get(job.id)!.promise
      },
      transcribe: async (job) => `result-${job.id}`,
    })

    pipeline.enqueue([{ id: '1' }, { id: '2' }, { id: '3' }])
    await nextTurn()
    expect(preparing).toEqual(['1'])

    pipeline.setPreparationPolicy(3, 3)
    await nextTurn()
    expect(preparing).toEqual(['1', '2', '3'])

    gates.forEach((gate) => gate.resolve('prepared'))
    await pipeline.whenIdle()
  })

  it('accepts arbitrary fixed preparation concurrency without imposing a product cap', async () => {
    const gates = new Map(Array.from({ length: 8 }, (_, index) => {
      const id = String(index + 1)
      return [id, deferred<string>()] as const
    }))
    const preparing: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 1,
      prepare: async (job) => {
        preparing.push(job.id)
        return gates.get(job.id)!.promise
      },
      transcribe: async (job) => `result-${job.id}`,
    })

    pipeline.enqueue([...gates.keys()].map((id) => ({ id })))
    pipeline.setPreparationPolicy(7)
    await nextTurn()
    expect(preparing).toEqual(['1', '2', '3', '4', '5', '6', '7'])

    gates.forEach((gate) => gate.resolve('prepared'))
    await pipeline.whenIdle()
  })

  it('prepares every queued media in unlimited mode while keeping the API channel sequential', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => String(index + 1))
    const preparations = new Map(ids.map((id) => [id, deferred<string>()]))
    const firstTranscription = deferred<string>()
    const preparing: string[] = []
    const transcribing: string[] = []
    const pipeline = new TranscriptionPipeline({
      preparationConcurrency: 'unlimited',
      prepare: async (job) => {
        preparing.push(job.id)
        return preparations.get(job.id)!.promise
      },
      transcribe: async (job) => {
        transcribing.push(job.id)
        return job.id === '1' ? firstTranscription.promise : `result-${job.id}`
      },
    })

    pipeline.enqueue(ids.map((id) => ({ id })))
    await nextTurn()
    expect(preparing).toEqual(ids)

    preparations.forEach((gate) => gate.resolve('prepared'))
    await nextTurn()
    expect(transcribing).toEqual(['1'])

    firstTranscription.resolve('result-1')
    await pipeline.whenIdle()
    expect(transcribing).toEqual(ids)
  })
})
