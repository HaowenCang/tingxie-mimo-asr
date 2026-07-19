import type { AIChatSession, AIProvider, AISettings, AIStreamEvent, AppPreferences, Language, MediaImportResult, MediaInfo, MediaLibrarySnapshot, ProgressEvent, SelectedMedia, ServiceMode, TranscriptResult } from '../electron/types'

declare global {
  interface Window {
    tingxie?: {
      openFiles(): Promise<SelectedMedia[]>
      getPathForFile(file: File): string
      probeMedia(path: string): Promise<MediaInfo>
      transcribe(input: { id: string; path: string; fileName: string; language: Language; mediaId?: string }): Promise<TranscriptResult>
      getMediaLibrary(): Promise<MediaLibrarySnapshot>
      importMedia(sources: SelectedMedia[], folderId?: string): Promise<MediaImportResult>
      importMediaFolder(folderId?: string): Promise<MediaImportResult | undefined>
      createMediaFolder(name: string): Promise<MediaLibrarySnapshot>
      renameMediaFolder(id: string, name: string): Promise<MediaLibrarySnapshot>
      renameMediaAsset(id: string, name: string): Promise<MediaLibrarySnapshot>
      moveMediaAssets(ids: string[], folderId?: string): Promise<MediaLibrarySnapshot>
      deleteMediaAssets(ids: string[]): Promise<MediaLibrarySnapshot>
      recoverHistoryMedia(transcriptId: string): Promise<MediaLibrarySnapshot>
      chooseMediaLibraryRoot(): Promise<MediaLibrarySnapshot | undefined>
      cancel(id: string): Promise<boolean>
      onProgress(callback: (event: ProgressEvent) => void): () => void
      getSettings(): Promise<{ hasApiKey: boolean; language: Language; serviceMode: ServiceMode; configuredServices: ServiceMode[]; adaptiveConcurrency: boolean; preferences: AppPreferences; mediaLibraryRoot: string }>
      saveSettings(input: { apiKey?: string; language: Language; serviceMode?: ServiceMode; adaptiveConcurrency?: boolean }): Promise<{ hasApiKey: boolean; language: Language; serviceMode: ServiceMode; configuredServices: ServiceMode[]; adaptiveConcurrency: boolean; preferences: AppPreferences; mediaLibraryRoot: string }>
      savePreferences(input: Partial<AppPreferences>): Promise<AppPreferences>
      testConnection(input: { apiKey?: string; serviceMode: ServiceMode }): Promise<boolean>
      getAISettings(): Promise<AISettings>
      saveAIProvider(input: { provider: AIProvider; apiKey?: string }): Promise<AISettings>
      deleteAIProvider(id: string): Promise<AISettings>
      selectAIProvider(id: string): Promise<AISettings>
      testAIProvider(input: { provider: AIProvider; apiKey?: string }): Promise<boolean>
      acknowledgeTokenPlan(): Promise<AISettings>
      getAIChat(transcriptId: string): Promise<AIChatSession>
      clearAIChat(transcriptId: string): Promise<AIChatSession>
      sendAIMessage(input: { requestId: string; transcript: TranscriptResult; providerId?: string; userMessage?: string; mode?: 'new' | 'regenerate' }): Promise<AIChatSession>
      generateAnalysis(input: { transcript: TranscriptResult; providerId?: string }): Promise<TranscriptResult>
      cancelAIMessage(requestId: string): Promise<boolean>
      onAIStream(callback: (event: AIStreamEvent) => void): () => void
      getHistory(): Promise<TranscriptResult[]>
      updateHistory(result: TranscriptResult): Promise<TranscriptResult>
      getMediaUrl(transcriptId: string): Promise<string>
      deleteHistory(id: string): Promise<boolean>
      copyText(text: string): Promise<boolean>
      exportTranscript(result: TranscriptResult): Promise<boolean>
    }
  }
}

export {}
