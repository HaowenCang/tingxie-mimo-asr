import { describe, expect, it } from 'vitest'
import {
  AdaptiveConcurrencyController,
  RequestRateLimiter,
  parseRetryAfter,
  retryDelay,
  runAdaptivePool,
} from './adaptive-concurrency'

describe('adaptive concurrency controller', () => {
  it('starts at ten and quickly approaches the latency-derived concurrency', () => {
    const controller = new AdaptiveConcurrencyController(true)
    expect(controller.current).toBe(10)
    controller.reportSuccess(20_000, 90, 1000)
    expect(controller.current).toBeGreaterThanOrEqual(20)
  })

  it('steps down by one for transient failures', () => {
    const controller = new AdaptiveConcurrencyController(true)
    controller.reportTransientFailure()
    expect(controller.current).toBe(9)
  })

  it('halves concurrency under pressure and never drops below one', () => {
    const controller = new AdaptiveConcurrencyController(true, 9)
    controller.reportPressure(30_000, 1000)
    expect(controller.current).toBe(4)
    controller.reportPressure(30_000, 2000)
    controller.reportPressure(30_000, 3000)
    expect(controller.current).toBe(1)
  })

  it('stays sequential when adaptive concurrency is disabled', () => {
    const controller = new AdaptiveConcurrencyController(false, 20)
    for (let index = 0; index < 20; index += 1) controller.reportSuccess(1000, 90)
    expect(controller.current).toBe(1)
  })

  it('does not grow again until the pressure cooldown has elapsed', () => {
    const controller = new AdaptiveConcurrencyController(true, 8)
    controller.reportPressure(10_000, 1000)
    for (let index = 0; index < 20; index += 1) controller.reportSuccess(20_000, 90, 5000)
    expect(controller.current).toBe(4)
    controller.reportSuccess(20_000, 90, 11_001)
    expect(controller.current).toBeGreaterThan(4)
  })
})

describe('RPM limiter and retry policy', () => {
  it('leaves ten percent headroom below the documented 100 RPM limit', () => {
    const limiter = new RequestRateLimiter(90)
    expect(limiter.reserve(10_000)).toBe(0)
    expect(limiter.reserve(10_000)).toBe(667)
    expect(limiter.reserve(10_000)).toBe(1334)
  })

  it('reduces the target RPM and globally blocks starts after a rate limit', () => {
    const limiter = new RequestRateLimiter(90, 92, 0)
    limiter.reportRateLimit(5000, 1000)
    expect(limiter.currentRpm).toBe(63)
    expect(limiter.reserve(2000)).toBe(4000)
  })

  it('never schedules more than 92 starts in a rolling minute', () => {
    const limiter = new RequestRateLimiter(92, 92, 0)
    const starts = Array.from({ length: 140 }, () => limiter.reserve(0))
    for (let left = 0; left < starts.length; left += 1) {
      const count = starts.filter((start) => start >= starts[left] && start - starts[left] < 60_000).length
      expect(count).toBeLessThanOrEqual(92)
    }
  })

  it('recovers RPM gradually after a clean pressure-free window', () => {
    const limiter = new RequestRateLimiter(90, 92, 0)
    limiter.reportRateLimit(5000, 1000)
    limiter.reportSuccess(35_999)
    expect(limiter.currentRpm).toBe(63)
    limiter.reportSuccess(36_000)
    expect(limiter.currentRpm).toBe(65)
  })

  it('supports Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000)
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000)
  })

  it('uses exponential backoff with deterministic jitter', () => {
    expect(retryDelay(2, undefined, () => 0.5)).toBe(4250)
    expect(retryDelay(2, 9000, () => 0)).toBe(9000)
  })
})

describe('adaptive task pool', () => {
  it('returns results in source order even when tasks finish out of order', async () => {
    const controller = new AdaptiveConcurrencyController(true, 3)
    const results = await runAdaptivePool([30, 5, 15], async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return `result-${index}`
    }, controller)
    expect(results).toEqual(['result-0', 'result-1', 'result-2'])
  })

  it('runs strictly one task at a time when the setting is disabled', async () => {
    const controller = new AdaptiveConcurrencyController(false)
    let active = 0
    let peak = 0
    await runAdaptivePool([1, 2, 3, 4], async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return value
    }, controller)
    expect(peak).toBe(1)
  })
})
