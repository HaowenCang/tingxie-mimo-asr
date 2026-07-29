import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BatchTranscriptExportResult,
  MediaFolder,
  MediaLibrarySnapshot,
  TranscriptExportFormat,
  TranscriptExportSource,
  TranscriptResult,
  TranscriptSummary,
} from './types'

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g
const TRAILING_WINDOWS_CHARACTERS = /[. ]+$/g

export interface TranscriptExportPlanEntry {
  transcriptId: string
  fileName: string
  folderSegments: string[]
}

export interface TranscriptExportPlan {
  containerName?: string
  entries: TranscriptExportPlanEntry[]
  skipped: BatchTranscriptExportResult['skipped']
}

export function sanitizeExportName(value: string, fallback: string): string {
  const sanitized = value
    .replace(INVALID_WINDOWS_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(TRAILING_WINDOWS_CHARACTERS, '')
    .trim()
  if (!sanitized) return fallback
  return WINDOWS_RESERVED_NAME.test(sanitized) ? `_${sanitized}` : sanitized
}

function descendantsOf(folders: MediaFolder[], folderId: string): Set<string> {
  const result = new Set([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (!result.has(folder.id) && folder.parentId && result.has(folder.parentId)) {
        result.add(folder.id)
        changed = true
      }
    }
  }
  return result
}

function folderPathSegments(folders: MediaFolder[], folderId: string | undefined, stopBeforeId?: string): string[] {
  if (!folderId || folderId === stopBeforeId) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const segments: string[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = folderId
  while (currentId && currentId !== stopBeforeId && !visited.has(currentId)) {
    visited.add(currentId)
    const folder = byId.get(currentId)
    if (!folder) break
    segments.unshift(folder.name)
    currentId = folder.parentId
  }
  return segments
}

export function buildTranscriptExportPlan(
  source: TranscriptExportSource,
  library: MediaLibrarySnapshot,
  history: TranscriptSummary[],
): TranscriptExportPlan {
  const summaryById = new Map(history.map((summary) => [summary.id, summary]))
  if (source.kind === 'selection') {
    const entries: TranscriptExportPlanEntry[] = []
    const skipped: BatchTranscriptExportResult['skipped'] = []
    for (const transcriptId of new Set(source.transcriptIds)) {
      const summary = summaryById.get(transcriptId)
      if (summary) entries.push({ transcriptId, fileName: summary.fileName, folderSegments: [] })
      else skipped.push({ itemId: transcriptId, reason: '未找到转写记录' })
    }
    return { entries, skipped }
  }

  const selectedFolder = source.kind === 'folder'
    ? library.folders.find((folder) => folder.id === source.folderId)
    : undefined
  if (source.kind === 'folder' && !selectedFolder) {
    return { entries: [], skipped: [{ itemId: source.folderId, reason: '未找到导出文件夹' }] }
  }

  const preserveStructure = source.preserveStructure
  const includedFolderIds = source.kind === 'all'
    ? undefined
    : source.includeDescendants
      ? descendantsOf(library.folders, source.folderId)
      : new Set([source.folderId])
  const linkedTranscriptIds = new Set(library.assets.flatMap((asset) => asset.transcriptId ? [asset.transcriptId] : []))
  const entryById = new Map<string, TranscriptExportPlanEntry>()
  const skipped: BatchTranscriptExportResult['skipped'] = []
  const inScope = (folderId?: string) => source.kind === 'all'
    ? true
    : Boolean(folderId && includedFolderIds?.has(folderId))
  const relativeSegments = (folderId?: string) => preserveStructure
    ? folderPathSegments(library.folders, folderId, source.kind === 'folder' ? source.folderId : undefined)
    : []

  for (const asset of library.assets) {
    if (!inScope(asset.folderId)) continue
    if (!asset.transcriptId) {
      skipped.push({ itemId: asset.id, fileName: asset.displayName, reason: '媒体尚未转写' })
      continue
    }
    const summary = summaryById.get(asset.transcriptId)
    if (!summary) {
      skipped.push({ itemId: asset.id, fileName: asset.displayName, reason: '关联的转写记录不存在' })
      continue
    }
    entryById.set(summary.id, {
      transcriptId: summary.id,
      fileName: summary.fileName,
      folderSegments: relativeSegments(asset.folderId),
    })
  }

  for (const summary of history) {
    if (linkedTranscriptIds.has(summary.id) || !inScope(summary.folderId)) continue
    entryById.set(summary.id, {
      transcriptId: summary.id,
      fileName: summary.fileName,
      folderSegments: relativeSegments(summary.folderId),
    })
  }

  return {
    containerName: source.kind === 'folder' ? `${selectedFolder!.name}-转写` : '全部转写',
    entries: [...entryById.values()],
    skipped,
  }
}

async function createUniqueDirectory(parent: string, preferredName: string): Promise<string> {
  const base = sanitizeExportName(preferredName, '转写导出')
  for (let index = 1; ; index += 1) {
    const candidate = path.join(parent, index === 1 ? base : `${base} (${index})`)
    try {
      await fs.mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

async function writeWithoutOverwrite(directory: string, baseName: string, extension: TranscriptExportFormat, content: string): Promise<{ fileName: string; filePath: string }> {
  const safeBase = sanitizeExportName(path.parse(baseName).name, '未命名转写')
  for (let index = 1; ; index += 1) {
    const fileName = `${index === 1 ? safeBase : `${safeBase} (${index})`}-转写.${extension}`
    const filePath = path.join(directory, fileName)
    try {
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
      return { fileName, filePath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

export async function executeTranscriptExport(
  plan: TranscriptExportPlan,
  selectedDirectory: string,
  format: TranscriptExportFormat,
  loadTranscript: (id: string) => Promise<TranscriptResult | undefined>,
): Promise<BatchTranscriptExportResult> {
  const exported: BatchTranscriptExportResult['exported'] = []
  const failed: BatchTranscriptExportResult['failed'] = []
  if (!plan.entries.length) return { canceled: false, exported, skipped: plan.skipped, failed }

  const exportRoot = plan.containerName
    ? await createUniqueDirectory(selectedDirectory, plan.containerName)
    : selectedDirectory
  const resolvedRoot = path.resolve(exportRoot)

  for (const entry of plan.entries) {
    try {
      const transcript = await loadTranscript(entry.transcriptId)
      if (!transcript) {
        failed.push({ itemId: entry.transcriptId, fileName: entry.fileName, reason: '导出时未找到转写记录' })
        continue
      }
      const safeSegments = entry.folderSegments.map((segment) => sanitizeExportName(segment, '未命名文件夹'))
      const outputDirectory = path.resolve(exportRoot, ...safeSegments)
      if (outputDirectory !== resolvedRoot && !outputDirectory.startsWith(`${resolvedRoot}${path.sep}`)) {
        failed.push({ itemId: entry.transcriptId, fileName: entry.fileName, reason: '导出路径超出目标目录' })
        continue
      }
      await fs.mkdir(outputDirectory, { recursive: true })
      const output = await writeWithoutOverwrite(outputDirectory, entry.fileName, format, transcript.text)
      exported.push({
        transcriptId: entry.transcriptId,
        fileName: output.fileName,
        relativePath: path.relative(exportRoot, output.filePath),
      })
    } catch (error) {
      failed.push({
        itemId: entry.transcriptId,
        fileName: entry.fileName,
        reason: error instanceof Error ? error.message : '文件写入失败',
      })
    }
  }

  return { canceled: false, directory: exportRoot, exported, skipped: plan.skipped, failed }
}
