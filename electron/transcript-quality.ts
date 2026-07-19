import type { ChunkRetryOutcome } from './transcription-retry'

export interface TranscriptQualityReport {
  suspicious: boolean
  reason?: 'degenerate-repetition'
  maxRepeatCount: number
  repetitionCoverage: number
  charactersPerSecond: number
}

interface SilenceInterval {
  start: number
  end: number
}

export interface TranscriptQualityRecoveryPlan {
  splitAt: number
  overlapPadding: number
}

export interface RecoverableAudioChunk {
  file: string
  start: number
  end: number
  overlapWithPrevious: number
}

export type RecoveredTranscriptChunk = Omit<RecoverableAudioChunk, 'file'> & (
  | { text: string; status: 'success' }
  | { text: ''; status: 'failed'; error: string; attempts: number; rateLimitWaits: number }
)

interface RecoverTranscriptChunkOptions {
  chunk: RecoverableAudioChunk
  silences: SilenceInterval[]
  depth?: number
  transcribe(chunk: RecoverableAudioChunk): Promise<ChunkRetryOutcome<string>>
  split(chunk: RecoverableAudioChunk, plan: TranscriptQualityRecoveryPlan, depth: number): Promise<[RecoverableAudioChunk, RecoverableAudioChunk]>
  onSplit?(chunk: RecoverableAudioChunk, plan: TranscriptQualityRecoveryPlan, depth: number): void
}

const QUALITY_RECOVERY_MIN_CHILD_SECONDS = 30
const QUALITY_RECOVERY_MAX_DEPTH = 2

function comparable(text: string): string {
  return Array.from(text.toLocaleLowerCase()).filter((character) => /[\p{L}\p{N}]/u.test(character)).join('')
}

function periodicRepetition(text: string): { count: number; coverage: number } {
  let best = { count: 0, coverage: 0 }
  for (const size of [12, 16, 24, 32]) {
    if (text.length < size * 3) continue
    const occurrences = new Map<string, { count: number; lastEnd: number }>()
    for (let index = 0; index <= text.length - size; index += 1) {
      const block = text.slice(index, index + size)
      const current = occurrences.get(block)
      if (!current) occurrences.set(block, { count: 1, lastEnd: index + size })
      else if (index >= current.lastEnd) {
        current.count += 1
        current.lastEnd = index + size
      }
    }
    for (const { count } of occurrences.values()) {
      const coverage = Math.min(1, count * size / text.length)
      if (coverage > best.coverage || (coverage === best.coverage && count > best.count)) best = { count, coverage }
    }
  }
  return best
}

export function inspectTranscriptQuality(text: string, durationSeconds: number): TranscriptQualityReport {
  const normalizedText = comparable(text)
  const sentences = text
    .match(/[^。！？!?\n]+(?:[。！？!?]+|$)/gu)
    ?.map(comparable)
    .filter((sentence) => sentence.length >= 8) || []
  const counts = new Map<string, number>()
  for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) || 0) + 1)

  let maxRepeatCount = 0
  let repeatedCharacters = 0
  for (const [sentence, count] of counts) {
    maxRepeatCount = Math.max(maxRepeatCount, count)
    if (count >= 3) repeatedCharacters += sentence.length * count
  }

  const periodic = periodicRepetition(normalizedText)
  maxRepeatCount = Math.max(maxRepeatCount, periodic.count)
  const sentenceCoverage = normalizedText.length ? Math.min(1, repeatedCharacters / normalizedText.length) : 0
  const repetitionCoverage = Math.max(sentenceCoverage, periodic.coverage)
  const charactersPerSecond = normalizedText.length / Math.max(1, durationSeconds)
  const suspicious = maxRepeatCount >= 6
    && repetitionCoverage >= 0.6
    && (maxRepeatCount >= 12 || charactersPerSecond >= 8)

  return {
    suspicious,
    ...(suspicious ? { reason: 'degenerate-repetition' as const } : {}),
    maxRepeatCount,
    repetitionCoverage,
    charactersPerSecond,
  }
}

export function planTranscriptQualityRecovery(
  start: number,
  end: number,
  silences: SilenceInterval[],
  depth: number,
): TranscriptQualityRecoveryPlan | undefined {
  if (depth >= QUALITY_RECOVERY_MAX_DEPTH || end - start < QUALITY_RECOVERY_MIN_CHILD_SECONDS * 2) return undefined
  const midpoint = (start + end) / 2
  const candidates = silences
    .map((silence) => (silence.start + silence.end) / 2)
    .filter((point) => point >= start + QUALITY_RECOVERY_MIN_CHILD_SECONDS && point <= end - QUALITY_RECOVERY_MIN_CHILD_SECONDS)
  const splitAt = candidates.reduce<number | undefined>((nearest, point) => (
    nearest === undefined || Math.abs(point - midpoint) < Math.abs(nearest - midpoint) ? point : nearest
  ), undefined)
  return splitAt === undefined
    ? { splitAt: midpoint, overlapPadding: 0.8 }
    : { splitAt, overlapPadding: 0 }
}

export async function recoverTranscriptChunk({
  chunk,
  silences,
  depth = 0,
  transcribe,
  split,
  onSplit,
}: RecoverTranscriptChunkOptions): Promise<RecoveredTranscriptChunk[]> {
  const outcome = await transcribe(chunk)
  if (outcome.status === 'success') {
    return [{
      start: chunk.start,
      end: chunk.end,
      overlapWithPrevious: chunk.overlapWithPrevious,
      text: outcome.value,
      status: 'success',
    }]
  }

  const recovery = outcome.failure.fingerprint === 'degenerate-repetition'
    ? planTranscriptQualityRecovery(chunk.start, chunk.end, silences, depth)
    : undefined
  if (recovery) {
    onSplit?.(chunk, recovery, depth)
    const children = await split(chunk, recovery, depth)
    const recovered: RecoveredTranscriptChunk[] = []
    for (const child of children) {
      recovered.push(...await recoverTranscriptChunk({ chunk: child, silences, depth: depth + 1, transcribe, split, onSplit }))
    }
    return recovered
  }

  return [{
    start: chunk.start,
    end: chunk.end,
    overlapWithPrevious: chunk.overlapWithPrevious,
    text: '',
    status: 'failed',
    error: outcome.failure.fingerprint === 'degenerate-repetition'
      ? '识别结果出现异常循环，自动重试和重新切分后仍未恢复'
      : outcome.error,
    attempts: outcome.errorAttempts,
    rateLimitWaits: outcome.rateLimitWaits,
  }]
}
