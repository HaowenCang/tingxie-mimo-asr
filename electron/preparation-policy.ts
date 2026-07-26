import type { PreparationMode } from './types'

interface PreparationPolicyInput {
  preparationMode?: unknown
  preparationConcurrency?: unknown
  parallelPreparation?: unknown
}

export interface NormalizedPreparationPolicy {
  preparationMode: PreparationMode
  preparationConcurrency: number
}

const PREPARATION_MODES = new Set<PreparationMode>(['sequential', 'fixed', 'unlimited'])

export function normalizePreparationPolicy(input: PreparationPolicyInput): NormalizedPreparationPolicy {
  const requestedMode = typeof input.preparationMode === 'string' && PREPARATION_MODES.has(input.preparationMode as PreparationMode)
    ? input.preparationMode as PreparationMode
    : input.parallelPreparation === false ? 'sequential' : 'fixed'
  const numeric = Number(input.preparationConcurrency)
  const preparationConcurrency = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 3
  return { preparationMode: requestedMode, preparationConcurrency }
}
