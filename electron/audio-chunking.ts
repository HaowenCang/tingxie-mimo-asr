import type { ParagraphLength } from './types'

export const MIB = 1024 * 1024
export const DIRECT_UPLOAD_BYTES = 6.4 * MIB
export const TARGET_CHUNK_BYTES = 6.4 * MIB
export const HARD_CHUNK_BYTES = 7 * MIB

export interface AudioEncodingInput {
  codec: string
  sourceBitRate: number
  channels: number
}

export interface AudioEncodingPlan {
  outputExt: 'mp3'
  codecArgs: string[]
  estimatedBytesPerSecond: number
  copy: boolean
}

export function selectAudioEncoding(input: AudioEncodingInput): AudioEncodingPlan {
  if (input.codec === 'mp3') {
    return {
      outputExt: 'mp3',
      codecArgs: ['-c:a', 'copy'],
      estimatedBytesPerSecond: Math.max(input.sourceBitRate, 32_000) / 8,
      copy: true,
    }
  }
  return {
    outputExt: 'mp3',
    codecArgs: ['-c:a', 'libmp3lame', '-q:a', '0'],
    estimatedBytesPerSecond: input.channels <= 1 ? 24_000 : 36_000,
    copy: false,
  }
}

export interface SilenceInterval {
  start: number
  end: number
}

export interface PlannedChunk {
  start: number
  end: number
  logicalStart: number
  overlapWithPrevious: number
  boundaryAtEnd: 'silence' | 'overlap' | 'end'
}

export interface ChunkTranscript {
  start: number
  end?: number
  text: string
  overlapWithPrevious: number
  status?: 'success'
}

export interface FailedChunkTranscript {
  start: number
  end?: number
  text: ''
  overlapWithPrevious: number
  status: 'failed'
  error: string
  attempts: number
  rateLimitWaits?: number
}

export type ChunkTranscriptOutcome = ChunkTranscript | FailedChunkTranscript

export interface LogicalTranscriptSegment {
  id?: string
  start: number
  end?: number
  text: string
  status?: 'success' | 'failed'
  error?: string
  attempts?: number
  rateLimitWaits?: number
  estimated?: boolean
  chunkIndexes?: number[]
}

export interface ChunkPlanningOptions {
  targetBytes?: number
  hardBytes?: number
  maxChunkSeconds?: number
  silenceSearchSeconds?: number
  overlapPaddingSeconds?: number
}

const DEFAULT_OPTIONS: Required<ChunkPlanningOptions> = {
  targetBytes: TARGET_CHUNK_BYTES,
  hardBytes: HARD_CHUNK_BYTES,
  maxChunkSeconds: 240,
  silenceSearchSeconds: 15,
  overlapPaddingSeconds: 0.8,
}

export function parseSilenceDetectOutput(output: string, duration: number): SilenceInterval[] {
  const intervals: SilenceInterval[] = []
  let pendingStart: number | undefined

  for (const line of output.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/)
    if (startMatch) pendingStart = Number(startMatch[1])
    const endMatch = line.match(/silence_end:\s*([\d.]+)/)
    if (endMatch && pendingStart !== undefined) {
      const end = Math.min(Number(endMatch[1]), duration)
      if (end > pendingStart) intervals.push({ start: Math.max(0, pendingStart), end })
      pendingStart = undefined
    }
  }

  if (pendingStart !== undefined && duration > pendingStart) {
    intervals.push({ start: Math.max(0, pendingStart), end: duration })
  }
  return intervals
}

function closestSilence(
  intervals: SilenceInterval[],
  target: number,
  minimum: number,
  maximum: number,
  searchSeconds: number,
): number | undefined {
  return intervals
    .map((interval) => {
      const point = (interval.start + interval.end) / 2
      const distance = Math.abs(point - target)
      const pauseDuration = Math.min(2, interval.end - interval.start)
      return { point, distance, score: distance - pauseDuration * 3 }
    })
    .filter(({ point, distance }) => point >= minimum && point <= maximum && distance <= searchSeconds)
    .sort((left, right) => left.score - right.score || left.distance - right.distance || left.point - right.point)[0]?.point
}

export function planAudioChunks(
  duration: number,
  estimatedBytesPerSecond: number,
  silences: SilenceInterval[],
  options: ChunkPlanningOptions = {},
): PlannedChunk[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const config = { ...DEFAULT_OPTIONS, ...options }
  const bytesPerSecond = Math.max(estimatedBytesPerSecond, 1)
  const hardDuration = Math.max(0.1, config.hardBytes / bytesPerSecond)
  const targetDuration = Math.max(0.1, Math.min(config.maxChunkSeconds, config.targetBytes / bytesPerSecond, hardDuration * 0.9))
  const minimumSegment = Math.min(3, targetDuration * 0.5)
  const chunks: PlannedChunk[] = []
  let logicalStart = 0
  let leftPadding = 0

  while (logicalStart < duration - 0.001) {
    const actualStart = Math.max(0, logicalStart - leftPadding)
    const remaining = duration - logicalStart
    if (remaining <= targetDuration) {
      chunks.push({
        start: actualStart,
        end: duration,
        logicalStart,
        overlapWithPrevious: leftPadding * 2,
        boundaryAtEnd: 'end',
      })
      break
    }

    const target = logicalStart + targetDuration
    const maximumSafeEnd = Math.min(duration, actualStart + hardDuration)
    const silence = closestSilence(
      silences,
      target,
      logicalStart + minimumSegment,
      maximumSafeEnd,
      config.silenceSearchSeconds,
    )

    if (silence !== undefined && silence < duration - 0.001) {
      chunks.push({
        start: actualStart,
        end: silence,
        logicalStart,
        overlapWithPrevious: leftPadding * 2,
        boundaryAtEnd: 'silence',
      })
      logicalStart = silence
      leftPadding = 0
      continue
    }

    const boundary = Math.min(target, duration)
    const availableRightPadding = Math.max(0, maximumSafeEnd - boundary)
    const padding = Math.min(config.overlapPaddingSeconds, targetDuration * 0.2, availableRightPadding)
    chunks.push({
      start: actualStart,
      end: Math.min(duration, boundary + padding),
      logicalStart,
      overlapWithPrevious: leftPadding * 2,
      boundaryAtEnd: boundary >= duration ? 'end' : 'overlap',
    })
    logicalStart = boundary
    leftPadding = padding
  }

  return chunks
}

export function splitOversizedChunk(chunk: PlannedChunk, silences: SilenceInterval[]): [PlannedChunk, PlannedChunk] {
  const span = chunk.end - chunk.start
  const target = chunk.start + span / 2
  const lower = chunk.start + span * 0.3
  const upper = chunk.start + span * 0.7
  const splitAt = closestSilence(silences, target, lower, upper, span) ?? target
  const padding = Math.min(0.8, span * 0.08)
  return [
    {
      start: chunk.start,
      end: Math.min(chunk.end, splitAt + padding),
      logicalStart: chunk.logicalStart,
      overlapWithPrevious: chunk.overlapWithPrevious,
      boundaryAtEnd: 'overlap',
    },
    {
      start: Math.max(chunk.start, splitAt - padding),
      end: chunk.end,
      logicalStart: splitAt,
      overlapWithPrevious: padding * 2,
      boundaryAtEnd: chunk.boundaryAtEnd,
    },
  ]
}

interface ComparableText {
  value: string
  originalEnds: number[]
}

function comparableText(text: string): ComparableText {
  let value = ''
  const originalEnds: number[] = []
  let offset = 0
  for (const character of text) {
    offset += character.length
    if (/[\p{L}\p{N}]/u.test(character)) {
      value += character.toLocaleLowerCase()
      originalEnds.push(offset)
    }
  }
  return { value, originalEnds }
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

export function trimOverlappingPrefix(previousText: string, nextText: string, threshold = 0.88): { text: string; matchedCharacters: number; similarity: number } {
  const previous = comparableText(previousText)
  const next = comparableText(nextText)
  const maximum = Math.min(60, previous.value.length, next.value.length)
  if (maximum < 4) return { text: nextText.trimStart(), matchedCharacters: 0, similarity: 0 }

  for (let length = maximum; length >= 4; length -= 1) {
    if (previous.value.slice(-length) === next.value.slice(0, length)) {
      return { text: nextText.slice(next.originalEnds[length - 1]).trimStart(), matchedCharacters: length, similarity: 1 }
    }
  }

  let best = { previousLength: 0, nextLength: 0, similarity: 0 }
  for (let previousLength = 4; previousLength <= maximum; previousLength += 1) {
    for (let nextLength = Math.max(4, previousLength - 3); nextLength <= Math.min(maximum, previousLength + 3); nextLength += 1) {
      const left = previous.value.slice(-previousLength)
      const right = next.value.slice(0, nextLength)
      const similarity = 1 - levenshtein(left, right) / Math.max(previousLength, nextLength)
      const bestSize = Math.min(best.previousLength, best.nextLength)
      const candidateSize = Math.min(previousLength, nextLength)
      if (similarity >= threshold && (candidateSize > bestSize || (candidateSize === bestSize && similarity > best.similarity))) {
        best = { previousLength, nextLength, similarity }
      }
    }
  }

  if (!best.nextLength) return { text: nextText.trimStart(), matchedCharacters: 0, similarity: 0 }
  return {
    text: nextText.slice(next.originalEnds[best.nextLength - 1]).trimStart(),
    matchedCharacters: best.nextLength,
    similarity: best.similarity,
  }
}

function appendText(previous: string, next: string): string {
  if (!next) return previous
  const cleanedNext = endsSentence(previous) ? next.replace(/^[，,；;：:、\s]+/u, '') : next
  const needsSpace = /[\p{L}\p{N}]$/u.test(previous) && /^[A-Za-z0-9]/.test(cleanedNext)
  return `${previous}${needsSpace ? ' ' : ''}${cleanedNext}`
}

function endsSentence(text: string): boolean {
  return /[。！？.!?][”’"')）】]?\s*$/u.test(text)
}

export function mergeChunkTranscripts(chunks: ChunkTranscriptOutcome[]): LogicalTranscriptSegment[] {
  const logical: LogicalTranscriptSegment[] = []
  for (const chunk of chunks) {
    if (chunk.status === 'failed') {
      logical.push({
        start: chunk.start,
        ...(chunk.end === undefined ? {} : { end: chunk.end }),
        text: '',
        status: 'failed',
        error: chunk.error,
        attempts: chunk.attempts,
        rateLimitWaits: chunk.rateLimitWaits,
      })
      continue
    }
    let text = chunk.text.trim()
    if (!text) continue
    const previous = logical.at(-1)
    if (previous && previous.status !== 'failed' && chunk.overlapWithPrevious > 0) {
      text = trimOverlappingPrefix(previous.text, text).text
    }
    if (!text) continue

    const currentPrevious = logical.at(-1)
    const unsafeBoundary = chunk.overlapWithPrevious > 0
    if (currentPrevious && currentPrevious.status !== 'failed' && (unsafeBoundary || !endsSentence(currentPrevious.text))) {
      currentPrevious.text = appendText(currentPrevious.text, text)
      if (chunk.end !== undefined) currentPrevious.end = chunk.end
    } else {
      logical.push({
        start: chunk.start,
        ...(chunk.end === undefined ? {} : { end: chunk.end }),
        text,
        ...(chunk.status === undefined ? {} : { status: chunk.status }),
      })
    }
  }
  return logical
}

function splitTranscriptUnits(text: string): string[] {
  const units = text
    .replace(/\r\n?/g, '\n')
    .match(/[^。！？!?\n]+(?:[。！？!?]+[”’"')）】]*)?|[^\n]+/gu)
    ?.map((unit) => unit.trim())
    .filter(Boolean) || []
  return units.length ? units : [text.trim()].filter(Boolean)
}

export function transcriptTextWeight(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0
  const words = text.match(/[\p{L}\p{N}]+/gu)?.filter((token) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)).length || 0
  return Math.max(1, cjk + words)
}

interface ParagraphConfig {
  minWeight: number
  targetWeight: number
  maxWeight: number
  minSentences: number
  maxSentences: number
  maxDuration: number
}

const PARAGRAPH_CONFIG: Record<ParagraphLength, ParagraphConfig> = {
  compact: { minWeight: 45, targetWeight: 85, maxWeight: 150, minSentences: 2, maxSentences: 3, maxDuration: 55 },
  standard: { minWeight: 80, targetWeight: 150, maxWeight: 260, minSentences: 3, maxSentences: 6, maxDuration: 95 },
  long: { minWeight: 140, targetWeight: 270, maxWeight: 440, minSentences: 5, maxSentences: 9, maxDuration: 150 },
}

function sentenceCount(text: string): number {
  return Math.max(1, text.match(/[。！？!?]+[”’"')）】]*/gu)?.length || 0)
}

function mergeLogicalSegment(target: LogicalTranscriptSegment, source: LogicalTranscriptSegment) {
  target.text = appendText(target.text, source.text)
  target.end = Math.max(target.end ?? target.start, source.end ?? source.start)
  target.chunkIndexes = [...new Set([...(target.chunkIndexes || []), ...(source.chunkIndexes || [])])]
  target.estimated = Boolean(target.estimated || source.estimated)
}

function groupTranscriptParagraphs(units: LogicalTranscriptSegment[], length: ParagraphLength): LogicalTranscriptSegment[] {
  const config = PARAGRAPH_CONFIG[length]
  const paragraphs: LogicalTranscriptSegment[] = []
  let current: LogicalTranscriptSegment | undefined
  let currentWeight = 0
  let currentSentences = 0

  const flush = () => {
    if (current) paragraphs.push(current)
    current = undefined
    currentWeight = 0
    currentSentences = 0
  }

  for (const unit of units) {
    if (unit.status === 'failed') {
      flush()
      paragraphs.push(unit)
      continue
    }

    const weight = transcriptTextWeight(unit.text)
    const sentences = sentenceCount(unit.text)
    const wouldExceedHardLimit = Boolean(current)
      && (currentWeight + weight > config.maxWeight || currentSentences + sentences > config.maxSentences)
      && (currentWeight >= config.minWeight || currentSentences >= config.minSentences)
    if (wouldExceedHardLimit) flush()

    if (!current) current = { ...unit, chunkIndexes: [...(unit.chunkIndexes || [])] }
    else mergeLogicalSegment(current, unit)
    currentWeight += weight
    currentSentences += sentences

    const duration = (current.end ?? current.start) - current.start
    if (currentSentences >= config.maxSentences
      || (currentSentences >= config.minSentences && currentWeight >= config.targetWeight)
      || (currentSentences >= 2 && duration >= config.maxDuration)) flush()
  }
  flush()

  const tail = paragraphs.at(-1)
  const previous = paragraphs.at(-2)
  if (tail && previous && tail.status !== 'failed' && previous.status !== 'failed') {
    const tailWeight = transcriptTextWeight(tail.text)
    const combinedWeight = transcriptTextWeight(previous.text) + tailWeight
    const combinedSentences = sentenceCount(previous.text) + sentenceCount(tail.text)
    if (tailWeight < config.minWeight
      && combinedWeight <= config.maxWeight
      && combinedSentences <= config.maxSentences + 1) {
      mergeLogicalSegment(previous, tail)
      paragraphs.pop()
    }
  }
  return paragraphs
}

/**
 * Produces paragraph-level fuzzy timestamps without a local alignment model.
 * Each successful ASR chunk owns a logical time interval; text units share that
 * interval in proportion to their CJK-character/word weight. Failed chunks stay
 * as explicit holes and all estimates remain monotonic and inside the media.
 */
export function estimateTranscriptSegments(chunks: ChunkTranscriptOutcome[], mediaDuration: number, paragraphLength: ParagraphLength = 'standard'): LogicalTranscriptSegment[] {
  const units: LogicalTranscriptSegment[] = []
  chunks.forEach((chunk, chunkIndex) => {
    const chunkStart = Math.max(0, Math.min(mediaDuration, chunk.start))
    const chunkEnd = Math.max(chunkStart, Math.min(mediaDuration, chunk.end ?? mediaDuration))
    if (chunk.status === 'failed') {
      units.push({
        id: `chunk-${chunkIndex}-failed`,
        start: chunkStart,
        end: chunkEnd,
        text: '',
        status: 'failed',
        error: chunk.error,
        attempts: chunk.attempts,
        rateLimitWaits: chunk.rateLimitWaits,
        estimated: false,
        chunkIndexes: [chunkIndex],
      })
      return
    }

    let text = chunk.text.trim()
    const previous = units.at(-1)
    if (previous && previous.status !== 'failed' && chunk.overlapWithPrevious > 0) {
      text = trimOverlappingPrefix(previous.text, text).text
    }
    if (!text) return

    const textUnits = splitTranscriptUnits(text)
    const weights = textUnits.map(transcriptTextWeight)
    const totalWeight = weights.reduce((total, weight) => total + weight, 0)
    const duration = chunkEnd - chunkStart
    let prefixWeight = 0

    textUnits.forEach((unit, unitIndex) => {
      const start = chunkStart + duration * prefixWeight / totalWeight
      prefixWeight += weights[unitIndex]
      const end = unitIndex === textUnits.length - 1
        ? chunkEnd
        : chunkStart + duration * prefixWeight / totalWeight
      const currentPrevious = units.at(-1)
      const unsafeBoundary = unitIndex === 0 && currentPrevious?.status !== 'failed' && Boolean(currentPrevious)
        && (chunk.overlapWithPrevious > 0 || !endsSentence(currentPrevious?.text || ''))
      if (unsafeBoundary && currentPrevious) {
        currentPrevious.text = appendText(currentPrevious.text, unit)
        currentPrevious.end = Math.max(currentPrevious.end ?? currentPrevious.start, end)
        currentPrevious.chunkIndexes = [...new Set([...(currentPrevious.chunkIndexes || []), chunkIndex])]
      } else {
        units.push({
          id: `chunk-${chunkIndex}-unit-${unitIndex}`,
          start,
          end,
          text: unit,
          status: 'success',
          estimated: true,
          chunkIndexes: [chunkIndex],
        })
      }
    })
  })

  const paragraphs = groupTranscriptParagraphs(units, paragraphLength)
  let floor = 0
  return paragraphs.map((segment) => {
    const start = Math.max(floor, Math.min(mediaDuration, segment.start))
    const end = Math.max(start, Math.min(mediaDuration, segment.end ?? start))
    floor = end
    return { ...segment, start, end }
  })
}
