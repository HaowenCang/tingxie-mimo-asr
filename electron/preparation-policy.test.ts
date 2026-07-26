import { describe, expect, it } from 'vitest'
import { normalizePreparationPolicy } from './preparation-policy'

describe('preparation policy preferences', () => {
  it('preserves arbitrary positive fixed concurrency values', () => {
    expect(normalizePreparationPolicy({ preparationMode: 'fixed', preparationConcurrency: 37 })).toEqual({
      preparationMode: 'fixed',
      preparationConcurrency: 37,
    })
  })

  it('represents unlimited preparation without a numeric sentinel', () => {
    expect(normalizePreparationPolicy({ preparationMode: 'unlimited', preparationConcurrency: 12 })).toEqual({
      preparationMode: 'unlimited',
      preparationConcurrency: 12,
    })
  })

  it('migrates the legacy parallel switch and rejects invalid fixed values', () => {
    expect(normalizePreparationPolicy({ parallelPreparation: false, preparationConcurrency: 4 })).toEqual({
      preparationMode: 'sequential',
      preparationConcurrency: 4,
    })
    expect(normalizePreparationPolicy({ parallelPreparation: true, preparationConcurrency: Number.NaN })).toEqual({
      preparationMode: 'fixed',
      preparationConcurrency: 3,
    })
  })
})
