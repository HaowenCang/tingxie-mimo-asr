import type { QueueFile } from '../types'

export function isNearQueueBottom(metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>, threshold = 56): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

export function changedQueueFile(previous: QueueFile[], current: QueueFile[]): QueueFile | undefined {
  if (current.length > previous.length) return current[0]
  const previousById = new Map(previous.map((file) => [file.id, file]))
  return [...current].reverse().find((file) => {
    const old = previousById.get(file.id)
    return !old || old.status !== file.status || old.progress !== file.progress || old.detail !== file.detail
  })
}
