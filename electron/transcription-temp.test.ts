import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupStaleTranscriptionTempDirs } from './transcription-temp'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('transcription temporary directory cleanup', () => {
  it('removes only stale Tingxie directories inside the configured temp root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tingxie-cleanup-test-'))
    directories.push(root)
    const stale = path.join(root, 'tingxie-stale')
    const recent = path.join(root, 'tingxie-recent')
    const unrelated = path.join(root, 'other-app')
    await Promise.all([stale, recent, unrelated].map((directory) => fs.mkdir(directory)))
    const now = Date.now()
    await fs.utimes(stale, new Date(now - 48 * 60 * 60 * 1000), new Date(now - 48 * 60 * 60 * 1000))

    expect(await cleanupStaleTranscriptionTempDirs(root, now)).toBe(1)
    expect(await fs.readdir(root)).toEqual(['other-app', 'tingxie-recent'])
  })
})
