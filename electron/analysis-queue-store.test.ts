import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readBackgroundAnalysisJobs, writeBackgroundAnalysisJobs } from './analysis-queue-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('background analysis queue store', () => {
  it('round-trips lightweight jobs and fails closed for malformed data', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tingxie-analysis-queue-'))
    directories.push(directory)
    const file = path.join(directory, 'pending-analysis-jobs.json')
    const jobs = [
      {
        transcriptId: 'transcript-1',
        sourceRevision: 2,
        providerId: 'provider-1',
        origin: 'automatic' as const,
        status: 'queued' as const,
        attempts: 0,
        queuedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        transcriptId: 'transcript-dismissed',
        sourceRevision: 4,
        providerId: 'provider-1',
        origin: 'automatic' as const,
        status: 'dismissed' as const,
        attempts: 1,
        queuedAt: '2026-07-27T00:01:00.000Z',
      },
    ]

    await writeBackgroundAnalysisJobs(file, jobs)
    expect(await readBackgroundAnalysisJobs(file)).toEqual(jobs)

    await fs.writeFile(file, '{"version":2,"jobs":[{"transcriptId":"unsafe"}]}', 'utf8')
    expect(await readBackgroundAnalysisJobs(file)).toEqual([])
  })
})
