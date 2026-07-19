export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const rounded = Math.floor(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor(rounded % 3600 / 60)
  const secs = rounded % 60
  return hours
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
}

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toUpperCase() || '媒体'
}

export function statusLabel(status: string, detail?: string): string {
  if (detail) return detail
  return ({
    waiting: '等待转写',
    preparing: '正在分析媒体',
    extracting: '正在提取音频',
    transcribing: '正在转写',
    done: '转写完成',
    partial: '转写完成，存在失败片段',
    error: '转写失败',
    cancelled: '已取消',
  } as Record<string, string>)[status] || status
}

export function friendlyIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}
