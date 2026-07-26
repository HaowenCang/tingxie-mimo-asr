import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../electron/types'
import { planBatchTranscription } from './batch-transcription'

function asset(id: string, transcriptStatus: MediaAsset['transcriptStatus'] = 'untranscribed'): MediaAsset {
  return {
    id,
    displayName: `${id}.m4a`,
    originalName: `${id}.m4a`,
    relativePath: `media/${id}.m4a`,
    size: 1024,
    extension: 'M4A',
    transcriptStatus,
    managed: true,
    importedAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  }
}

describe('batch transcription planning', () => {
  it('adds only unique untranscribed media that are not already queued', () => {
    const report = planBatchTranscription(
      [asset('ready'), asset('queued'), asset('ready'), asset('complete', 'transcribed'), asset('partial', 'partial'), asset('failed', 'failed')],
      new Set(['queued']),
    )

    expect(report.eligible.map((item) => item.id)).toEqual(['ready'])
    expect(report.skipped).toEqual({
      duplicateSelection: 1,
      alreadyQueued: 1,
      alreadyTranscribed: 1,
      partial: 1,
      failed: 1,
    })
  })
})
