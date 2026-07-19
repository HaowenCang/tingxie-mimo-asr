import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TranscriptResult } from './types'

export function attachManagedMediaToHistory(
  history: TranscriptResult[],
  transcriptId: string,
  mediaId: string,
): TranscriptResult[] {
  return history.map((item) => item.id === transcriptId ? { ...item, mediaId } : item)
}

export async function ensureHistoryBackup(historyFile: string, backupFile: string): Promise<boolean> {
  const source = await fs.stat(historyFile).catch(() => undefined)
  if (!source?.isFile()) return false
  if (await fs.stat(backupFile).then((stat) => stat.isFile()).catch(() => false)) return false
  await fs.mkdir(path.dirname(backupFile), { recursive: true })
  try {
    await fs.copyFile(historyFile, backupFile, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  const copied = await fs.stat(backupFile)
  if (copied.size !== source.size) {
    await fs.rm(backupFile, { force: true })
    throw new Error('历史转写备份校验失败')
  }
  return true
}
