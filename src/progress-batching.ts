import type { ProgressEvent } from '../electron/types'
import type { QueueFile } from './types'

export function applyLatestProgressEvents(files: QueueFile[], events: ProgressEvent[]): QueueFile[] {
  if (!events.length) return files
  const latestByFile = new Map<string, ProgressEvent>()
  for (const event of events) latestByFile.set(event.id, event)
  let changed = false
  const next = files.map((file) => {
    const event = latestByFile.get(file.id)
    if (!event) return file
    changed = true
    return {
      ...file,
      status: event.stage === 'cancelled' ? 'cancelled' as const : event.stage,
      progress: event.progress,
      detail: event.detail,
    }
  })
  return changed ? next : files
}
