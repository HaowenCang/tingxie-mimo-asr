import { promises as fs } from 'node:fs'
import path from 'node:path'

const TRANSCRIPTION_TEMP_PREFIX = 'tingxie-'

export async function cleanupStaleTranscriptionTempDirs(
  tempRoot: string,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const root = path.resolve(tempRoot)
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TRANSCRIPTION_TEMP_PREFIX)) continue
    const target = path.resolve(root, entry.name)
    if (path.dirname(target) !== root) continue
    const modifiedAt = await fs.stat(target).then((stat) => stat.mtimeMs).catch(() => now)
    if (now - modifiedAt < maxAgeMs) continue
    await fs.rm(target, { recursive: true, force: true })
    removed += 1
  }
  return removed
}
