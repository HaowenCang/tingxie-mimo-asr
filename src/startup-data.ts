import type { AISettings, MediaLibrarySnapshot, TranscriptSummary } from '../electron/types'
import type { AppSettings } from './types'

export interface StartupDataApi {
  getSettings(): Promise<AppSettings>
  getHistory(): Promise<TranscriptSummary[]>
  getAISettings(): Promise<AISettings>
  getMediaLibrary(): Promise<MediaLibrarySnapshot>
}

export interface StartupData {
  settings?: AppSettings
  history?: TranscriptSummary[]
  aiSettings?: AISettings
  mediaLibrary?: MediaLibrarySnapshot
  errors: Array<{ resource: 'settings' | 'history' | 'aiSettings' | 'mediaLibrary'; error: unknown }>
}

export async function loadStartupData(api: StartupDataApi): Promise<StartupData> {
  const resources = ['settings', 'history', 'aiSettings', 'mediaLibrary'] as const
  const settled = await Promise.allSettled([
    api.getSettings(),
    api.getHistory(),
    api.getAISettings(),
    api.getMediaLibrary(),
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
  })
  return result
}
