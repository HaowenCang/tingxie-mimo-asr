export type Language = 'auto' | 'zh' | 'en'
export type ServiceMode = 'payg' | 'token-plan'

export const SERVICE_BASE_URLS: Record<ServiceMode, string> = {
  payg: 'https://api.xiaomimimo.com/v1',
  'token-plan': 'https://token-plan-cn.xiaomimimo.com/v1',
}

export function serviceEndpoint(serviceMode: ServiceMode, pathname: string): string {
  return `${SERVICE_BASE_URLS[serviceMode]}/${pathname.replace(/^\/+/, '')}`
}

export interface SelectedMedia {
  path: string
  name: string
  size: number
}

export interface MediaFolder {
  id: string
  name: string
  parentId?: string
  createdAt: string
  updatedAt: string
}

export type MediaTranscriptStatus = 'untranscribed' | 'transcribed' | 'partial' | 'failed'

export interface MediaAsset {
  id: string
  displayName: string
  originalName: string
  relativePath: string
  size: number
  extension: string
  duration?: number
  folderId?: string
  transcriptId?: string
  transcriptStatus: MediaTranscriptStatus
  managed: boolean
  importedAt: string
  updatedAt: string
  originalPath?: string
}

export interface MediaLibrarySnapshot {
  rootPath: string
  folders: MediaFolder[]
  assets: MediaAsset[]
}

export interface MediaImportResult {
  library: MediaLibrarySnapshot
  importedIds: string[]
  duplicateIds: string[]
}

export interface MediaImportProgress {
  stage: 'scanning' | 'copying' | 'probing' | 'complete'
  completed: number
  total: number
  detail: string
}

export interface MediaInfo {
  duration: number
  codec: string
  sampleRate: number
  channels: number
}

export interface TranscriptSegment {
  id?: string
  start: number
  end?: number
  text: string
  status?: 'success' | 'failed'
  error?: string
  attempts?: number
  rateLimitWaits?: number
  estimated?: boolean
  manualStart?: number
  chunkIndexes?: number[]
}

export interface TranscriptChunkRecord {
  index: number
  start: number
  end: number
  overlapWithPrevious: number
  text: string
  status: 'success' | 'failed'
  error?: string
  attempts?: number
  rateLimitWaits?: number
}

export interface TranscriptChapter {
  id: string
  title: string
  summary: string
  startSegmentId: string
  endSegmentId: string
}

export interface TranscriptAnalysis {
  status: 'ready' | 'error'
  overview: string
  keywords: string[]
  chapters: TranscriptChapter[]
  keyPoints: string[]
  speechSummary: string[]
  actionItems: string[]
  providerId: string
  model: string
  generatedAt: string
  error?: string
}

export interface TranscriptResult {
  id: string
  fileName: string
  createdAt: string
  text: string
  segments: TranscriptSegment[]
  duration: number
  outcome?: 'complete' | 'partial' | 'failed'
  failedSegmentCount?: number
  sourcePath?: string
  mediaId?: string
  chunks?: TranscriptChunkRecord[]
  silences?: Array<{ start: number; end: number }>
  analysis?: TranscriptAnalysis
}

export interface TranscriptSummary {
  id: string
  fileName: string
  createdAt: string
  duration: number
  outcome?: 'complete' | 'partial' | 'failed'
  failedSegmentCount?: number
  segmentCount: number
  mediaId?: string
  sourceAvailable: boolean
  preview: string
  analysisStatus: 'none' | 'ready' | 'error'
}

export type AppTheme = 'system' | 'light' | 'dark'
export type AccentColor = 'blue' | 'purple' | 'teal'
export type ContentDensity = 'comfortable' | 'compact'
export type ParagraphLength = 'compact' | 'standard' | 'long'

export interface AppPreferences {
  theme: AppTheme
  uiScale: number
  uiFontScale: number
  transcriptFontSize: number
  smartFontSize: number
  chatFontSize: number
  chatPanelWidth: number
  captionFontSize: number
  sidebarCollapsed: boolean
  paragraphLength: ParagraphLength
  density: ContentDensity
  glassStrength: number
  accent: AccentColor
  reducedMotion: boolean
  defaultPlaybackRate: number
  defaultVolume: number
  seekSeconds: number
  skipSilence: boolean
  minimumSilenceSeconds: number
  autoFollow: boolean
  seekLeadSeconds: number
  autoGenerateAnalysis: boolean
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: 'system',
  uiScale: 100,
  uiFontScale: 100,
  transcriptFontSize: 16,
  smartFontSize: 12,
  chatFontSize: 13,
  chatPanelWidth: 410,
  captionFontSize: 12,
  sidebarCollapsed: false,
  paragraphLength: 'standard',
  density: 'comfortable',
  glassStrength: 55,
  accent: 'blue',
  reducedMotion: false,
  defaultPlaybackRate: 1,
  defaultVolume: 0.8,
  seekSeconds: 5,
  skipSilence: false,
  minimumSilenceSeconds: 0.8,
  autoFollow: true,
  seekLeadSeconds: 0.5,
  autoGenerateAnalysis: false,
}

export interface ProgressEvent {
  id: string
  stage: 'preparing' | 'extracting' | 'transcribing' | 'done' | 'error' | 'cancelled'
  progress: number
  detail?: string
}

export type AIProviderKind = 'mimo-payg' | 'mimo-token-plan' | 'openai-compatible'

export interface AIProvider {
  id: string
  name: string
  kind: AIProviderKind
  baseUrl: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  systemPrompt: string
  hasApiKey: boolean
  builtIn: boolean
}

export interface AISettings {
  providers: AIProvider[]
  selectedProviderId: string
  tokenPlanAcknowledged: boolean
  defaultSystemPrompt: string
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AIChatSession {
  transcriptId: string
  messages: AIMessage[]
  updatedAt: string
}

export interface AIStreamEvent {
  requestId: string
  transcriptId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  message?: string
}
