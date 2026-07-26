import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PendingTranscriptionJob } from './types'

interface StoredTranscriptionQueue {
  version: 1
  jobs: PendingTranscriptionJob[]
}

function validJob(value: unknown): value is PendingTranscriptionJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<PendingTranscriptionJob>
  return typeof job.id === 'string'
    && typeof job.path === 'string'
    && typeof job.name === 'string'
    && typeof job.size === 'number'
    && typeof job.duration === 'number'
}

export async function readPendingTranscriptionQueue(file: string): Promise<PendingTranscriptionJob[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<StoredTranscriptionQueue>
    return parsed.version === 1 && Array.isArray(parsed.jobs) ? parsed.jobs.filter(validJob) : []
  } catch {
    return []
  }
}

export async function writePendingTranscriptionQueue(file: string, jobs: PendingTranscriptionJob[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, jobs } satisfies StoredTranscriptionQueue, null, 2), 'utf8')
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
