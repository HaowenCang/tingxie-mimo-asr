import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TranscriptResult } from './types'
import { TranscriptStore } from './transcript-store'

const tempDirectories: string[] = []

function record(id: string, text: string, createdAt = '2026-07-01T00:00:00.000Z'): TranscriptResult {
  return {
    id,
    fileName: `${id}.m4a`,
    createdAt,
    text,
    segments: [{ id: `${id}-segment`, start: 0, end: 10, text }],
    duration: 10,
    sourcePath: `D:/recordings/${id}.m4a`,
  }
}

async function fixture(items: TranscriptResult[]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tingxie-store-'))
  tempDirectories.push(directory)
  const legacyFile = path.join(directory, 'history.json')
  const storeRoot = path.join(directory, 'history')
  const backupFile = path.join(directory, 'backups', 'history-before-split-store-0.12.json')
  await writeFile(legacyFile, JSON.stringify(items, null, 2), 'utf8')
  return { directory, legacyFile, storeRoot, backupFile, store: new TranscriptStore({ storeRoot, legacyFile, backupFile }) }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('split transcript store migration', () => {
  it('migrates legacy history into summaries and separate records without changing the source', async () => {
    const items = [record('newer', '最新正文', '2026-07-02T00:00:00.000Z'), record('older', '较早正文')]
    const { legacyFile, storeRoot, backupFile, store } = await fixture(items)
    const legacyBefore = await readFile(legacyFile, 'utf8')

    const summaries = await store.listSummaries()

    expect(summaries.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(summaries[0]).toMatchObject({ preview: '最新正文', segmentCount: 1, sourceAvailable: true })
    expect(summaries[0]).not.toHaveProperty('segments')
    expect(await store.get('older')).toEqual(items[1])
    expect(await readFile(legacyFile, 'utf8')).toBe(legacyBefore)
    expect(await readFile(backupFile, 'utf8')).toBe(legacyBefore)
    expect(JSON.parse(await readFile(path.join(storeRoot, 'records', 'newer.json'), 'utf8'))).toEqual(items[0])
  })

  it('is idempotent after the split index has been committed', async () => {
    const { legacyFile, storeRoot, backupFile, store } = await fixture([record('old', '原始正文')])
    await store.listSummaries()
    await writeFile(legacyFile, JSON.stringify([record('replacement', '不应覆盖新存储')]), 'utf8')

    const reopened = new TranscriptStore({ storeRoot, legacyFile, backupFile })
    expect((await reopened.listSummaries()).map((item) => item.id)).toEqual(['old'])
    expect((await reopened.get('old'))?.text).toBe('原始正文')
  })

  it('loads summaries without reading record bodies until a detail is requested', async () => {
    const { storeRoot, legacyFile, backupFile, store } = await fixture([record('old', '按需加载正文')])
    await store.listSummaries()
    await rm(path.join(storeRoot, 'records', 'old.json'))

    const reopened = new TranscriptStore({ storeRoot, legacyFile, backupFile })
    expect((await reopened.listSummaries())[0].preview).toBe('按需加载正文')
    expect(await reopened.get('old')).toBeUndefined()
  })

  it('patches one segment without rewriting unrelated record files', async () => {
    const { storeRoot, store } = await fixture([record('first', '第一条'), record('second', '第二条')])
    await store.listSummaries()
    const unrelatedFile = path.join(storeRoot, 'records', 'second.json')
    const unrelatedBefore = await readFile(unrelatedFile, 'utf8')
    const unrelatedMtime = (await stat(unrelatedFile)).mtimeMs

    const updated = await store.patchSegment('first', 'first-segment', { text: '第一条已修改' })

    expect(updated.text).toBe('第一条已修改')
    expect(updated.segments[0].text).toBe('第一条已修改')
    expect(await readFile(unrelatedFile, 'utf8')).toBe(unrelatedBefore)
    expect((await stat(unrelatedFile)).mtimeMs).toBe(unrelatedMtime)
  })

  it('renames a transcript title without changing its text, media link or source path', async () => {
    const original = { ...record('first', '正文保持不变'), mediaId: 'asset-1' }
    const { store } = await fixture([original])

    const updated = await store.rename('first', '项目周会.m4a')

    expect(updated).toEqual({ ...original, fileName: '项目周会.m4a' })
    expect((await store.listSummaries())[0].fileName).toBe('项目周会.m4a')
  })

  it('does not commit an empty index when the legacy source is invalid', async () => {
    const { legacyFile, storeRoot, store } = await fixture([record('old', '原始正文')])
    await writeFile(legacyFile, '{invalid json', 'utf8')

    await expect(store.listSummaries()).rejects.toThrow()
    await expect(stat(path.join(storeRoot, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps valid legacy records readable when the split migration cannot be written', async () => {
    const { storeRoot, store } = await fixture([record('old', '仍可读取的旧正文')])
    await mkdir(storeRoot, { recursive: true })
    await writeFile(path.join(storeRoot, 'records'), 'blocks directory creation', 'utf8')

    expect((await store.listSummaries()).map((item) => item.id)).toEqual(['old'])
    expect((await store.get('old'))?.text).toBe('仍可读取的旧正文')
    await expect(stat(path.join(storeRoot, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
