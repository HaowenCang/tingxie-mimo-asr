import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachManagedMediaToHistory, ensureHistoryBackup } from './history-recovery'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('legacy history backup', () => {
  it('creates one verified backup without overwriting it on later reads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tingxie-history-recovery-'))
    tempDirs.push(root)
    const source = path.join(root, 'history.json')
    const backup = path.join(root, 'backups', 'history-before-media-library-0.11.json')
    await writeFile(source, '[{"id":"old-1","text":"旧转写"}]', 'utf8')

    expect(await ensureHistoryBackup(source, backup)).toBe(true)
    await writeFile(source, '[]', 'utf8')
    expect(await ensureHistoryBackup(source, backup)).toBe(false)
    expect(await readFile(backup, 'utf8')).toContain('旧转写')
  })

  it('links recovered media without changing the transcript content', () => {
    const history = [{
      id: 'old-1',
      fileName: 'recording.m4a',
      createdAt: '2026-07-01T00:00:00.000Z',
      text: '保留的转写文字',
      segments: [],
      duration: 60,
      sourcePath: 'D:/old/recording.m4a',
    }]

    const updated = attachManagedMediaToHistory(history, 'old-1', 'media-1')

    expect(updated[0]).toEqual({ ...history[0], mediaId: 'media-1' })
    expect(updated).not.toBe(history)
  })
})
