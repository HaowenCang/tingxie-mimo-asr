import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticLogWriter } from './diagnostic-log'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('diagnostic log batching', () => {
  it('flushes queued entries as one ordered batch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tingxie-log-'))
    tempDirectories.push(directory)
    const file = path.join(directory, 'logs', 'main.log')
    const writer = new DiagnosticLogWriter(file, { flushIntervalMs: 60_000 })

    writer.write('first', { jobId: 'job-1' })
    writer.write('second', { chunkIndex: 2 })
    await writer.flush()

    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { event: string })
    expect(lines.map((line) => line.event)).toEqual(['first', 'second'])
  })

  it('rotates using the cached size before writing the next batch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tingxie-log-'))
    tempDirectories.push(directory)
    const file = path.join(directory, 'main.log')
    const writer = new DiagnosticLogWriter(file, { maxBytes: 100, backups: 2, flushIntervalMs: 60_000 })

    writer.write('first', { detail: 'a'.repeat(80) })
    await writer.flush()
    writer.write('second', { detail: 'b'.repeat(80) })
    await writer.flush()

    expect(await readFile(`${file}.1`, 'utf8')).toContain('"event":"first"')
    expect(await readFile(file, 'utf8')).toContain('"event":"second"')
  })
})
