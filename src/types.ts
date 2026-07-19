import type { AppPreferences, Language, ServiceMode, TranscriptResult } from '../electron/types'

export type QueueStatus = 'waiting' | 'preparing' | 'extracting' | 'transcribing' | 'done' | 'partial' | 'error' | 'cancelled'

export interface QueueFile {
  id: string
  path: string
  mediaId?: string
  name: string
  size: number
  duration: number
  status: QueueStatus
  progress: number
  detail?: string
  result?: TranscriptResult
}

export interface AppSettings {
  hasApiKey: boolean
  language: Language
  serviceMode: ServiceMode
  configuredServices: ServiceMode[]
  adaptiveConcurrency: boolean
  preferences: AppPreferences
  mediaLibraryRoot: string
}
