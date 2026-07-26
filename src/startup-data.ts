import type { AISettings, MediaLibrarySnapshot, PendingTranscriptionJob, TranscriptSummary } from '../electron/types'
import type { AppSettings } from './types'

export interface StartupDataApi {
  getSettings(): Promise<AppSettings>
  getHistory(): Promise<TranscriptSummary[]>
  getAISettings(): Promise<AISettings>
  getMediaLibrary(): Promise<MediaLibrarySnapshot>
  getPendingTranscriptionQueue(): Promise<PendingTranscriptionJob[]>
}

export interface StartupData {
  settings?: AppSettings
  history?: TranscriptSummary[]
  aiSettings?: AISettings
  mediaLibrary?: MediaLibrarySnapshot
  pendingTranscriptions?: PendingTranscriptionJob[]
  errors: Array<{ resource: 'settings' | 'history' | 'aiSettings' | 'mediaLibrary' | 'pendingTranscriptions'; error: unknown }>
}

export async function loadStartupData(api: StartupDataApi): Promise<StartupData> {
  const resources = ['settings', 'history', 'aiSettings', 'mediaLibrary', 'pendingTranscriptions'] as const
  const settled = await Promise.allSettled([
    api.getSettings(),
    api.getHistory(),
    api.getAISettings(),
    api.getMediaLibrary(),
    api.getPendingTranscriptionQueue(),
  ])
  const result: StartupData = { errors: [] }
  settled.forEach((entry, index) => {
    const resource = resources[index]
    if (entry.status === 'rejected') {
      result.errors.push({ resource, error: entry.reason })
      return
    }
    if (resource === 'settings') result.settings = entry.value as AppSettings
    if (resource === 'history') result.history = entry.value as TranscriptSummary[]
    if (resource === 'aiSettings') result.aiSettings = entry.value as AISettings
    if (resource === 'mediaLibrary') result.mediaLibrary = entry.value as MediaLibrarySnapshot
    if (resource === 'pendingTranscriptions') result.pendingTranscriptions = entry.value as PendingTranscriptionJob[]
  })
  return result
}
