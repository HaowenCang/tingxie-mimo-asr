import type { AIChatSession, AIProvider, AISettings, AIStreamEvent, AppPreferences, BackgroundAnalysisEvent, BackgroundAnalysisQueueSnapshot, Language, MediaImportProgress, MediaImportResult, MediaInfo, MediaLibrarySnapshot, PendingTranscriptionJob, PreparedTranscription, ProgressEvent, SelectedMedia, ServiceMode, TranscriptDuplicateRepairResult, TranscriptDuplicateReport, TranscriptResult, TranscriptSummary, TranscriptionInput } from '../electron/types'

declare global {
  interface Window {
    tingxie?: {
      openFiles(): Promise<SelectedMedia[]>
      getPathForFile(file: File): string
      probeMedia(path: string): Promise<MediaInfo>
      transcribe(input: TranscriptionInput): Promise<TranscriptResult>
      prepareTranscription(input: TranscriptionInput): Promise<PreparedTranscription>
      transcribePrepared(id: string): Promise<TranscriptResult>
      discardPreparedTranscription(id: string): Promise<boolean>
      getPendingTranscriptionQueue(): Promise<PendingTranscriptionJob[]>
      savePendingTranscriptionQueue(jobs: PendingTranscriptionJob[]): Promise<void>
      getMediaLibrary(): Promise<MediaLibrarySnapshot>
      importMedia(sources: SelectedMedia[], folderId?: string): Promise<MediaImportResult>
      importMediaFolder(folderId?: string): Promise<MediaImportResult | undefined>
      onMediaImportProgress(callback: (event: MediaImportProgress) => void): () => void
      createMediaFolder(name: string, parentId?: string): Promise<MediaLibrarySnapshot>
      renameMediaFolder(id: string, name: string): Promise<MediaLibrarySnapshot>
      moveMediaFolder(id: string, parentId?: string): Promise<MediaLibrarySnapshot>
      deleteMediaFolder(id: string, mode: 'preserve-content' | 'delete-media'): Promise<MediaLibrarySnapshot>
      renameMediaAsset(id: string, name: string): Promise<MediaLibrarySnapshot>
      moveMediaAssets(ids: string[], folderId?: string): Promise<MediaLibrarySnapshot>
      deleteMediaAssets(ids: string[]): Promise<MediaLibrarySnapshot>
      showMediaItem(id: string): Promise<boolean>
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
      generateAnalysis(input: { transcriptId: string; providerId?: string }): Promise<BackgroundAnalysisQueueSnapshot>
      getAnalysisQueue(): Promise<BackgroundAnalysisQueueSnapshot>
      retryAnalysis(transcriptId: string): Promise<BackgroundAnalysisQueueSnapshot>
      onAnalysisQueue(callback: (event: BackgroundAnalysisEvent) => void): () => void
      cancelAIMessage(requestId: string): Promise<boolean>
      onAIStream(callback: (event: AIStreamEvent) => void): () => void
      getHistory(): Promise<TranscriptSummary[]>
      getTranscript(id: string): Promise<TranscriptResult | undefined>
      updateHistory(result: TranscriptResult): Promise<TranscriptSummary>
      patchTranscriptSegment(input: { transcriptId: string; segmentId: string; patch: Partial<TranscriptResult['segments'][number]> }): Promise<TranscriptSummary>
      renameTranscript(id: string, name: string): Promise<TranscriptResult>
      moveTranscripts(ids: string[], folderId?: string): Promise<TranscriptSummary[]>
      inspectTranscriptDuplicates(id: string): Promise<TranscriptDuplicateReport>
      repairTranscriptDuplicates(id: string): Promise<TranscriptDuplicateRepairResult>
      undoTranscriptDuplicateRepair(id: string): Promise<TranscriptResult>
      getMediaUrl(transcriptId: string): Promise<string>
      deleteHistory(id: string): Promise<boolean>
      deleteTranscripts(ids: string[]): Promise<string[]>
      copyText(text: string): Promise<boolean>
      exportTranscript(result: TranscriptResult): Promise<boolean>
    }
  }
}

export {}
