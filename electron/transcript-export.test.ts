import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaLibrarySnapshot, TranscriptResult, TranscriptSummary } from './types'
import { buildTranscriptExportPlan, executeTranscriptExport, sanitizeExportName } from './transcript-export'

const temporaryDirectories: string[] = []

function summary(id: string, fileName: string, folderId?: string): TranscriptSummary {
  return {
    id,
    fileName,
    folderId,
    createdAt: '2026-07-29T00:00:00.000Z',
    duration: 60,
    segmentCount: 1,
    sourceAvailable: false,
    preview: '正文',
    analysisStatus: 'none',
  }
}

function transcript(id: string, fileName: string, text = `正文 ${id}`): TranscriptResult {
  return {
    id,
    fileName,
    createdAt: '2026-07-29T00:00:00.000Z',
    duration: 60,
    segments: [{ start: 0, text }],
    text,
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('transcript export planning', () => {
  const library: MediaLibrarySnapshot = {
    rootPath: 'D:\\library',
    folders: [
      { id: 'project', name: '项目资料', createdAt: 'now', updatedAt: 'now' },
      { id: 'interviews', parentId: 'project', name: '需求访谈', createdAt: 'now', updatedAt: 'now' },
      { id: 'other', name: '其他', createdAt: 'now', updatedAt: 'now' },
    ],
    assets: [
      { id: 'a1', folderId: 'project', transcriptId: 't1', displayName: '会议.m4a', originalName: '会议.m4a', relativePath: 'a1.m4a', size: 1, extension: 'M4A', transcriptStatus: 'transcribed', managed: true, importedAt: 'now', updatedAt: 'now' },
      { id: 'a2', folderId: 'interviews', transcriptId: 't2', displayName: '访谈.m4a', originalName: '访谈.m4a', relativePath: 'a2.m4a', size: 1, extension: 'M4A', transcriptStatus: 'transcribed', managed: true, importedAt: 'now', updatedAt: 'now' },
      { id: 'a3', folderId: 'interviews', displayName: '未转写.m4a', originalName: '未转写.m4a', relativePath: 'a3.m4a', size: 1, extension: 'M4A', transcriptStatus: 'untranscribed', managed: true, importedAt: 'now', updatedAt: 'now' },
    ],
  }
  const history = [summary('t1', '会议.m4a', 'project'), summary('t2', '访谈.m4a', 'interviews'), summary('t3', '文字记录.md', 'interviews'), summary('t4', '其他.wav', 'other')]

  it('deduplicates a mixed selection and reports missing records', () => {
    const plan = buildTranscriptExportPlan({ kind: 'selection', transcriptIds: ['t1', 't1', 'missing'] }, library, history)
    expect(plan.entries.map((entry) => entry.transcriptId)).toEqual(['t1'])
    expect(plan.skipped).toEqual([{ itemId: 'missing', reason: '未找到转写记录' }])
  })

  it('recursively exports linked and text-only transcripts while preserving child folders', () => {
    const plan = buildTranscriptExportPlan({ kind: 'folder', folderId: 'project', includeDescendants: true, preserveStructure: true }, library, history)
    expect(plan.containerName).toBe('项目资料-转写')
    expect(plan.entries).toEqual([
      { transcriptId: 't1', fileName: '会议.m4a', folderSegments: [] },
      { transcriptId: 't2', fileName: '访谈.m4a', folderSegments: ['需求访谈'] },
      { transcriptId: 't3', fileName: '文字记录.md', folderSegments: ['需求访谈'] },
    ])
    expect(plan.skipped).toContainEqual({ itemId: 'a3', fileName: '未转写.m4a', reason: '媒体尚未转写' })
  })

  it('can exclude descendants and flatten a folder export', () => {
    const plan = buildTranscriptExportPlan({ kind: 'folder', folderId: 'project', includeDescendants: false, preserveStructure: false }, library, history)
    expect(plan.entries).toEqual([{ transcriptId: 't1', fileName: '会议.m4a', folderSegments: [] }])
  })
})

describe('transcript export files', () => {
  it('sanitizes Windows-invalid and reserved names', () => {
    expect(sanitizeExportName('  报告<>:"/\\|?*.  ', 'fallback')).toBe('报告')
    expect(sanitizeExportName('CON.txt', 'fallback')).toBe('_CON.txt')
    expect(sanitizeExportName('...', 'fallback')).toBe('fallback')
  })

  it('creates a unique container and never overwrites an existing file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tingxie-export-'))
    temporaryDirectories.push(directory)
    await mkdir(path.join(directory, '项目-转写'))
    const plan = {
      containerName: '项目-转写',
      entries: [
        { transcriptId: 't1', fileName: '访谈?.m4a', folderSegments: ['子:目录'] },
        { transcriptId: 't2', fileName: '访谈?.wav', folderSegments: ['子:目录'] },
      ],
      skipped: [],
    }
    const transcripts = new Map([
      ['t1', transcript('t1', '访谈?.m4a', '第一条')],
      ['t2', transcript('t2', '访谈?.wav', '第二条')],
    ])

    const result = await executeTranscriptExport(plan, directory, 'txt', async (id) => transcripts.get(id))

    expect(path.basename(result.directory!)).toBe('项目-转写 (2)')
    expect(result.exported.map((item) => item.relativePath)).toEqual([
      path.join('子 目录', '访谈-转写.txt'),
      path.join('子 目录', '访谈 (2)-转写.txt'),
    ])
    expect(await readFile(path.join(result.directory!, result.exported[0].relativePath), 'utf8')).toBe('第一条')
    expect(await readFile(path.join(result.directory!, result.exported[1].relativePath), 'utf8')).toBe('第二条')
    expect(await readdir(directory)).toEqual(['项目-转写', '项目-转写 (2)'])
  })

  it('continues after a missing transcript', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tingxie-export-'))
    temporaryDirectories.push(directory)
    const plan = {
      entries: [
        { transcriptId: 'missing', fileName: '缺失.wav', folderSegments: [] },
        { transcriptId: 't1', fileName: '有效.wav', folderSegments: [] },
      ],
      skipped: [],
    }

    const result = await executeTranscriptExport(plan, directory, 'md', async (id) => id === 't1' ? transcript('t1', '有效.wav') : undefined)

    expect(result.exported).toHaveLength(1)
    expect(result.failed).toEqual([{ itemId: 'missing', fileName: '缺失.wav', reason: '导出时未找到转写记录' }])
  })
})
