import type { AppPreferences, Language, ServiceMode, TranscriptResult } from '../electron/types'

export type QueueStatus =
  | 'waiting'
  | 'waiting-preparation'
  | 'preparing'
  | 'extracting'
  | 'ready'
  | 'waiting-api'
  | 'transcribing'
  | 'done'
  | 'partial'
  | 'error'
  | 'cancelled'
  | 'interrupted'

export interface QueueFile {
  id: string
  path: string
  mediaId?: string
  batchId?: string
  queuedAt?: string
  sourceFolderId?: string
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
