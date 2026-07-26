import type { MediaAsset } from '../electron/types'

export interface BatchTranscriptionSkipCounts {
  duplicateSelection: number
  alreadyQueued: number
  alreadyTranscribed: number
  partial: number
  failed: number
}

export interface BatchTranscriptionPlan {
  eligible: MediaAsset[]
  skipped: BatchTranscriptionSkipCounts
}

export function planBatchTranscription(
  selectedAssets: MediaAsset[],
  queuedMediaIds: ReadonlySet<string>,
  includeFailed = false,
): BatchTranscriptionPlan {
  const eligible: MediaAsset[] = []
  const seen = new Set<string>()
  const skipped: BatchTranscriptionSkipCounts = {
    duplicateSelection: 0,
    alreadyQueued: 0,
    alreadyTranscribed: 0,
    partial: 0,
    failed: 0,
  }

  for (const asset of selectedAssets) {
    if (seen.has(asset.id)) {
      skipped.duplicateSelection += 1
      continue
    }
    seen.add(asset.id)
    if (queuedMediaIds.has(asset.id)) {
      skipped.alreadyQueued += 1
      continue
    }
    if (asset.transcriptStatus === 'transcribed') {
      skipped.alreadyTranscribed += 1
      continue
    }
    if (asset.transcriptStatus === 'partial') {
      skipped.partial += 1
      continue
    }
    if (asset.transcriptStatus === 'failed' && !includeFailed) {
      skipped.failed += 1
      continue
    }
    eligible.push(asset)
  }

  return { eligible, skipped }
}
