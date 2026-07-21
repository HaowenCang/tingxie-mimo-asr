import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureHistoryBackup } from './history-recovery'
import { inspectTranscriptDuplicates, repairTranscriptDuplicates, type TranscriptDuplicateRepair } from './transcript-dedup'
import { summarizeTranscript } from './transcript-summary'
import type { TranscriptDuplicateReport, TranscriptResult, TranscriptSegment, TranscriptSummary } from './types'

interface TranscriptStoreOptions {
  storeRoot: string
  legacyFile: string
  backupFile: string
}

interface TranscriptIndexFile {
  version: 1
  migratedAt: string
  records: TranscriptSummary[]
}

function timestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor(rounded % 3600 / 60)
  const secs = rounded % 60
  return hours
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
}

function segmentText(segment: TranscriptSegment): string {
  if (segment.status !== 'failed') return segment.text
  const range = segment.end === undefined ? timestamp(segment.start) : `${timestamp(segment.start)}–${timestamp(segment.end)}`
  return `[${range} 转写失败：${segment.error || '未知错误'}]`
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export class TranscriptStore {
  private readonly indexFile: string
  private readonly recordsDirectory: string
  private readonly duplicateBackupDirectory: string
  private index: TranscriptIndexFile | undefined
  private initialization: Promise<void> | undefined
  private legacyFallback: Map<string, TranscriptResult> | undefined

  constructor(private readonly options: TranscriptStoreOptions) {
    this.indexFile = path.join(options.storeRoot, 'index.json')
    this.recordsDirectory = path.join(options.storeRoot, 'records')
    this.duplicateBackupDirectory = path.join(options.storeRoot, 'backups', 'dedup')
  }

  async listSummaries(): Promise<TranscriptSummary[]> {
    await this.initialize()
    return [...this.index!.records]
  }

  async get(id: string): Promise<TranscriptResult | undefined> {
    await this.initialize()
    if (!this.index!.records.some((item) => item.id === id)) return undefined
    return this.readRecord(id)
  }

  async listAll(): Promise<TranscriptResult[]> {
    const summaries = await this.listSummaries()
    const records = await Promise.all(summaries.map((item) => this.readRecord(item.id)))
    return records.filter((item): item is TranscriptResult => Boolean(item))
  }

  async save(result: TranscriptResult, options: { preserveDuplicateBackup?: boolean } = {}): Promise<TranscriptSummary> {
    await this.initialize()
    await writeJsonAtomic(this.recordPath(result.id), result)
    const summary = summarizeTranscript(result)
    const nextIndex: TranscriptIndexFile = {
      ...this.index!,
      records: [summary, ...this.index!.records.filter((item) => item.id !== result.id)],
    }
    await writeJsonAtomic(this.indexFile, nextIndex)
    this.index = nextIndex
    if (!options.preserveDuplicateBackup) await fs.rm(this.duplicateBackupPath(result.id), { force: true })
    return summary
  }

  async patchSegment(id: string, segmentId: string, patch: Partial<TranscriptSegment>): Promise<TranscriptResult> {
    const result = await this.get(id)
    if (!result) throw new Error('未找到该转写记录')
    const segmentIndex = result.segments.findIndex((segment, index) => (segment.id || `segment-${index}`) === segmentId)
    if (segmentIndex < 0) throw new Error('未找到该转写段落')
    const segments = result.segments.map((segment, index) => index === segmentIndex ? { ...segment, ...patch } : segment)
    const updated = { ...result, revision: (result.revision ?? 0) + 1, segments, text: segments.map(segmentText).join('\n\n') }
    await this.save(updated)
    return updated
  }

  async rename(id: string, fileName: string): Promise<TranscriptResult> {
    const result = await this.get(id)
    if (!result) throw new Error('未找到该转写记录')
    const trimmed = fileName.trim()
    if (!trimmed) throw new Error('录音名称不能为空')
    const updated = { ...result, fileName: trimmed }
    await this.save(updated)
    return updated
  }

  async inspectDuplicates(id: string): Promise<TranscriptDuplicateReport & { canUndo: boolean }> {
    const result = await this.get(id)
    if (!result) throw new Error('未找到该转写记录')
    return {
      ...inspectTranscriptDuplicates(result),
      canUndo: await this.hasDuplicateBackup(id),
    }
  }

  async repairDuplicates(id: string): Promise<TranscriptDuplicateRepair & { canUndo: boolean }> {
    const result = await this.get(id)
    if (!result) throw new Error('未找到该转写记录')
    const repair = repairTranscriptDuplicates(result)
    if (!repair.removedSegments) {
      return { ...repair, canUndo: await this.hasDuplicateBackup(id) }
    }
    const backupFile = this.duplicateBackupPath(id)
    if (!await this.hasDuplicateBackup(id)) await writeJsonAtomic(backupFile, result)
    await this.save(repair.result, { preserveDuplicateBackup: true })
    return { ...repair, canUndo: true }
  }

  async undoDuplicateRepair(id: string): Promise<TranscriptResult> {
    const backupSource = await fs.readFile(this.duplicateBackupPath(id), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!backupSource) throw new Error('没有可撤销的重复内容修复')
    const backup = JSON.parse(backupSource) as TranscriptResult
    if (!backup || backup.id !== id || !Array.isArray(backup.segments)) throw new Error('重复内容备份无效')
    const current = await this.get(id)
    const restored = {
      ...backup,
      revision: Math.max(current?.revision ?? 0, backup.revision ?? 0) + 1,
    }
    await this.save(restored)
    return restored
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize()
    if (!this.index!.records.some((item) => item.id === id)) return false
    const nextIndex: TranscriptIndexFile = { ...this.index!, records: this.index!.records.filter((item) => item.id !== id) }
    await writeJsonAtomic(this.indexFile, nextIndex)
    this.index = nextIndex
    await fs.rm(this.recordPath(id), { force: true })
    return true
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.loadOrMigrate()
    return this.initialization
  }

  private async loadOrMigrate(): Promise<void> {
    const existing = await fs.readFile(this.indexFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (existing !== undefined) {
      const parsed = JSON.parse(existing) as TranscriptIndexFile
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error('转写索引格式无效')
      this.index = parsed
      return
    }

    const legacySource = await fs.readFile(this.options.legacyFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const legacyRecords = legacySource === undefined ? [] : JSON.parse(legacySource) as TranscriptResult[]
    if (!Array.isArray(legacyRecords)) throw new Error('旧历史转写格式无效')
    const ids = new Set<string>()
    for (const record of legacyRecords) {
      if (!record || typeof record.id !== 'string' || !record.id || typeof record.fileName !== 'string' || typeof record.text !== 'string' || !Array.isArray(record.segments)) {
        throw new Error('旧历史转写包含无效记录')
      }
      if (ids.has(record.id)) throw new Error(`旧历史转写包含重复 ID：${record.id}`)
      ids.add(record.id)
    }
    const nextIndex: TranscriptIndexFile = {
      version: 1,
      migratedAt: new Date().toISOString(),
      records: legacyRecords.map(summarizeTranscript),
    }
    try {
      if (legacySource !== undefined) await ensureHistoryBackup(this.options.legacyFile, this.options.backupFile)
      await fs.mkdir(this.recordsDirectory, { recursive: true })
      const verifiedRecords: TranscriptResult[] = []
      for (const record of legacyRecords) {
        await writeJsonAtomic(this.recordPath(record.id), record)
        const verified = await this.readRecord(record.id)
        if (!verified || verified.id !== record.id) throw new Error(`转写记录迁移校验失败：${record.id}`)
        verifiedRecords.push(verified)
      }
      const originalTextLength = legacyRecords.reduce((total, record) => total + record.text.length, 0)
      const verifiedTextLength = verifiedRecords.reduce((total, record) => total + record.text.length, 0)
      if (verifiedRecords.length !== legacyRecords.length || verifiedTextLength !== originalTextLength) throw new Error('转写记录迁移总量校验失败')
      await writeJsonAtomic(this.indexFile, nextIndex)
      this.index = nextIndex
    } catch {
      this.index = nextIndex
      this.legacyFallback = new Map(legacyRecords.map((record) => [record.id, record]))
    }
  }

  private async readRecord(id: string): Promise<TranscriptResult | undefined> {
    const fallback = this.legacyFallback?.get(id)
    if (fallback) return fallback
    const source = await fs.readFile(this.recordPath(id), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    return source === undefined ? undefined : JSON.parse(source) as TranscriptResult
  }

  private recordPath(id: string): string {
    return path.join(this.recordsDirectory, `${encodeURIComponent(id)}.json`)
  }

  private duplicateBackupPath(id: string): string {
    return path.join(this.duplicateBackupDirectory, `${encodeURIComponent(id)}.json`)
  }

  private async hasDuplicateBackup(id: string): Promise<boolean> {
    return fs.access(this.duplicateBackupPath(id), constants.F_OK).then(() => true).catch(() => false)
  }
}
