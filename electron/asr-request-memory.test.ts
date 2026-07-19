import { describe, expect, it } from 'vitest'
import { AsyncByteBudget, calculateAsrMemoryBudget, withAsrRequestAdmission } from './asr-request-memory'

describe('ASR request memory admission', () => {
  it('does not prepare a payload until rate and byte admission are granted', async () => {
    const events: string[] = []
    let allowRate!: () => void
    const ratePermission = new Promise<void>((resolve) => { allowRate = resolve })
    const budget = new AsyncByteBudget(10)
    const firstRelease = await budget.acquire(8)

    const result = withAsrRequestAdmission({
      waitForRate: async () => { events.push('rate-wait'); await ratePermission; events.push('rate-ready') },
      budget,
      estimatedBytes: 4,
      prepare: async () => { events.push('prepared'); return 'payload' },
      execute: async (payload) => { events.push(`sent:${payload}`); return 'ok' },
    })

    await Promise.resolve()
    expect(events).toEqual(['rate-wait'])
    allowRate()
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['rate-wait', 'rate-ready'])
    firstRelease()
    await expect(result).resolves.toBe('ok')
    expect(events).toEqual(['rate-wait', 'rate-ready', 'prepared', 'sent:payload'])
    expect(budget.availableBytes).toBe(10)
  })

  it('removes a cancelled waiter without consuming byte capacity', async () => {
    const budget = new AsyncByteBudget(10)
    const firstRelease = await budget.acquire(10)
    const controller = new AbortController()
    const waiting = budget.acquire(5, controller.signal)

    controller.abort()
    await expect(waiting).rejects.toThrow('任务已取消')
    firstRelease()
    const nextRelease = await budget.acquire(10)
    expect(budget.availableBytes).toBe(0)
    nextRelease()
  })

  it('keeps the default budget between 128 and 192 MiB', () => {
    expect(calculateAsrMemoryBudget(512 * 1024 * 1024)).toBe(128 * 1024 * 1024)
    expect(calculateAsrMemoryBudget(8 * 1024 * 1024 * 1024)).toBe(192 * 1024 * 1024)
  })

  it('bounds 30 admitted payloads by estimated bytes instead of task count', async () => {
    const budget = new AsyncByteBudget(100)
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 30 }, () => withAsrRequestAdmission({
      waitForRate: async () => undefined,
      budget,
      estimatedBytes: 25,
      prepare: async () => 'payload',
      execute: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active -= 1
        return true
      },
    })))

    expect(peak).toBe(4)
    expect(budget.availableBytes).toBe(100)
  })
})
