import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readPendingTranscriptionQueue, writePendingTranscriptionQueue } from './transcription-queue-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('transcription queue store', () => {
  it('round-trips only the lightweight job manifest through an atomic file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tingxie-queue-'))
    directories.push(directory)
    const file = path.join(directory, 'pending-transcriptions.json')
    const jobs = [{ id: 'job-1', path: 'D:\\media\\one.mp3', mediaId: 'media-1', batchId: 'batch-1', name: 'one.mp3', size: 123, duration: 45 }]

    await writePendingTranscriptionQueue(file, jobs)

    expect(await readPendingTranscriptionQueue(file)).toEqual(jobs)
    expect(await fs.readdir(directory)).toEqual(['pending-transcriptions.json'])
  })

  it('fails closed for malformed or unsupported queue files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tingxie-queue-'))
    directories.push(directory)
    const file = path.join(directory, 'pending-transcriptions.json')
    await fs.writeFile(file, '{"version":2,"jobs":[{"id":"unsafe"}]}', 'utf8')

    expect(await readPendingTranscriptionQueue(file)).toEqual([])
  })
})
