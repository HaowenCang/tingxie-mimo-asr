import { describe, expect, it } from 'vitest'
import { planMediaImportConcurrency, shouldEmitImportProgress } from './media-import-performance'

describe('media import performance policy', () => {
  it('reduces disk and ffprobe pressure while ASR is active', () => {
    expect(planMediaImportConcurrency(16, false)).toEqual({ copy: 2, probe: 6 })
    expect(planMediaImportConcurrency(4, false)).toEqual({ copy: 2, probe: 2 })
    expect(planMediaImportConcurrency(16, true)).toEqual({ copy: 1, probe: 1 })
  })

  it('caps progress IPC traffic at about one hundred updates per stage', () => {
    const emitted = Array.from({ length: 10_001 }, (_, completed) => completed).filter((completed) => shouldEmitImportProgress(completed, 10_000))
    expect(emitted).toHaveLength(101)
    expect(emitted.at(0)).toBe(0)
    expect(emitted.at(-1)).toBe(10_000)
  })
})
