import { Circle, CircleCheck, LoaderCircle, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_APP_PREFERENCES, type AIProvider, type AISettings, type AppPreferences, type Language, type MediaAsset, type MediaLibrarySnapshot, type ProgressEvent, type SelectedMedia, type ServiceMode, type TranscriptResult, type TranscriptSummary } from '../electron/types'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../electron/ai-system-prompt'
import { summarizeTranscript } from '../electron/transcript-summary'
import { AIChatPanel } from './components/AIChatPanel'
import { MediaLibraryView } from './components/MediaLibraryView'
import { QueuePanel } from './components/QueuePanel'
import { clampChatPanelWidth, DEFAULT_CHAT_PANEL_WIDTH, PanelResizeHandle } from './components/PanelResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { TranscriptDetail } from './components/TranscriptDetail'
import { UploadZone } from './components/UploadZone'
import type { AppSettings, QueueFile } from './types'
import { friendlyIpcError } from './utils'
import { loadStartupData } from './startup-data'
import { applyLatestProgressEvents } from './progress-batching'

const demoParameters = new URLSearchParams(location.search)
const isDemo = import.meta.env.DEV && demoParameters.has('demo')
const isLongDemo = isDemo && demoParameters.has('long')
const demoLongText = '这是用于验证超长转写排版的演示文本，每一句都应连续排列，不应在下一个时间段之前留下大段空白。'.repeat(260)

const demoSegments: TranscriptResult['segments'] = isLongDemo ? [
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

const demoFiles: QueueFile[] = [
  { id: 'demo-1', path: '', name: '产品周会.mp4', size: 1_331_433_472, duration: 4365, status: isLongDemo ? 'partial' : 'extracting', progress: isLongDemo ? 100 : 42, detail: isLongDemo ? '转写完成，1 个片段失败' : '正在提取音频 42%', result: demoResult },
  { id: 'demo-2', path: '', name: '项目复盘.wav', size: 818_518_426, duration: 2912, status: 'waiting', progress: 0 },
  { id: 'demo-3', path: '', name: '客户访谈.mp3', size: 34_812_928, duration: 2178, status: 'done', progress: 100, result: { ...demoResult, id: 'demo-3', fileName: '客户访谈.mp3' } },
]

const demoHistory = demoFiles.flatMap((file) => file.result ? [summarizeTranscript(file.result)] : [])

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
  folders: [{ id: 'folder-meetings', name: '会议记录', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  assets: demoFiles.map((file, index) => ({
    id: `media-${index}`,
    displayName: file.name,
    originalName: file.name,
    relativePath: `media\\media-${index}.${file.name.split('.').at(-1)}`,
    size: file.size,
    extension: file.name.split('.').at(-1)?.toLocaleUpperCase() || 'AUDIO',
    duration: file.duration,
    folderId: index < 2 ? 'folder-meetings' : undefined,
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
  const [selectedResult, setSelectedResult] = useState<TranscriptResult | undefined>(isDemo ? demoResult : undefined)
  const [settings, setSettings] = useState<AppSettings>({ hasApiKey: isDemo, language: 'auto', serviceMode: 'payg', configuredServices: isDemo ? ['payg'] : [], adaptiveConcurrency: true, preferences: DEFAULT_APP_PREFERENCES, mediaLibraryRoot: demoLibrary.rootPath })
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrarySnapshot>(isDemo ? demoLibrary : { rootPath: '', folders: [], assets: [] })
  const [aiSettings, setAISettings] = useState<AISettings>(initialAISettings)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'asr' | 'ai' | 'personalize'>('asr')
  const [chatOpen, setChatOpen] = useState(isDemo && demoParameters.has('markdown'))
  const [history, setHistory] = useState<TranscriptSummary[]>(isDemo ? demoHistory : [])
  const [loadingSettings, setLoadingSettings] = useState(!isDemo)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState(isDemo && demoParameters.has('analysis-error') ? 'AI 返回的 JSON 格式无效；已自动修复重试 1 次，请稍后重试。' : '')
  const [chatPanelWidth, setChatPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH)
  const [shellWidth, setShellWidth] = useState(() => window.innerWidth)
  const shellRef = useRef<HTMLDivElement>(null)
  const preferredChatPanelWidth = useRef(DEFAULT_CHAT_PANEL_WIDTH)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const historySaveTimer = useRef<number | undefined>(undefined)
  const progressFrameRef = useRef<number | undefined>(undefined)
  const pendingProgressEventsRef = useRef(new Map<string, ProgressEvent>())
  const autoAnalysisAttempted = useRef(new Set<string>())

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
    if (!(isDemo && demoParameters.has('analysis-error'))) setAnalysisError('')
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
    if (!selectedResult || selectedResult.analysis || !settings.preferences.autoGenerateAnalysis || autoAnalysisAttempted.current.has(selectedResult.id)) return
    autoAnalysisAttempted.current.add(selectedResult.id)
    if (autoAnalysisAttempted.current.size > 200) {
      const entries = [...autoAnalysisAttempted.current]
      autoAnalysisAttempted.current = new Set(entries.slice(-100))
    }
    void generateAnalysis()
  }, [selectedResult?.id, selectedResult?.analysis, settings.preferences.autoGenerateAnalysis])

  useEffect(() => {
    if (!window.tingxie || isDemo) return
    loadStartupData(window.tingxie)
      .then((data) => {
        if (data.settings) setSettings(data.settings)
        if (data.history) setHistory(data.history)
        if (data.aiSettings) setAISettings(data.aiSettings)
        if (data.mediaLibrary) setMediaLibrary(data.mediaLibrary)
      })
      .finally(() => setLoadingSettings(false))
    const unsubscribe = window.tingxie.onProgress(scheduleProgressUpdate)
    return () => {
      unsubscribe()
      if (progressFrameRef.current !== undefined) cancelAnimationFrame(progressFrameRef.current)
      pendingProgressEventsRef.current.clear()
    }
  }, [scheduleProgressUpdate])

  function enqueue(file: QueueFile) {
    queue.current = queue.current.then(async () => {
      if (!window.tingxie || !file.path) return
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, status: 'preparing', detail: '正在分析媒体信息' } : item))
      try {
        const result = await window.tingxie.transcribe({ id: file.id, path: file.path, fileName: file.name, language: settings.language, mediaId: file.mediaId })
        const failedCount = result.failedSegmentCount || 0
        const status = result.outcome === 'failed' ? 'error' : result.outcome === 'partial' ? 'partial' : 'done'
        const detail = result.outcome === 'failed'
          ? '所有片段均转写失败'
          : failedCount
            ? `转写完成，${failedCount} 个片段失败`
            : '转写完成'
        setFiles((current) => current.map((item) => item.id === file.id ? { ...item, status, progress: 100, detail, result } : item))
        setSelectedResult(result)
        const summary = summarizeTranscript(result)
        setHistory((current) => [summary, ...current.filter((item) => item.id !== result.id)])
        window.tingxie.getMediaLibrary().then(setMediaLibrary).catch(() => undefined)
      } catch (error) {
        setFiles((current) => current.map((item) => item.id === file.id && item.status !== 'cancelled' ? { ...item, status: 'error', progress: 0, detail: error instanceof Error ? error.message : '转写失败' } : item))
      }
    })
  }

  async function addSelected(selected: SelectedMedia[]) {
    if (!selected.length) return
    if (!window.tingxie) return
    if (!settings.hasApiKey) setShowSettings(true)
    const imported = await window.tingxie.importMedia(selected)
    setMediaLibrary(imported.library)
    const created = selected.map((file): QueueFile | undefined => {
      const asset = imported.library.assets.find((item) => item.originalPath?.toLocaleLowerCase() === file.path.toLocaleLowerCase() && item.size === file.size)
      if (!asset) return undefined
      const id = crypto.randomUUID()
      return { id, mediaId: asset.id, path: managedAssetPath(imported.library, asset), name: asset.displayName, size: asset.size, duration: asset.duration || 0, status: 'waiting', progress: 0 }
    }).filter((file): file is QueueFile => Boolean(file))
    setFiles((current) => [...created, ...current])
    if (settings.hasApiKey) created.forEach(enqueue)
  }

  function managedAssetPath(library: MediaLibrarySnapshot, asset: MediaAsset): string {
    return `${library.rootPath.replace(/[\\/]+$/, '')}\\${asset.relativePath}`
  }

  function transcribeLibraryAsset(asset: MediaAsset) {
    const file: QueueFile = { id: crypto.randomUUID(), mediaId: asset.id, path: managedAssetPath(mediaLibrary, asset), name: asset.displayName, size: asset.size, duration: asset.duration || 0, status: 'waiting', progress: 0 }
    setFiles((current) => [file, ...current])
    setCurrentPage('new')
    setSelectedResult(undefined)
    if (!settings.hasApiKey) setShowSettings(true)
    else enqueue(file)
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
    setAnalysisError('')
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

  const updateResult = useCallback((result: TranscriptResult, persist = true) => {
    setSelectedResult(result)
    setFiles((current) => current.map((file) => file.id === result.id ? { ...file, result } : file))
    const summary = summarizeTranscript(result)
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
      : demoFiles.find((file) => file.result?.id === item.id)?.result
    if (!result) return
    setSelectedResult(result)
    setCurrentPage('new')
  }, [])

  const generateAnalysis = useCallback(async () => {
    if (!selectedResult || analysisBusy) return
    const provider = aiSettings.providers.find((item) => item.id === aiSettings.selectedProviderId)
    if (!provider?.hasApiKey) {
      setSettingsSection('ai'); setShowSettings(true)
      return
    }
    if (provider.kind === 'mimo-token-plan' && !aiSettings.tokenPlanAcknowledged) {
      const accepted = window.confirm('Token Plan 官方适用范围主要为 Coding 场景。确认了解风险并继续生成智能速览吗？')
      if (!accepted) return
      if (window.tingxie) setAISettings(await window.tingxie.acknowledgeTokenPlan())
    }
    if (!window.tingxie) return
    setAnalysisError('')
    setAnalysisBusy(true)
    try { updateResult(await window.tingxie.generateAnalysis({ transcript: selectedResult, providerId: provider.id }), false) }
    catch (error) { setAnalysisError(friendlyIpcError(error, '智能速览生成失败')) }
    finally { setAnalysisBusy(false) }
  }, [selectedResult, analysisBusy, aiSettings, updateResult])

  const exportSelectedResult = useCallback(() => {
    if (selectedResult) void window.tingxie?.exportTranscript(selectedResult)
  }, [selectedResult])

  const openChat = useCallback(() => setChatOpen(true), [])

  async function removeHistory(item: TranscriptSummary) {
    await window.tingxie?.deleteHistory(item.id)
    setHistory((current) => current.filter((value) => value.id !== item.id))
  }

  const doneCount = files.filter((file) => file.status === 'done').length
  const isWorking = files.some((file) => ['preparing', 'extracting', 'transcribing'].includes(file.status))

  return (
    <div
      ref={shellRef}
      className={`${chatOpen && selectedResult && currentPage === 'new' ? 'app-shell chat-open' : 'app-shell'}${selectedResult && currentPage === 'new' ? ' detail-open' : ''}${settings.preferences.sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}
      style={{ '--chat-panel-width': `${chatPanelWidth}px` } as CSSProperties}
    >
      <Sidebar current={currentPage} collapsed={settings.preferences.sidebarCollapsed} onToggle={() => void savePreferences({ ...settings.preferences, sidebarCollapsed: !settings.preferences.sidebarCollapsed })} onNavigate={navigate} onSettings={() => { setSettingsSection('asr'); setShowSettings(true) }} />
      {currentPage === 'library' ? <MediaLibraryView
        library={mediaLibrary}
        history={history}
        onLibraryChange={setMediaLibrary}
        onOpenTranscript={(item) => void openTranscript(item)}
        onTranscribe={transcribeLibraryAsset}
        onImportFiles={(folderId) => void importLibraryFiles(folderId)}
        onImportFolder={(folderId) => void importLibraryFolder(folderId)}
        onRecoverHistoryMedia={async (item) => {
          if (!window.tingxie) return
          setMediaLibrary(await window.tingxie.recoverHistoryMedia(item.id))
        }}
      /> : <>
        {!selectedResult && <main className="workspace">
          <header className="workspace-header">
            <div><h1>新建转写</h1><p>上传音频或视频，快速获得可编辑文本</p></div>
            <div className={`service-status ${settings.hasApiKey ? 'online' : 'offline'}`}>
              {loadingSettings ? <LoaderCircle className="spin" size={15} /> : settings.hasApiKey ? <CircleCheck size={16} /> : <WifiOff size={16} />}
              {loadingSettings ? '正在检查' : settings.hasApiKey ? `MiMo · ${settings.serviceMode === 'token-plan' ? 'Token Plan' : '按量 API'} 已配置` : `请配置 ${settings.serviceMode === 'token-plan' ? 'Token Plan' : '按量 API'} Key`}
            </div>
          </header>
          <UploadZone onSelect={chooseFiles} onDrop={dropFiles} />
          <QueuePanel
            files={files}
            selectedId={undefined}
            onSelect={(file) => setSelectedResult(file.result)}
            onCancel={(file) => window.tingxie?.cancel(file.id)}
            onRemove={(file) => setFiles((current) => current.filter((item) => item.id !== file.id))}
            onRetry={(file) => enqueue({ ...file, status: 'waiting', progress: 0, detail: undefined })}
          />
        </main>}
        {selectedResult ? <TranscriptDetail
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
        /> : <TranscriptPanel
          result={selectedResult}
          language={settings.language}
          onLanguage={(language) => {
            setSettings((current) => ({ ...current, language }))
            if (window.tingxie) window.tingxie.saveSettings({ language }).catch(() => undefined)
          }}
          onChange={updateResult}
          onExport={(result) => window.tingxie?.exportTranscript(result)}
          chatOpen={chatOpen}
          onOpenChat={() => setChatOpen(true)}
          onRestoreWorkspace={() => setChatOpen(false)}
        />}
        {chatOpen && selectedResult && <>
          <PanelResizeHandle
            width={chatPanelWidth}
            shellWidth={shellWidth}
            onResize={previewChatPanelWidth}
            onCommit={commitChatPanelWidth}
            onReset={() => commitChatPanelWidth(DEFAULT_CHAT_PANEL_WIDTH)}
          />
          <AIChatPanel transcript={selectedResult} settings={aiSettings} onSettingsChange={setAISettings} onOpenSettings={() => { setSettingsSection('ai'); setShowSettings(true) }} onClose={() => setChatOpen(false)} />
        </>}
      </>}
      {currentPage === 'new' && <footer className="status-bar">
        <span><Circle className={isWorking ? 'pulse-dot' : ''} size={9} fill="currentColor" />{files.length} 个文件<span>·</span>{doneCount} 个已完成</span>
        <span>{isWorking ? '正在本机处理音频' : '就绪'}</span>
      </footer>}
      {showSettings && <SettingsModal
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
      />}
    </div>
  )
}
