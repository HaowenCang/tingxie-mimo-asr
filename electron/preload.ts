import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AIChatSession, AIProvider, AISettings, AIStreamEvent, AppPreferences, Language, MediaImportResult, MediaLibrarySnapshot, ProgressEvent, SelectedMedia, ServiceMode, TranscriptResult } from './types'

contextBridge.exposeInMainWorld('tingxie', {
  openFiles: (): Promise<SelectedMedia[]> => ipcRenderer.invoke('media:open'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  probeMedia: (path: string) => ipcRenderer.invoke('media:probe', path),
  transcribe: (input: { id: string; path: string; fileName: string; language: Language; mediaId?: string }) =>
    ipcRenderer.invoke('media:transcribe', input),
  getMediaLibrary: (): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:get'),
  importMedia: (sources: SelectedMedia[], folderId?: string): Promise<MediaImportResult> => ipcRenderer.invoke('library:import', { sources, folderId }),
  importMediaFolder: (folderId?: string): Promise<MediaImportResult | undefined> => ipcRenderer.invoke('library:import-folder', folderId),
  createMediaFolder: (name: string): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:create-folder', name),
  renameMediaFolder: (id: string, name: string): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:rename-folder', { id, name }),
  renameMediaAsset: (id: string, name: string): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:rename-asset', { id, name }),
  moveMediaAssets: (ids: string[], folderId?: string): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:move-assets', { ids, folderId }),
  deleteMediaAssets: (ids: string[]): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:delete-assets', ids),
  recoverHistoryMedia: (transcriptId: string): Promise<MediaLibrarySnapshot> => ipcRenderer.invoke('library:recover-history-media', transcriptId),
  chooseMediaLibraryRoot: (): Promise<MediaLibrarySnapshot | undefined> => ipcRenderer.invoke('library:choose-root'),
  cancel: (id: string) => ipcRenderer.invoke('media:cancel', id),
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: ProgressEvent) => callback(value)
    ipcRenderer.on('media:progress', listener)
    return () => ipcRenderer.removeListener('media:progress', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: { apiKey?: string; language: Language; serviceMode?: ServiceMode; adaptiveConcurrency?: boolean }) => ipcRenderer.invoke('settings:save', input),
  savePreferences: (input: Partial<AppPreferences>): Promise<AppPreferences> => ipcRenderer.invoke('preferences:save', input),
  testConnection: (input: { apiKey?: string; serviceMode: ServiceMode }) => ipcRenderer.invoke('settings:test', input),
  getAISettings: (): Promise<AISettings> => ipcRenderer.invoke('ai:settings:get'),
  saveAIProvider: (input: { provider: AIProvider; apiKey?: string }): Promise<AISettings> => ipcRenderer.invoke('ai:provider:save', input),
  deleteAIProvider: (id: string): Promise<AISettings> => ipcRenderer.invoke('ai:provider:delete', id),
  selectAIProvider: (id: string): Promise<AISettings> => ipcRenderer.invoke('ai:provider:select', id),
  testAIProvider: (input: { provider: AIProvider; apiKey?: string }): Promise<boolean> => ipcRenderer.invoke('ai:provider:test', input),
  acknowledgeTokenPlan: (): Promise<AISettings> => ipcRenderer.invoke('ai:token-plan:acknowledge'),
  getAIChat: (transcriptId: string): Promise<AIChatSession> => ipcRenderer.invoke('ai:chat:get', transcriptId),
  clearAIChat: (transcriptId: string): Promise<AIChatSession> => ipcRenderer.invoke('ai:chat:clear', transcriptId),
  sendAIMessage: (input: { requestId: string; transcript: TranscriptResult; providerId?: string; userMessage?: string; mode?: 'new' | 'regenerate' }): Promise<AIChatSession> => ipcRenderer.invoke('ai:chat:send', input),
  generateAnalysis: (input: { transcript: TranscriptResult; providerId?: string }): Promise<TranscriptResult> => ipcRenderer.invoke('ai:analysis:generate', input),
  cancelAIMessage: (requestId: string): Promise<boolean> => ipcRenderer.invoke('ai:chat:cancel', requestId),
  onAIStream: (callback: (event: AIStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: AIStreamEvent) => callback(value)
    ipcRenderer.on('ai:stream', listener)
    return () => ipcRenderer.removeListener('ai:stream', listener)
  },
  getHistory: (): Promise<TranscriptResult[]> => ipcRenderer.invoke('history:get'),
  updateHistory: (result: TranscriptResult): Promise<TranscriptResult> => ipcRenderer.invoke('history:update', result),
  getMediaUrl: (transcriptId: string): Promise<string> => ipcRenderer.invoke('media:get-url', transcriptId),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  copyText: (text: string) => ipcRenderer.invoke('transcript:copy', text),
  exportTranscript: (result: TranscriptResult) => ipcRenderer.invoke('transcript:export', result),
})
