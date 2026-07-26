import { Circle, CircleCheck, LoaderCircle, Sparkles, WifiOff } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_APP_PREFERENCES, type AIProvider, type AISettings, type AppPreferences, type BackgroundAnalysisQueueSnapshot, type Language, type MediaAsset, type MediaImportProgress, type MediaLibrarySnapshot, type PreparedTranscription, type ProgressEvent, type SelectedMedia, type ServiceMode, type TranscriptResult, type TranscriptSummary } from '../electron/types'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../electron/ai-system-prompt'
import { summarizeTranscript } from '../electron/transcript-summary'
import { QueuePanel } from './components/QueuePanel'
import { LayoutResizeHandle } from './components/LayoutResizeHandle'
import { clampLayoutValue, DEFAULT_SIDEBAR_WIDTH, DEFAULT_UPLOAD_PANE_HEIGHT } from './components/layout-resize'
import { clampChatPanelWidth, DEFAULT_CHAT_PANEL_WIDTH, PanelResizeHandle } from './components/PanelResizeHandle'
import { Sidebar } from './components/Sidebar'
import { addRecentTranscript } from './components/recent-transcripts'
import { buildAnalysisQueueView } from './components/analysis-queue-view-model'
import { UploadZone } from './components/UploadZone'
import type { AppSettings, QueueFile } from './types'
import { friendlyIpcError } from './utils'
import { loadStartupData } from './startup-data'
import { applyLatestProgressEvents } from './progress-batching'
import { MotionProvider } from './motion/MotionProvider'
import { motionVariants } from './motion/variants'
import { TranscriptionPipeline, type TranscriptionPipelineEvent } from './transcription-pipeline'
import { planBatchTranscription } from './batch-transcription'

const AIChatPanel = lazy(() => import('./components/AIChatPanel').then((module) => ({ default: module.AIChatPanel })))
const MediaLibraryView = lazy(() => import('./components/MediaLibraryView').then((module) => ({ default: module.MediaLibraryView })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal })))
const TranscriptDetail = lazy(() => import('./components/TranscriptDetail').then((module) => ({ default: module.TranscriptDetail })))
const AnalysisQueuePanel = lazy(() => import('./components/AnalysisQueuePanel').then((module) => ({ default: module.AnalysisQueuePanel })))

function DeferredView({ label, className = 'deferred-view' }: { label: string; className?: string }) {
  return <div className={className} role="status"><LoaderCircle className="spin" size={20} />{label}</div>
}

async function runCancellableIpc<T>(jobId: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new DOMException('任务已取消', 'AbortError')
  const cancel = () => { void window.tingxie?.cancel(jobId) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await operation()
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

const demoParameters = new URLSearchParams(location.search)
const isDemo = import.meta.env.DEV && demoParameters.has('demo')
const isLongDemo = isDemo && demoParameters.has('long')
const isLargeMediaDemo = isDemo && demoParameters.has('large-library')
const isEmptyWorkspaceDemo = isDemo && demoParameters.has('empty-workspace')
const isQueueOverflowDemo = isDemo && demoParameters.has('queue-overflow')
const isQueueEmptyDemo = isDemo && demoParameters.has('queue-empty')
const isLongNameDemo = isDemo && demoParameters.has('long-name')
const isLegacyHistoryDemo = isDemo && demoParameters.has('legacy-history')
const isDuplicateDemo = isDemo && demoParameters.has('duplicate-transcript')
const isAnalysisQueueDemo = isDemo && demoParameters.has('analysis-queue')
const demoLongText = '这是用于验证超长转写排版的演示文本，每一句都应连续排列，不应在下一个时间段之前留下大段空白。'.repeat(260)

const demoRepeatedText = '所以这是一个现代化的高速公路体系，就是和全球对接的一个高速公路体系。如果没有这个高速公路体系，中国的创新药有一个全球标准和全球路径，这是非常重要的。'
const demoSegments: TranscriptResult['segments'] = isDuplicateDemo ? [
  { id: 'duplicate-0', start: 0, end: 30, text: demoRepeatedText, status: 'success', chunkIndexes: [0] },
  { id: 'duplicate-1', start: 30, end: 60, text: demoRepeatedText, status: 'success', chunkIndexes: [0] },
  { id: 'duplicate-2', start: 60, end: 90, text: demoRepeatedText, status: 'success', chunkIndexes: [0] },
  { id: 'duplicate-next', start: 90, end: 120, text: '接下来讨论不同的内容，因此这一段应当完整保留。', status: 'success', chunkIndexes: [0] },
] : isLongDemo ? [
  { start: 0, end: 300, text: demoLongText, status: 'success' },
  { start: 300, end: 360, text: '', status: 'failed', error: '服务暂时不可用', attempts: 2 },
  { start: 360, end: 420, text: '这是失败片段之后的转写内容，应紧接错误提示显示。', status: 'success' },
] : [
  { start: 0, text: '大家好，今天是我们的产品周会。首先回顾一下本周的重点工作。' },
  { start: 8, text: '在产品方面，我们完成了新功能的需求评审，并与设计团队对齐了交互细节。开发团队已经开始编码，预计将在下周完成第一轮开发并进入测试阶段。' },
  { start: 28, text: '在用户增长方面，本周我们上线了新的落地页，初步数据显示转化率有小幅提升。我们会继续关注数据表现，并进行 A/B 测试优化。' },
  { start: 62, text: '最后，请各团队同步下周的计划和需要支持的事项。谢谢大家。' },
]

const demoResult: TranscriptResult = {
  id: 'demo-1', fileName: '产品周会.mp4', createdAt: new Date().toISOString(), duration: 4365,
  text: demoSegments.map((segment) => segment.status === 'failed' ? `[${segment.start}秒–${segment.end}秒 转写失败]` : segment.text).join('\n\n'),
  segments: demoSegments,
  outcome: isLongDemo ? 'partial' : 'complete',
  failedSegmentCount: isLongDemo ? 1 : 0,
  silences: [{ start: 17, end: 19.2 }, { start: 53, end: 55.4 }],
  analysis: {
    status: 'ready', providerId: 'mimo-payg', model: 'mimo-v2.5', generatedAt: new Date().toISOString(),
    keywords: ['产品周会', '需求评审', '开发进度', '用户增长', 'A/B 测试'],
    overview: '会议回顾了产品需求评审与开发进度，确认下周进入第一轮测试；增长侧的新落地页已带来初步转化提升，后续将通过 A/B 测试继续优化。',
    chapters: [
      { id: 'chapter-0', title: '本周产品进展与开发安排', summary: '需求与交互已完成对齐，开发进入编码阶段，目标是在下周进入测试。', startSegmentId: 'segment-0', endSegmentId: 'segment-1' },
      { id: 'chapter-1', title: '增长实验与下周计划', summary: '新落地页初步提升转化率，团队将继续观察数据并推进 A/B 测试。', startSegmentId: 'segment-2', endSegmentId: 'segment-3' },
    ],
    keyPoints: ['需求评审和交互对齐已完成', '下周启动第一轮测试', '落地页转化率有小幅提升'],
    speechSummary: ['先回顾本周产品交付，再说明增长实验结果，最后收集各团队下周计划。'],
    actionItems: ['开发团队完成第一轮开发并进入测试', '增长团队继续跟踪落地页数据并开展 A/B 测试'],
  },
}

const demoFiles: QueueFile[] = isQueueEmptyDemo ? [] : [
  { id: 'demo-1', path: '', name: '产品周会.mp4', size: 1_331_433_472, duration: 4365, status: isLongDemo ? 'partial' : 'extracting', progress: isLongDemo ? 100 : 42, detail: isLongDemo ? '转写完成，1 个片段失败' : isQueueOverflowDemo ? '正在识别较长音频的第 18 个片段，服务返回了需要等待后重试的详细进度信息；此内容应当自动换行，并可在较小窗口中完整查看。' : '正在提取音频 42%', result: demoResult },
  { id: 'demo-2', path: '', name: '项目复盘.wav', size: 818_518_426, duration: 2912, status: 'waiting', progress: 0 },
  { id: 'demo-3', path: '', name: '客户访谈.mp3', size: 34_812_928, duration: 2178, status: 'done', progress: 100, result: { ...demoResult, id: 'demo-3', fileName: '客户访谈.mp3' } },
  ...(isQueueOverflowDemo ? Array.from({ length: 12 }, (_, index): QueueFile => ({ id: `queue-demo-${index}`, path: '', name: `批量访谈录音 ${index + 1}.m4a`, size: 22_000_000 + index, duration: 1200 + index * 30, status: 'waiting', progress: 0 })) : []),
]

const demoLegacyResult: TranscriptResult = {
  ...demoResult,
  id: 'legacy-text-only',
  fileName: '没有对应音频的历史访谈记录（长名称用于验证自动换行）.mp3',
  sourcePath: undefined,
  mediaId: undefined,
}
const demoHistory = [
  ...demoFiles.flatMap((file) => file.result ? [summarizeTranscript(file.result)] : []),
  ...(isLegacyHistoryDemo ? [summarizeTranscript(demoLegacyResult)] : []),
  ...(isAnalysisQueueDemo ? [
    { ...summarizeTranscript(demoResult), id: 'analysis-missing', fileName: '历史访谈（尚未生成速览）.mp3', analysisStatus: 'none' as const },
    { ...summarizeTranscript(demoResult), id: 'analysis-stale', revision: 2, fileName: '项目评审（原文已修改）.wav', analysisStatus: 'stale' as const },
    { ...summarizeTranscript(demoResult), id: 'analysis-error', fileName: '客户研究（上次生成失败）.m4a', analysisStatus: 'error' as const },
    { ...summarizeTranscript(demoResult), id: 'analysis-running', fileName: '年度规划会议.mp4', analysisStatus: 'none' as const },
  ] : []),
]

const demoAnalysisQueue: BackgroundAnalysisQueueSnapshot = isAnalysisQueueDemo ? {
  activeTranscriptId: 'analysis-running',
  jobs: [
    {
      transcriptId: 'analysis-running',
      sourceRevision: 0,
      providerId: 'mimo-payg',
      origin: 'automatic',
      status: 'running',
      attempts: 1,
      queuedAt: new Date().toISOString(),
    },
    {
      transcriptId: 'analysis-failed',
      sourceRevision: 0,
      providerId: 'mimo-payg',
      origin: 'automatic',
      status: 'failed',
      attempts: 3,
      queuedAt: new Date(Date.now() - 600_000).toISOString(),
      error: 'AI 返回的 JSON 结构无效',
    },
  ],
} : { jobs: [] }

const initialAISettings: AISettings = {
  providers: [
    { id: 'mimo-payg', name: '小米 MiMo（按量）', kind: 'mimo-payg', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5', contextWindow: 1_048_576, maxOutputTokens: 8192, systemPrompt: DEFAULT_AI_SYSTEM_PROMPT, hasApiKey: isDemo, builtIn: true },
    { id: 'mimo-token-plan', name: '小米 MiMo（Token Plan）', kind: 'mimo-token-plan', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.5', contextWindow: 1_048_576, maxOutputTokens: 8192, systemPrompt: DEFAULT_AI_SYSTEM_PROMPT, hasApiKey: isDemo, builtIn: true },
  ],
  selectedProviderId: 'mimo-payg',
  tokenPlanAcknowledged: false,
  defaultSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
}

const demoLibrary: MediaLibrarySnapshot = {
  rootPath: 'D:\\听写媒体库',
  folders: [
    { id: 'folder-meetings', name: '会议记录', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'folder-project', name: '产品项目', parentId: 'folder-meetings', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'folder-interviews', name: '客户访谈', parentId: 'folder-project', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  assets: (isLargeMediaDemo ? Array.from({ length: 10_000 }, (_, index): QueueFile => ({
    id: `large-${index}`,
    path: '',
    name: `性能测试录音 ${String(index + 1).padStart(5, '0')}.m4a`,
    size: 8_000_000 + index,
    duration: 1800 + index % 900,
    status: index % 3 === 0 ? 'done' : 'waiting',
    progress: index % 3 === 0 ? 100 : 0,
  })) : demoFiles).map((file, index) => ({
    id: `media-${index}`,
    displayName: isLongNameDemo && index === 0 ? '瞭望 [11] 【瞭望】对话百利天恒创始人——全球首款 ADC 药物是如何炼成的？ [温竣岩] [超清 4K] [47分13秒] Mjk.mp4' : file.name,
    originalName: file.name,
    relativePath: `media\\media-${index}.${file.name.split('.').at(-1)}`,
    size: file.size,
    extension: file.name.split('.').at(-1)?.toLocaleUpperCase() || 'AUDIO',
    duration: file.duration,
    folderId: index === 0 ? 'folder-project' : index === 1 ? 'folder-interviews' : undefined,
    transcriptId: file.result?.id,
    transcriptStatus: file.status === 'done' ? 'transcribed' : file.status === 'partial' ? 'partial' : 'untranscribed',
    managed: true,
    importedAt: new Date(Date.now() - index * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  })),
}

export function App() {
  const [currentPage, setCurrentPage] = useState<'new' | 'library'>('new')
  const [files, setFiles] = useState<QueueFile[]>(isDemo ? demoFiles : [])
  const [selectedResult, setSelectedResult] = useState<TranscriptResult | undefined>(isDemo && !isEmptyWorkspaceDemo ? demoResult : undefined)
  const [recentTranscripts, setRecentTranscripts] = useState<TranscriptSummary[]>(isDemo && !isEmptyWorkspaceDemo ? [summarizeTranscript(demoResult)] : [])
  const [settings, setSettings] = useState<AppSettings>({ hasApiKey: isDemo, language: 'auto', serviceMode: 'payg', configuredServices: isDemo ? ['payg'] : [], adaptiveConcurrency: true, preferences: DEFAULT_APP_PREFERENCES, mediaLibraryRoot: demoLibrary.rootPath })
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrarySnapshot>(isDemo ? demoLibrary : { rootPath: '', folders: [], assets: [] })
  const [mediaImportProgress, setMediaImportProgress] = useState<MediaImportProgress>()
  const [aiSettings, setAISettings] = useState<AISettings>(initialAISettings)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'asr' | 'ai' | 'personalize'>('asr')
  const [chatOpen, setChatOpen] = useState(isDemo && demoParameters.has('markdown'))
  const [history, setHistory] = useState<TranscriptSummary[]>(isDemo ? demoHistory : [])
  const [loadingSettings, setLoadingSettings] = useState(!isDemo)
  const [analysisQueue, setAnalysisQueue] = useState<BackgroundAnalysisQueueSnapshot>(demoAnalysisQueue)
  const [analysisLocalError, setAnalysisLocalError] = useState(isDemo && demoParameters.has('analysis-error') ? 'AI 返回的 JSON 格式无效；已自动修复重试 1 次，请稍后重试。' : '')
  const [showAnalysisQueue, setShowAnalysisQueue] = useState(isAnalysisQueueDemo)
  const [chatPanelWidth, setChatPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [uploadPaneHeight, setUploadPaneHeight] = useState(DEFAULT_UPLOAD_PANE_HEIGHT)
  const [shellWidth, setShellWidth] = useState(() => window.innerWidth)
  const shellRef = useRef<HTMLDivElement>(null)
  const preferredChatPanelWidth = useRef(DEFAULT_CHAT_PANEL_WIDTH)
  const latestSettingsRef = useRef(settings)
  latestSettingsRef.current = settings
  const pipelineRef = useRef<TranscriptionPipeline<QueueFile, PreparedTranscription, TranscriptResult> | undefined>(undefined)
  const historySaveTimer = useRef<number | undefined>(undefined)
  const queueLoadedRef = useRef(isDemo)
  const progressFrameRef = useRef<number | undefined>(undefined)
  const mediaImportClearTimer = useRef<number | undefined>(undefined)
  const pendingProgressEventsRef = useRef(new Map<string, ProgressEvent>())

  function handleCompletedPipelineJob(job: QueueFile, result: TranscriptResult) {
    if (!job.batchId) setSelectedResult(result)
    const summary = summarizeTranscript(result)
    setRecentTranscripts((current) => addRecentTranscript(current, summary))
    setHistory((current) => [summary, ...current.filter((item) => item.id !== result.id)])
    window.tingxie?.getMediaLibrary().then(setMediaLibrary).catch(() => undefined)
  }

  if (!pipelineRef.current) {
    pipelineRef.current = new TranscriptionPipeline({
      preparationConcurrency: 3,
      preparationWindow: 3,
      prepare: (job, signal) => runCancellableIpc(job.id, signal, async () => {
        if (!window.tingxie) throw new Error('桌面服务不可用')
        return window.tingxie.prepareTranscription({
          id: job.id,
          path: job.path,
          fileName: job.name,
          language: latestSettingsRef.current.language,
          mediaId: job.mediaId,
        })
      }),
      transcribe: (job, _prepared, signal) => runCancellableIpc(job.id, signal, async () => {
        if (!window.tingxie) throw new Error('桌面服务不可用')
        return window.tingxie.transcribePrepared(job.id)
      }),
      discardPrepared: async (job) => {
        await window.tingxie?.discardPreparedTranscription(job.id)
      },
      onEvent: (event: TranscriptionPipelineEvent<QueueFile, TranscriptResult>) => {
        const status = event.status === 'ready'
          ? 'waiting-api'
          : event.status === 'done' && event.result?.outcome === 'partial'
            ? 'partial'
            : event.status === 'done' && event.result?.outcome === 'failed'
              ? 'error'
              : event.status
        const detail = event.status === 'waiting-preparation'
          ? '等待本地预处理'
          : event.status === 'preparing'
            ? '正在准备音频'
            : event.status === 'ready'
              ? '音频片段已准备，等待 API 转写'
              : event.status === 'transcribing'
                ? '正在调用 API 转写'
                : event.status === 'cancelled'
                  ? '已取消'
                  : event.status === 'error'
                    ? friendlyIpcError(event.error, '转写失败')
                    : undefined
        setFiles((current) => current.map((item) => item.id === event.job.id ? {
          ...item,
          status,
          detail: detail ?? item.detail,
          ...(event.status === 'preparing' || event.status === 'transcribing' || event.status === 'error' || event.status === 'cancelled' ? { progress: 0 } : {}),
          ...(event.result ? { result: event.result, progress: 100 } : {}),
        } : item))
        if (event.status === 'done' && event.result) handleCompletedPipelineJob(event.job, event.result)
      },
    })
  }

  const scheduleProgressUpdate = useCallback((event: ProgressEvent) => {
    pendingProgressEventsRef.current.set(event.id, event)
    if (progressFrameRef.current !== undefined) return
    progressFrameRef.current = requestAnimationFrame(() => {
      progressFrameRef.current = undefined
      const events = [...pendingProgressEventsRef.current.values()]
      pendingProgressEventsRef.current.clear()
      setFiles((current) => applyLatestProgressEvents(current, events))
    })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const preferences = settings.preferences
    root.dataset.theme = preferences.theme
    root.dataset.accent = preferences.accent
    root.dataset.density = preferences.density
    root.dataset.reducedMotion = String(preferences.reducedMotion)
    root.style.setProperty('--ui-scale', `${preferences.uiScale / 100}`)
    root.style.setProperty('--ui-font-size', `${16 * preferences.uiFontScale / 100}px`)
    root.style.setProperty('--transcript-font-size', `${preferences.transcriptFontSize}px`)
    root.style.setProperty('--transcript-meta-font-size', `${Math.max(preferences.captionFontSize, Math.min(15, preferences.transcriptFontSize * 0.72))}px`)
    root.style.setProperty('--smart-font-size', `${preferences.smartFontSize}px`)
    root.style.setProperty('--smart-meta-font-size', `${Math.max(preferences.captionFontSize, Math.min(14, preferences.smartFontSize * 0.82))}px`)
    root.style.setProperty('--chat-font-size', `${preferences.chatFontSize}px`)
    root.style.setProperty('--chat-meta-font-size', `${Math.max(preferences.captionFontSize, Math.min(14, preferences.chatFontSize * 0.82))}px`)
    root.style.setProperty('--caption-font-size', `${preferences.captionFontSize}px`)
    root.style.setProperty('--glass-alpha', `${0.48 + preferences.glassStrength / 220}`)
    root.style.setProperty('--glass-blur', `${14 + preferences.glassStrength * 0.18}px`)
    root.style.setProperty('--glass-saturation', `${115 + preferences.glassStrength * 0.7}%`)
    root.style.setProperty('--glass-edge-opacity', `${0.5 + preferences.glassStrength / 200}`)
  }, [settings.preferences])

  useEffect(() => {
    setSidebarWidth(settings.preferences.sidebarWidth)
    setUploadPaneHeight(settings.preferences.uploadPaneHeight)
  }, [settings.preferences.sidebarWidth, settings.preferences.uploadPaneHeight])

  useEffect(() => {
    const policy = settings.preferences.preparationMode === 'unlimited'
      ? 'unlimited'
      : settings.preferences.preparationMode === 'sequential'
        ? 1
        : settings.preferences.preparationConcurrency
    pipelineRef.current?.setPreparationPolicy(policy, policy)
  }, [settings.preferences.preparationMode, settings.preferences.preparationConcurrency])

  useEffect(() => {
    if (!(isDemo && demoParameters.has('analysis-error'))) setAnalysisLocalError('')
  }, [selectedResult?.id])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const updateWidth = () => {
      const nextShellWidth = shell.clientWidth
      setShellWidth(nextShellWidth)
      setChatPanelWidth(clampChatPanelWidth(preferredChatPanelWidth.current, nextShellWidth))
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(shell)
    updateWidth()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    preferredChatPanelWidth.current = settings.preferences.chatPanelWidth
    setChatPanelWidth(clampChatPanelWidth(settings.preferences.chatPanelWidth, shellRef.current?.clientWidth || window.innerWidth))
  }, [settings.preferences.chatPanelWidth])

  useEffect(() => {
    if (!window.tingxie || isDemo) return
    loadStartupData(window.tingxie)
      .then((data) => {
        if (data.settings) setSettings(data.settings)
        if (data.history) setHistory(data.history)
        if (data.aiSettings) setAISettings(data.aiSettings)
        if (data.mediaLibrary) setMediaLibrary(data.mediaLibrary)
        if (data.pendingTranscriptions?.length) {
          setFiles(data.pendingTranscriptions.map((job): QueueFile => ({
            ...job,
            status: 'interrupted',
            progress: 0,
            detail: '应用上次退出时任务尚未完成，可点击重试',
          })))
        }
        queueLoadedRef.current = true
      })
      .finally(() => setLoadingSettings(false))
    void window.tingxie.getAnalysisQueue().then(setAnalysisQueue).catch(() => undefined)
    const unsubscribe = window.tingxie.onProgress(scheduleProgressUpdate)
    const unsubscribeImport = window.tingxie.onMediaImportProgress((progress) => {
      window.clearTimeout(mediaImportClearTimer.current)
      setMediaImportProgress(progress)
      if (progress.stage === 'complete') mediaImportClearTimer.current = window.setTimeout(() => setMediaImportProgress(undefined), 1800)
    })
    const unsubscribeAnalysis = window.tingxie.onAnalysisQueue((event) => {
      setAnalysisQueue(event.snapshot)
      if (!event.completed) return
      setHistory((current) => [event.completed!, ...current.filter((item) => item.id !== event.completed!.id)])
      setRecentTranscripts((current) => current.some((item) => item.id === event.completed!.id)
        ? addRecentTranscript(current, event.completed!)
        : current)
      void window.tingxie?.getTranscript(event.completed.id).then((result) => {
        if (!result) return
        setSelectedResult((current) => current?.id === result.id ? result : current)
        setFiles((current) => current.map((file) => file.id === result.id ? { ...file, result } : file))
      }).catch(() => undefined)
    })
    return () => {
      unsubscribe()
      unsubscribeImport()
      unsubscribeAnalysis()
      window.clearTimeout(mediaImportClearTimer.current)
      if (progressFrameRef.current !== undefined) cancelAnimationFrame(progressFrameRef.current)
      pendingProgressEventsRef.current.clear()
    }
  }, [scheduleProgressUpdate])

  const pendingQueueJobs = useMemo(() => {
    const pendingStatuses = new Set<QueueFile['status']>(['waiting', 'waiting-preparation', 'preparing', 'extracting', 'ready', 'waiting-api', 'transcribing', 'interrupted'])
    return files.filter((file) => pendingStatuses.has(file.status)).map((file) => ({
      id: file.id,
      path: file.path,
      mediaId: file.mediaId,
      batchId: file.batchId,
      queuedAt: file.queuedAt,
      sourceFolderId: file.sourceFolderId,
      name: file.name,
      size: file.size,
      duration: file.duration,
    }))
  }, [files])
  const pendingQueueSignature = JSON.stringify(pendingQueueJobs)

  useEffect(() => {
    if (!window.tingxie || isDemo || !queueLoadedRef.current) return
    void window.tingxie.savePendingTranscriptionQueue(pendingQueueJobs).catch(() => undefined)
  }, [pendingQueueSignature])

  function enqueue(file: QueueFile) {
    enqueueFiles([file])
  }

  function enqueueFiles(input: QueueFile[]) {
    const queuedAt = new Date().toISOString()
    const jobs = input
      .filter((file) => Boolean(file.path))
      .map((file) => ({ ...file, status: 'waiting-preparation' as const, progress: 0, detail: undefined, queuedAt: file.queuedAt || queuedAt }))
    if (!jobs.length) return
    const jobsById = new Map(jobs.map((job) => [job.id, job]))
    setFiles((current) => current.map((file) => jobsById.get(file.id) || file))
    pipelineRef.current?.enqueue(jobs)
  }

  async function addSelected(selected: SelectedMedia[]) {
    if (!selected.length) return
    if (!window.tingxie) return
    if (!settings.hasApiKey) setShowSettings(true)
    const imported = await window.tingxie.importMedia(selected)
    setMediaLibrary(imported.library)
    const assetsBySource = new Map(imported.library.assets.flatMap((asset) => asset.originalPath
      ? [[`${asset.originalPath.replace(/\\/g, '/').toLocaleLowerCase()}\0${asset.size}`, asset] as const]
      : []))
    const batchId = selected.length > 1 ? crypto.randomUUID() : undefined
    const created = selected.map((file): QueueFile | undefined => {
      const asset = assetsBySource.get(`${file.path.replace(/\\/g, '/').toLocaleLowerCase()}\0${file.size}`)
      if (!asset) return undefined
      const id = crypto.randomUUID()
      return { id, batchId, mediaId: asset.id, sourceFolderId: asset.folderId, path: managedAssetPath(imported.library, asset), name: asset.displayName, size: asset.size, duration: asset.duration || 0, status: 'waiting', progress: 0 }
    }).filter((file): file is QueueFile => Boolean(file))
    setFiles((current) => [...created, ...current])
    if (settings.hasApiKey) enqueueFiles(created)
  }

  function managedAssetPath(library: MediaLibrarySnapshot, asset: MediaAsset): string {
    return `${library.rootPath.replace(/[\\/]+$/, '')}\\${asset.relativePath}`
  }

  function transcribeLibraryAsset(asset: MediaAsset) {
    const file: QueueFile = { id: crypto.randomUUID(), mediaId: asset.id, sourceFolderId: asset.folderId, path: managedAssetPath(mediaLibrary, asset), name: asset.displayName, size: asset.size, duration: asset.duration || 0, status: 'waiting', progress: 0 }
    setFiles((current) => [file, ...current])
    setCurrentPage('new')
    setSelectedResult(undefined)
    if (!settings.hasApiKey) setShowSettings(true)
    else enqueue(file)
  }

  function transcribeLibraryAssets(assets: MediaAsset[], includeFailed: boolean) {
    if (!settings.hasApiKey) {
      setSettingsSection('asr')
      setShowSettings(true)
      return
    }
    const plan = planBatchTranscription(assets, queuedMediaIds, includeFailed)
    if (!plan.eligible.length) return
    const batchId = crypto.randomUUID()
    const queuedAt = new Date().toISOString()
    const jobs: QueueFile[] = plan.eligible.map((asset) => ({
      id: crypto.randomUUID(),
      batchId,
      queuedAt,
      mediaId: asset.id,
      sourceFolderId: asset.folderId,
      path: managedAssetPath(mediaLibrary, asset),
      name: asset.displayName,
      size: asset.size,
      duration: asset.duration || 0,
      status: 'waiting-preparation',
      progress: 0,
    }))
    setFiles((current) => [...jobs, ...current])
    setCurrentPage('new')
    setSelectedResult(undefined)
    setChatOpen(false)
    enqueueFiles(jobs)
  }

  async function importLibraryFiles(folderId?: string) {
    if (!window.tingxie) return
    const selected = await window.tingxie.openFiles()
    if (!selected.length) return
    setMediaLibrary((await window.tingxie.importMedia(selected, folderId)).library)
  }

  async function importLibraryFolder(folderId?: string) {
    if (!window.tingxie) return
    const result = await window.tingxie.importMediaFolder(folderId)
    if (result) setMediaLibrary(result.library)
  }

  async function chooseFiles() {
    if (!window.tingxie) return
    await addSelected(await window.tingxie.openFiles())
  }

  async function dropFiles(dropped: File[]) {
    if (!window.tingxie) return
    const selected = await Promise.all(dropped.map(async (file) => ({ path: window.tingxie!.getPathForFile(file), name: file.name, size: file.size })))
    await addSelected(selected.filter((file) => file.path))
  }

  async function saveSettings(apiKey: string, language: Language, serviceMode: ServiceMode, adaptiveConcurrency: boolean) {
    if (!window.tingxie) return
    const next = await window.tingxie.saveSettings({ apiKey: apiKey || undefined, language, serviceMode, adaptiveConcurrency })
    setSettings(next)
  }

  const savePreferences = useCallback(async (preferences: AppPreferences) => {
    const next = window.tingxie ? await window.tingxie.savePreferences(preferences) : preferences
    setSettings((current) => ({ ...current, preferences: next }))
  }, [])

  const openNewTranscriptWorkspace = useCallback(() => {
    setCurrentPage('new')
    setSelectedResult(undefined)
    setChatOpen(false)
    setAnalysisLocalError('')
  }, [])

  function navigate(page: 'new' | 'library') {
    if (page === 'new') {
      openNewTranscriptWorkspace()
      return
    }
    setCurrentPage('library')
    setChatOpen(false)
  }

  function previewChatPanelWidth(width: number) {
    preferredChatPanelWidth.current = width
    setChatPanelWidth(width)
  }

  function commitChatPanelWidth(width: number) {
    const normalized = Math.min(720, Math.max(340, Math.round(width)))
    preferredChatPanelWidth.current = normalized
    setChatPanelWidth(clampChatPanelWidth(normalized, shellRef.current?.clientWidth || shellWidth))
    if (normalized !== settings.preferences.chatPanelWidth) void savePreferences({ ...settings.preferences, chatPanelWidth: normalized }).catch(() => undefined)
  }

  function commitPrimaryLayout(key: 'sidebarWidth' | 'uploadPaneHeight', value: number) {
    if (settings.preferences[key] === value) return
    void savePreferences({ ...settings.preferences, [key]: value }).catch(() => undefined)
  }

  const updateResult = useCallback((result: TranscriptResult, persist = true) => {
    setSelectedResult(result)
    setFiles((current) => current.map((file) => file.id === result.id ? { ...file, result } : file))
    const summary = summarizeTranscript(result)
    setRecentTranscripts((current) => current.some((item) => item.id === summary.id) ? addRecentTranscript(current, summary) : current)
    setHistory((current) => [summary, ...current.filter((item) => item.id !== result.id)])
    if (persist && window.tingxie) {
      window.clearTimeout(historySaveTimer.current)
      historySaveTimer.current = window.setTimeout(() => window.tingxie?.updateHistory(result).catch(() => undefined), 450)
    }
  }, [])

  const patchTranscriptSegment = useCallback((transcriptId: string, segmentId: string, patch: Partial<TranscriptResult['segments'][number]>) => {
    if (!window.tingxie) return
    void window.tingxie.patchTranscriptSegment({ transcriptId, segmentId, patch }).then((summary) => {
      setHistory((current) => [summary, ...current.filter((item) => item.id !== summary.id)])
    }).catch(() => undefined)
  }, [])

  const openTranscript = useCallback(async (item: TranscriptSummary) => {
    const result = window.tingxie
      ? await window.tingxie.getTranscript(item.id)
      : demoFiles.find((file) => file.result?.id === item.id)?.result || (item.id === demoLegacyResult.id ? demoLegacyResult : undefined)
    if (!result) return
    setSelectedResult(result)
    setCurrentPage('new')
    setRecentTranscripts((current) => addRecentTranscript(current, summarizeTranscript(result)))
  }, [])

  const updateHistorySummaries = useCallback((next: TranscriptSummary[]) => {
    setHistory(next)
    const byId = new Map(next.map((item) => [item.id, item]))
    setRecentTranscripts((current) => current.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []))
  }, [])

  const enqueueAnalysis = useCallback(async (transcriptId: string) => {
    const provider = aiSettings.providers.find((item) => item.id === aiSettings.selectedProviderId)
    if (!provider?.hasApiKey) {
      setShowAnalysisQueue(false); setSettingsSection('ai'); setShowSettings(true)
      return
    }
    if (provider.kind === 'mimo-token-plan' && !aiSettings.tokenPlanAcknowledged) {
      const accepted = window.confirm('Token Plan 官方适用范围主要为 Coding 场景。确认了解风险并继续生成智能速览吗？')
      if (!accepted) return
      if (window.tingxie) setAISettings(await window.tingxie.acknowledgeTokenPlan())
    }
    if (!window.tingxie) return
    setAnalysisLocalError('')
    try {
      setAnalysisQueue(await window.tingxie.generateAnalysis({ transcriptId, providerId: provider.id }))
    } catch (error) {
      const message = friendlyIpcError(error, '智能速览生成失败')
      setAnalysisLocalError(message)
      throw new Error(message)
    }
  }, [aiSettings])

  const generateAnalysis = useCallback(async () => {
    if (selectedResult) await enqueueAnalysis(selectedResult.id)
  }, [selectedResult, enqueueAnalysis])

  const retryAnalysis = useCallback(async (transcriptId: string) => {
    const queued = analysisQueue.jobs.find((job) => job.transcriptId === transcriptId && job.status !== 'dismissed')
    const provider = aiSettings.providers.find((item) => item.id === (queued?.providerId || aiSettings.selectedProviderId))
    if (!provider?.hasApiKey) {
      setShowAnalysisQueue(false); setSettingsSection('ai'); setShowSettings(true)
      return
    }
    if (provider.kind === 'mimo-token-plan' && !aiSettings.tokenPlanAcknowledged) {
      const accepted = window.confirm('Token Plan 官方适用范围主要为 Coding 场景。确认了解风险并继续重试智能速览吗？')
      if (!accepted) return
      if (window.tingxie) setAISettings(await window.tingxie.acknowledgeTokenPlan())
    }
    if (!window.tingxie) return
    try {
      setAnalysisQueue(await window.tingxie.retryAnalysis(transcriptId))
    } catch (error) {
      const message = friendlyIpcError(error, '智能速览重试失败')
      setAnalysisLocalError(message)
      throw new Error(message)
    }
  }, [aiSettings, analysisQueue.jobs])

  const dismissAnalysis = useCallback(async (transcriptId: string) => {
    if (!window.tingxie) return
    setAnalysisQueue(await window.tingxie.dismissAnalysis(transcriptId))
  }, [])

  const exportSelectedResult = useCallback(() => {
    if (selectedResult) void window.tingxie?.exportTranscript(selectedResult)
  }, [selectedResult])

  const openChat = useCallback(() => setChatOpen(true), [])

  async function removeHistory(item: TranscriptSummary) {
    await window.tingxie?.deleteHistory(item.id)
    setHistory((current) => current.filter((value) => value.id !== item.id))
    setRecentTranscripts((current) => current.filter((value) => value.id !== item.id))
  }

  const doneCount = files.filter((file) => file.status === 'done').length
  const selectedAnalysisJob = selectedResult
    ? analysisQueue.jobs.find((job) => job.transcriptId === selectedResult.id && job.status !== 'dismissed')
    : undefined
  const analysisBusy = selectedAnalysisJob
    ? ['queued', 'running', 'retry-wait'].includes(selectedAnalysisJob.status)
    : false
  const analysisError = analysisLocalError
    || (selectedAnalysisJob?.status === 'blocked' || selectedAnalysisJob?.status === 'failed' ? selectedAnalysisJob.error || '智能速览生成失败' : '')
  const analysisQueueItems = useMemo(() => buildAnalysisQueueView({ history, jobs: analysisQueue.jobs }), [history, analysisQueue.jobs])
  const pendingAnalysisCount = analysisQueueItems.filter((item) => ['queued', 'running', 'retry-wait'].includes(item.status)).length
  const queuedMediaIds = useMemo(() => new Set(files.flatMap((file) =>
    file.mediaId && !['done', 'partial', 'error', 'cancelled'].includes(file.status) ? [file.mediaId] : [])), [files])
  const isWorking = files.some((file) => ['waiting-preparation', 'preparing', 'extracting', 'ready', 'waiting-api', 'transcribing'].includes(file.status))
  const { fadeUp } = motionVariants(settings.preferences.reducedMotion)

  return (
    <MotionProvider reducedMotion={settings.preferences.reducedMotion}>
    <div
      ref={shellRef}
      className={`${chatOpen && selectedResult && currentPage === 'new' ? 'app-shell chat-open' : 'app-shell'}${selectedResult && currentPage === 'new' ? ' detail-open' : ''}${currentPage === 'new' && !selectedResult ? ' new-transcript-mode' : ''}${settings.preferences.sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}
      style={{ '--chat-panel-width': `${chatPanelWidth}px`, '--sidebar-width': `${sidebarWidth}px`, '--upload-pane-height': `${uploadPaneHeight}px` } as CSSProperties}
    >
      <Sidebar current={currentPage} collapsed={settings.preferences.sidebarCollapsed} onToggle={() => void savePreferences({ ...settings.preferences, sidebarCollapsed: !settings.preferences.sidebarCollapsed })} onNavigate={navigate} onSettings={() => { setSettingsSection('asr'); setShowSettings(true) }} recentTranscripts={recentTranscripts} activeTranscriptId={selectedResult?.id} onOpenTranscript={(item) => void openTranscript(item)} onRemoveRecent={(id) => setRecentTranscripts((current) => current.filter((item) => item.id !== id))} />
      {!settings.preferences.sidebarCollapsed && shellWidth > 1220 && <LayoutResizeHandle className="sidebar-layout-resizer" label="调整主导航宽度" orientation="vertical" value={sidebarWidth} min={150} max={280} onResize={(value) => setSidebarWidth(clampLayoutValue('sidebar', value, shellWidth))} onCommit={(value) => commitPrimaryLayout('sidebarWidth', clampLayoutValue('sidebar', value, shellWidth))} onReset={() => { setSidebarWidth(DEFAULT_SIDEBAR_WIDTH); commitPrimaryLayout('sidebarWidth', DEFAULT_SIDEBAR_WIDTH) }} />}
      <AnimatePresence initial={false} mode="sync">
      {currentPage === 'library' && <Suspense key="library" fallback={<DeferredView className="history-view deferred-view" label="正在打开媒体库" />}><MediaLibraryView
        library={mediaLibrary}
        history={history}
        preferences={settings.preferences}
        onPreferencesChange={savePreferences}
        onHistoryChange={updateHistorySummaries}
        importProgress={mediaImportProgress}
        onLibraryChange={setMediaLibrary}
        onOpenTranscript={(item) => void openTranscript(item)}
        onTranscribe={transcribeLibraryAsset}
        onBatchTranscribe={transcribeLibraryAssets}
        queuedMediaIds={queuedMediaIds}
        onImportFiles={(folderId) => void importLibraryFiles(folderId)}
        onImportFolder={(folderId) => void importLibraryFolder(folderId)}
        onRecoverHistoryMedia={async (item) => {
          if (!window.tingxie) return
          setMediaLibrary(await window.tingxie.recoverHistoryMedia(item.id))
        }}
      /></Suspense>}
        {currentPage === 'new' && !selectedResult && <m.main key="workspace" className="workspace" layout variants={fadeUp} initial="initial" animate="animate" exit="exit">
          <header className="workspace-header">
            <div><h1>新建转写</h1><p>上传音频或视频，快速获得可编辑文本</p></div>
            <div className={`service-status ${settings.hasApiKey ? 'online' : 'offline'}`}>
              {loadingSettings ? <LoaderCircle className="spin" size={15} /> : settings.hasApiKey ? <CircleCheck size={16} /> : <WifiOff size={16} />}
              {loadingSettings ? '正在检查' : settings.hasApiKey ? `MiMo · ${settings.serviceMode === 'token-plan' ? 'Token Plan' : '按量 API'} 已配置` : `请配置 ${settings.serviceMode === 'token-plan' ? 'Token Plan' : '按量 API'} Key`}
            </div>
          </header>
          <UploadZone onSelect={chooseFiles} onDrop={dropFiles} />
          <LayoutResizeHandle className="upload-layout-resizer" label="调整上传区域高度" orientation="horizontal" value={uploadPaneHeight} min={180} max={Math.max(180, (shellRef.current?.clientHeight || 720) - 290)} onResize={(value) => setUploadPaneHeight(clampLayoutValue('upload', value, shellRef.current?.clientHeight || 720))} onCommit={(value) => commitPrimaryLayout('uploadPaneHeight', clampLayoutValue('upload', value, shellRef.current?.clientHeight || 720))} onReset={() => { setUploadPaneHeight(DEFAULT_UPLOAD_PANE_HEIGHT); commitPrimaryLayout('uploadPaneHeight', DEFAULT_UPLOAD_PANE_HEIGHT) }} />
          <QueuePanel
            files={files}
            selectedId={undefined}
            onSelect={(file) => setSelectedResult(file.result)}
            onCancel={(file) => { pipelineRef.current?.cancel(file.id) }}
            onRemove={(file) => {
              pipelineRef.current?.cancel(file.id)
              setFiles((current) => current.filter((item) => item.id !== file.id))
            }}
            onRetry={(file) => enqueue({ ...file, status: 'waiting-preparation', progress: 0, detail: undefined, result: undefined })}
          />
        </m.main>}
        {currentPage === 'new' && selectedResult ? <Suspense key={`detail-${selectedResult.id}`} fallback={<DeferredView className="transcript-detail deferred-view" label="正在打开转写详情" />}><TranscriptDetail
          result={selectedResult}
          preferences={settings.preferences}
          onChange={updateResult}
          onGenerateAnalysis={generateAnalysis}
          onPatchSegment={patchTranscriptSegment}
          onExport={exportSelectedResult}
          onOpenChat={openChat}
          onNewTranscript={openNewTranscriptWorkspace}
          analysisBusy={analysisBusy}
          analysisError={analysisError}
          analysisStatus={selectedAnalysisJob?.status}
        /></Suspense> : null}
      </AnimatePresence>
        {currentPage === 'new' && chatOpen && selectedResult &&
          <PanelResizeHandle
            width={chatPanelWidth}
            shellWidth={shellWidth}
            onResize={previewChatPanelWidth}
            onCommit={commitChatPanelWidth}
            onReset={() => commitChatPanelWidth(DEFAULT_CHAT_PANEL_WIDTH)}
          />}
        <AnimatePresence initial={false}>
          {currentPage === 'new' && chatOpen && selectedResult && <Suspense key="ai-chat" fallback={<DeferredView className="ai-chat-panel deferred-panel" label="正在打开 AI 对话" />}><AIChatPanel transcript={selectedResult} settings={aiSettings} onSettingsChange={setAISettings} onOpenSettings={() => { setSettingsSection('ai'); setShowSettings(true) }} onClose={() => setChatOpen(false)} /></Suspense>}
        </AnimatePresence>
      {currentPage === 'new' && <footer className="status-bar">
        <span><Circle className={isWorking ? 'pulse-dot' : ''} size={9} fill="currentColor" />{files.length} 个文件<span>·</span>{doneCount} 个已完成</span>
        <button className="analysis-queue-trigger" onClick={() => setShowAnalysisQueue(true)}><Sparkles size={13} />智能速览队列 {analysisQueueItems.length}{pendingAnalysisCount > 0 && <i>{pendingAnalysisCount} 处理中</i>}</button>
      </footer>}
      <AnimatePresence initial={false}>
      {showSettings && <Suspense key="settings" fallback={<div className="modal-backdrop"><DeferredView className="settings-modal deferred-panel" label="正在打开设置" /></div>}><SettingsModal
        configuredServices={settings.configuredServices}
        language={settings.language}
        serviceMode={settings.serviceMode}
        adaptiveConcurrency={settings.adaptiveConcurrency}
        aiSettings={aiSettings}
        preferences={settings.preferences}
        mediaLibraryRoot={mediaLibrary.rootPath || settings.mediaLibraryRoot}
        initialSection={settingsSection}
        onClose={() => setShowSettings(false)}
        onSave={saveSettings}
        onSavePreferences={savePreferences}
        onChooseMediaLibraryRoot={async () => {
          const next = await window.tingxie?.chooseMediaLibraryRoot()
          if (next) { setMediaLibrary(next); setSettings((current) => ({ ...current, mediaLibraryRoot: next.rootPath })) }
        }}
        onTest={async (apiKey, serviceMode) => { await window.tingxie?.testConnection({ apiKey: apiKey || undefined, serviceMode }) }}
        onAISettingsChange={setAISettings}
        onSaveAIProvider={async (input: { provider: AIProvider; apiKey?: string }) => window.tingxie ? window.tingxie.saveAIProvider(input) : aiSettings}
        onDeleteAIProvider={async (id) => window.tingxie ? window.tingxie.deleteAIProvider(id) : aiSettings}
        onSelectAIProvider={async (id) => window.tingxie ? window.tingxie.selectAIProvider(id) : { ...aiSettings, selectedProviderId: id }}
        onTestAIProvider={async (input) => { if (window.tingxie) await window.tingxie.testAIProvider(input) }}
      /></Suspense>}
      {showAnalysisQueue && <Suspense fallback={<div className="analysis-queue-backdrop"><DeferredView className="analysis-queue-panel deferred-panel" label="正在打开智能速览队列" /></div>}><AnalysisQueuePanel
        snapshot={analysisQueue}
        history={history}
        preferences={settings.preferences}
        providerName={aiSettings.providers.find((item) => item.id === aiSettings.selectedProviderId)?.name}
        providerConfigured={Boolean(aiSettings.providers.find((item) => item.id === aiSettings.selectedProviderId)?.hasApiKey)}
        onClose={() => setShowAnalysisQueue(false)}
        onOpen={(transcriptId) => {
          const item = history.find((entry) => entry.id === transcriptId)
          if (item) { void openTranscript(item); setShowAnalysisQueue(false) }
        }}
        onGenerate={enqueueAnalysis}
        onRetry={retryAnalysis}
        onDismiss={dismissAnalysis}
      /></Suspense>}
      </AnimatePresence>
    </div>
    </MotionProvider>
  )
}
