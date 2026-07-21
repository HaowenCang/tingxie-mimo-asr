import { describe, expect, it } from 'vitest'
import type { QueueFile } from '../types'
import { changedQueueFile, isNearQueueBottom } from './queue-follow'

const file = (id: string, progress: number, detail?: string): QueueFile => ({ id, name: `${id}.wav`, path: id, size: 1, duration: 1, status: 'transcribing', progress, detail })

describe('queue follow helpers', () => {
  it('identifies the task whose status detail changed', () => {
    const before = [file('a', 10), file('b', 20)]
    const after = [file('a', 10), file('b', 21, '正在识别第 2 段')]
    expect(changedQueueFile(before, after)?.id).toBe('b')
  })

  it('only follows automatically near the current bottom', () => {
    expect(isNearQueueBottom({ scrollTop: 445, clientHeight: 500, scrollHeight: 1_000 } as HTMLElement)).toBe(true)
    expect(isNearQueueBottom({ scrollTop: 100, clientHeight: 500, scrollHeight: 1_000 } as HTMLElement)).toBe(false)
  })
})
