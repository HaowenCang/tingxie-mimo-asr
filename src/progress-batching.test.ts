import { describe, expect, it } from 'vitest'
import type { ProgressEvent } from '../electron/types'
import type { QueueFile } from './types'
import { applyLatestProgressEvents } from './progress-batching'

describe('progress event batching', () => {
  it('keeps the latest event for every file in the same animation frame', () => {
    const files: QueueFile[] = [
      { id: 'first', name: 'first.mp3', path: 'first.mp3', size: 1, duration: 1, status: 'waiting', progress: 0 },
      { id: 'second', name: 'second.mp3', path: 'second.mp3', size: 1, duration: 1, status: 'waiting', progress: 0 },
    ]
    const events: ProgressEvent[] = [
      { id: 'first', stage: 'extracting', progress: 20, detail: 'first-old' },
      { id: 'second', stage: 'transcribing', progress: 40, detail: 'second' },
      { id: 'first', stage: 'transcribing', progress: 60, detail: 'first-latest' },
    ]

    const updated = applyLatestProgressEvents(files, events)

    expect(updated.map(({ id, status, progress, detail }) => ({ id, status, progress, detail }))).toEqual([
      { id: 'first', status: 'transcribing', progress: 60, detail: 'first-latest' },
      { id: 'second', status: 'transcribing', progress: 40, detail: 'second' },
    ])
  })
})
