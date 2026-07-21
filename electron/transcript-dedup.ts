import type { TranscriptDuplicateReport, TranscriptResult, TranscriptSegment } from './types'

export interface TranscriptDuplicateRepair extends Omit<TranscriptDuplicateReport, 'canUndo'> {
  removedSegments: number
  result: TranscriptResult
}

interface DuplicateRun {
  startIndex: number
  endIndex: number
}

function comparableText(text: string): string {
  return [...text]
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .join('')
    .toLocaleLowerCase()
}

function chunkKey(segment: TranscriptSegment): string {
  return [...new Set(segment.chunkIndexes || [])].sort((left, right) => left - right).join(',')
}

function duplicateRuns(result: TranscriptResult): DuplicateRun[] {
  const runs: DuplicateRun[] = []
  let cursor = 0
  while (cursor < result.segments.length) {
    const segment = result.segments[cursor]
    const normalized = segment.status === 'failed' ? '' : comparableText(segment.text)
    const sourceChunks = chunkKey(segment)
    if (normalized.length < 40 || !sourceChunks) {
      cursor += 1
      continue
    }
    let endIndex = cursor
    while (endIndex + 1 < result.segments.length) {
      const next = result.segments[endIndex + 1]
      if (next.status === 'failed' || chunkKey(next) !== sourceChunks || comparableText(next.text) !== normalized) break
      endIndex += 1
    }
    if (endIndex > cursor) runs.push({ startIndex: cursor, endIndex })
    cursor = endIndex + 1
  }
  return runs
}

function timestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(rounded / 60)
  const secs = rounded % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function segmentText(segment: TranscriptSegment): string {
  if (segment.status !== 'failed') return segment.text
  const range = segment.end === undefined ? timestamp(segment.start) : `${timestamp(segment.start)}–${timestamp(segment.end)}`
  return `[${range} 转写失败：${segment.error || '未知错误'}]`
}

export function inspectTranscriptDuplicates(result: TranscriptResult): Omit<TranscriptDuplicateReport, 'canUndo'> {
  const runs = duplicateRuns(result)
  return {
    duplicateGroups: runs.length,
    removableSegments: runs.reduce((total, run) => total + run.endIndex - run.startIndex, 0),
    removableCharacters: runs.reduce((total, run) => total + result.segments.slice(run.startIndex + 1, run.endIndex + 1).reduce((characters, segment) => characters + segment.text.length, 0), 0),
  }
}

export function repairTranscriptDuplicates(result: TranscriptResult): TranscriptDuplicateRepair {
  const runs = duplicateRuns(result)
  const runByStart = new Map(runs.map((run) => [run.startIndex, run]))
  const segments: TranscriptSegment[] = []
  for (let index = 0; index < result.segments.length; index += 1) {
    const run = runByStart.get(index)
    if (!run) {
      segments.push({ ...result.segments[index] })
      continue
    }
    const first = result.segments[run.startIndex]
    const last = result.segments[run.endIndex]
    segments.push({ ...first, end: Math.max(first.end ?? first.start, last.end ?? last.start) })
    index = run.endIndex
  }
  const report = inspectTranscriptDuplicates(result)
  return {
    ...report,
    removedSegments: report.removableSegments,
    result: {
      ...result,
      revision: (result.revision ?? 0) + (report.removableSegments ? 1 : 0),
      segments,
      text: segments.map(segmentText).join('\n\n'),
    },
  }
}
