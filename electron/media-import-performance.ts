export interface MediaImportConcurrency {
  copy: number
  probe: number
}

export function planMediaImportConcurrency(cpuCount: number, hasActiveTranscription: boolean): MediaImportConcurrency {
  if (hasActiveTranscription) return { copy: 1, probe: 1 }
  return {
    copy: 2,
    probe: Math.max(2, Math.min(6, Math.floor(cpuCount / 2) || 2)),
  }
}

export function shouldEmitImportProgress(completed: number, total: number): boolean {
  if (completed === 0 || completed >= total) return true
  const interval = Math.max(1, Math.ceil(total / 100))
  return completed % interval === 0
}
