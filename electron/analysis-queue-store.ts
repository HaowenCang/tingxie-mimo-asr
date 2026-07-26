import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BackgroundAnalysisJob, BackgroundAnalysisJobStatus } from './types'

interface StoredBackgroundAnalysisQueue {
  version: 1
  jobs: BackgroundAnalysisJob[]
}

const STATUSES = new Set<BackgroundAnalysisJobStatus>(['queued', 'running', 'retry-wait', 'blocked', 'failed'])

function validJob(value: unknown): value is BackgroundAnalysisJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<BackgroundAnalysisJob>
  return typeof job.transcriptId === 'string'
    && typeof job.providerId === 'string'
    && (job.origin === 'automatic' || job.origin === 'manual' || job.origin === undefined)
    && Number.isSafeInteger(job.sourceRevision)
    && typeof job.attempts === 'number'
    && typeof job.queuedAt === 'string'
    && typeof job.status === 'string'
    && STATUSES.has(job.status as BackgroundAnalysisJobStatus)
}

export async function readBackgroundAnalysisJobs(file: string): Promise<BackgroundAnalysisJob[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<StoredBackgroundAnalysisQueue>
    return parsed.version === 1 && Array.isArray(parsed.jobs)
      ? parsed.jobs.filter(validJob).map((job) => ({ ...job, origin: job.origin || 'automatic' }))
      : []
  } catch {
    return []
  }
}

export async function writeBackgroundAnalysisJobs(file: string, jobs: BackgroundAnalysisJob[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, jobs } satisfies StoredBackgroundAnalysisQueue, null, 2), 'utf8')
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
