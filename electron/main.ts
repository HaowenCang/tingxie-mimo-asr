import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import {
  DIRECT_UPLOAD_BYTES,
  HARD_CHUNK_BYTES,
  estimateTranscriptSegments,
  parseSilenceDetectOutput,
  planAudioChunks,
  selectAudioEncoding,
  splitOversizedChunk,
  type ChunkTranscriptOutcome,
  type PlannedChunk,
  type SilenceInterval,
} from './audio-chunking'
import {
  AdaptiveConcurrencyController,
  RequestRateLimiter,
  abortableDelay,
  parseRetryAfter,
  retryDelay,
  runAdaptivePool,
} from './adaptive-concurrency'
import { isPermanentQuotaError, runChunkWithRetry, type RetryFailure } from './transcription-retry'
import {
  inspectTranscriptQuality,
  recoverTranscriptChunk,
  type RecoverableAudioChunk,
  type RecoveredTranscriptChunk,
  type TranscriptQualityRecoveryPlan,
} from './transcript-quality'
import { applyChunkRepairs } from './transcript-repair'
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  buildChatMessages,
  normalizeBaseUrl,
  readCompletionResponse,
} from './ai-chat'
import { resolveProviderSystemPrompt } from './ai-provider-defaults'
import { generateTranscriptAnalysis } from './analysis'
import { attachManagedMediaToHistory, ensureHistoryBackup } from './history-recovery'
import {
  createMediaFolder,
  importMediaAssets,
  linkTranscriptToAsset,
  moveMediaAssets,
  renameMediaAsset,
  renameMediaFolder,
  resolveManagedMediaPath,
  type MediaLibraryIndex,
} from './media-library'
import {
  serviceEndpoint,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
  type AIChatSession,
  type AIMessage,
  type AIProvider,
  type AIProviderKind,
  type AISettings,
  type AIStreamEvent,
  type Language,
  type MediaAsset,
  type MediaInfo,
  type MediaImportResult,
  type MediaLibrarySnapshot,
  type ParagraphLength,
  type ProgressEvent,
  type SelectedMedia,
  type ServiceMode,
  type TranscriptResult,
  type TranscriptAnalysis,
} from './types'

const SUPPORTED_INPUTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'mpeg', 'mpg']
const activeJobs = new Map<string, { controller: AbortController; process?: ChildProcessWithoutNullStreams }>()
const activeAIRequests = new Map<string, AbortController>()
const analysisJsonModeUnsupportedProviders = new Set<string>()

interface StoredAIProvider {
  id: string
  name: string
  kind: AIProviderKind
  baseUrl: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  systemPrompt: string
  encryptedApiKey?: string
}

interface StoredAISettings {
  providers?: StoredAIProvider[]
  selectedProviderId?: string
  tokenPlanAcknowledged?: boolean
}

interface StoredSettings {
  encryptedKey?: string
  encryptedKeys?: Partial<Record<ServiceMode, string>>
  language: Language
  serviceMode?: ServiceMode
  adaptiveConcurrency?: boolean
  ai?: StoredAISettings
  preferences?: Partial<AppPreferences>
  mediaLibraryRoot?: string
}

interface ApiConfig {
  apiKey: string
  serviceMode: ServiceMode
  adaptiveConcurrency: boolean
  paragraphLength: ParagraphLength
}

interface PreparedAudioChunk {
  file: string
  start: number
  end: number
  overlapWithPrevious: number
}

interface ProbeJson {
  format?: { duration?: string; bit_rate?: string }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    sample_rate?: string
    channels?: number
    bit_rate?: string
    bits_per_raw_sample?: string
  }>
}

function unpacked(binaryPath: string): string {
  return binaryPath.replace('app.asar', 'app.asar.unpacked')
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function historyPath(): string {
  return path.join(app.getPath('userData'), 'history.json')
}

function historyRecoveryBackupPath(): string {
  return path.join(app.getPath('userData'), 'backups', 'history-before-media-library-0.11.json')
}

function chatsPath(): string {
  return path.join(app.getPath('userData'), 'ai-chats.json')
}

function defaultMediaLibraryRoot(): string {
  return path.join(app.getPath('userData'), 'media-library')
}

function mediaLibraryRoot(settings?: StoredSettings): string {
  return path.resolve(settings?.mediaLibraryRoot || defaultMediaLibraryRoot())
}

function mediaLibraryIndexPath(root: string): string {
  return path.join(root, 'index.json')
}

async function readMediaLibrary(settings?: StoredSettings): Promise<MediaLibraryIndex> {
  return readJson<MediaLibraryIndex>(mediaLibraryIndexPath(mediaLibraryRoot(settings)), { version: 1, folders: [], assets: [] })
}

async function writeMediaLibrary(settings: StoredSettings, index: MediaLibraryIndex): Promise<void> {
  await writeJson(mediaLibraryIndexPath(mediaLibraryRoot(settings)), index)
}

function publicMediaLibrary(settings: StoredSettings, index: MediaLibraryIndex): MediaLibrarySnapshot {
  return { rootPath: mediaLibraryRoot(settings), folders: index.folders, assets: index.assets }
}

// ponytail: semaphore-less concurrency cap — limits parallel ffprobe (child process) spawns during bulk import.
// 6 concurrent probes keeps the system responsive; increase if importing hundreds of files and perf is an issue.
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  }
  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker())).then(() => results)
}

async function probeAllAssets(allAssets: MediaAsset[], newAssetIds: Set<string>, root: string): Promise<MediaAsset[]> {
  return mapConcurrent(allAssets, 6, async (asset) => {
    if (!newAssetIds.has(asset.id)) return asset
    const duration = await probe(resolveManagedMediaPath(root, asset)).then((info) => publicMediaInfo(info).duration).catch(() => 0)
    return { ...asset, duration }
  })
}

const DIAGNOSTIC_LOG_BYTES = 5 * 1024 * 1024
const DIAGNOSTIC_LOG_BACKUPS = 3
let diagnosticLogQueue = Promise.resolve()

function diagnosticLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'main.log')
}

async function appendDiagnosticLog(event: string, details: Record<string, unknown>): Promise<void> {
  const file = diagnosticLogPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const size = await fs.stat(file).then((stat) => stat.size).catch(() => 0)
  if (size >= DIAGNOSTIC_LOG_BYTES) {
    await fs.rm(`${file}.${DIAGNOSTIC_LOG_BACKUPS}`, { force: true }).catch(() => undefined)
    for (let index = DIAGNOSTIC_LOG_BACKUPS - 1; index >= 1; index -= 1) {
      await fs.rename(`${file}.${index}`, `${file}.${index + 1}`).catch(() => undefined)
    }
    await fs.rename(file, `${file}.1`).catch(() => undefined)
  }
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })
  await fs.appendFile(file, `${line}\n`, 'utf8')
}

function logDiagnostic(event: string, details: Record<string, unknown>): void {
  diagnosticLogQueue = diagnosticLogQueue
    .catch(() => undefined)
    .then(() => appendDiagnosticLog(event, details))
    .catch(() => undefined)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

// ponytail: in-memory cache for the three hot-path JSON stores — read once at startup, write-through on mutation.
// If a migration step needs a forced re-read (unlikely), the cache can be cleared per-store.
let cachedSettings: StoredSettings | undefined
let cachedHistory: TranscriptResult[] | undefined
let cachedChats: Record<string, AIChatSession> | undefined

async function readCachedSettings(): Promise<StoredSettings> {
  if (cachedSettings) return cachedSettings
  cachedSettings = await readSettings()
  return cachedSettings
}

function invalidateSettings(): void { cachedSettings = undefined }

async function readCachedHistory(): Promise<TranscriptResult[]> {
  if (cachedHistory) return cachedHistory
  cachedHistory = await readJson<TranscriptResult[]>(historyPath(), [])
  return cachedHistory
}

function invalidateHistory(): void { cachedHistory = undefined }

async function readCachedChats(): Promise<Record<string, AIChatSession>> {
  if (cachedChats) return cachedChats
  cachedChats = await readJson<Record<string, AIChatSession>>(chatsPath(), {})
  return cachedChats
}

function invalidateChats(): void { cachedChats = undefined }

async function readSettings(): Promise<StoredSettings> {
  const stored = await readJson<StoredSettings>(settingsPath(), { language: 'auto', serviceMode: 'payg' })
  const encryptedKeys = { ...stored.encryptedKeys }
  if (stored.encryptedKey && !encryptedKeys.payg) encryptedKeys.payg = stored.encryptedKey
  return {
    language: stored.language || 'auto',
    serviceMode: stored.serviceMode || 'payg',
    adaptiveConcurrency: stored.adaptiveConcurrency !== false,
    encryptedKeys,
    ai: stored.ai,
    preferences: { ...DEFAULT_APP_PREFERENCES, ...stored.preferences },
    mediaLibraryRoot: stored.mediaLibraryRoot,
  }
}

function builtInProvider(kind: 'mimo-payg' | 'mimo-token-plan'): StoredAIProvider {
  return {
    id: kind,
    name: kind === 'mimo-payg' ? '小米 MiMo（按量）' : '小米 MiMo（Token Plan）',
    kind,
    baseUrl: kind === 'mimo-payg' ? 'https://api.xiaomimimo.com/v1' : 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  }
}

function storedAIProviders(settings: StoredSettings): StoredAIProvider[] {
  const saved = (settings.ai?.providers || []).map((provider) => ({
    ...provider,
    systemPrompt: resolveProviderSystemPrompt(provider.systemPrompt, DEFAULT_AI_SYSTEM_PROMPT),
  }))
  const payg = saved.find((provider) => provider.id === 'mimo-payg') || builtInProvider('mimo-payg')
  const tokenPlan = saved.find((provider) => provider.id === 'mimo-token-plan') || builtInProvider('mimo-token-plan')
  const custom = saved.filter((provider) => provider.kind === 'openai-compatible' && provider.id !== 'mimo-payg' && provider.id !== 'mimo-token-plan')
  return [payg, tokenPlan, ...custom]
}

function providerHasKey(settings: StoredSettings, provider: StoredAIProvider): boolean {
  if (provider.kind === 'mimo-payg') return Boolean(settings.encryptedKeys?.payg)
  if (provider.kind === 'mimo-token-plan') return Boolean(settings.encryptedKeys?.['token-plan'])
  return Boolean(provider.encryptedApiKey)
}

function publicAISettings(settings: StoredSettings): AISettings {
  const storedProviders = storedAIProviders(settings)
  const providers: AIProvider[] = storedProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
    systemPrompt: provider.systemPrompt,
    hasApiKey: providerHasKey(settings, provider),
    builtIn: provider.kind !== 'openai-compatible',
  }))
  const requested = settings.ai?.selectedProviderId
  return {
    providers,
    selectedProviderId: providers.some((provider) => provider.id === requested) ? requested! : 'mimo-payg',
    tokenPlanAcknowledged: settings.ai?.tokenPlanAcknowledged === true,
    defaultSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  }
}

function validateAIProvider(provider: AIProvider): StoredAIProvider {
  const kind: AIProviderKind = provider.kind
  if (!['mimo-payg', 'mimo-token-plan', 'openai-compatible'].includes(kind)) throw new Error('不支持的 AI Provider 类型')
  const name = provider.name.trim()
  const model = provider.model.trim()
  const systemPrompt = provider.systemPrompt.trim()
  const contextWindow = Math.floor(provider.contextWindow)
  const maxOutputTokens = Math.floor(provider.maxOutputTokens)
  if (!name) throw new Error('Provider 名称不能为空')
  if (!model) throw new Error('Model ID 不能为空')
  if (!systemPrompt) throw new Error('系统提示词不能为空')
  if (contextWindow < 1024) throw new Error('上下文长度不能小于 1024')
  if (maxOutputTokens < 1 || maxOutputTokens >= contextWindow) throw new Error('最大输出长度必须大于 0 且小于上下文长度')
  return {
    id: provider.id,
    name,
    kind,
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    model,
    contextWindow,
    maxOutputTokens,
    systemPrompt,
  }
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
  return safeStorage.encryptString(apiKey.trim()).toString('base64')
}

function decryptApiKey(value?: string): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function providerApiKey(settings: StoredSettings, provider: StoredAIProvider, override?: string): string {
  if (override?.trim()) return override.trim()
  const encrypted = provider.kind === 'mimo-payg'
    ? settings.encryptedKeys?.payg
    : provider.kind === 'mimo-token-plan'
      ? settings.encryptedKeys?.['token-plan']
      : provider.encryptedApiKey
  const key = decryptApiKey(encrypted)
  if (!key) throw new Error(`请先为 ${provider.name} 配置 API Key`)
  return key
}

function providerHeaders(provider: StoredAIProvider, apiKey: string): Record<string, string> {
  return provider.kind === 'openai-compatible'
    ? { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
    : { 'api-key': apiKey, 'content-type': 'application/json' }
}

function emitAIStream(window: BrowserWindow, event: AIStreamEvent): void {
  if (!window.isDestroyed()) window.webContents.send('ai:stream', event)
}

async function readChatSessions(): Promise<Record<string, AIChatSession>> {
  if (cachedChats) return cachedChats
  cachedChats = await readJson<Record<string, AIChatSession>>(chatsPath(), {})
  return cachedChats
}

async function writeChatSession(session: AIChatSession): Promise<void> {
  const sessions = await readChatSessions()
  sessions[session.transcriptId] = session
  cachedChats = sessions
  await writeJson(chatsPath(), sessions)
}

async function getApiConfig(serviceModeOverride?: ServiceMode, apiKeyOverride?: string): Promise<ApiConfig> {
  const settings = await readCachedSettings()
  const serviceMode = serviceModeOverride || settings.serviceMode || 'payg'
  const adaptiveConcurrency = settings.adaptiveConcurrency !== false
  const paragraphLength = { ...DEFAULT_APP_PREFERENCES, ...settings.preferences }.paragraphLength
  if (apiKeyOverride?.trim()) return { apiKey: apiKeyOverride.trim(), serviceMode, adaptiveConcurrency, paragraphLength }
  const encryptedKey = settings.encryptedKeys?.[serviceMode]
  if (!encryptedKey) throw new Error(serviceMode === 'token-plan' ? '请先填写 Token Plan API Key' : '请先填写按量 API Key')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
  return {
    apiKey: safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')),
    serviceMode,
    adaptiveConcurrency,
    paragraphLength,
  }
}

function emitProgress(window: BrowserWindow, event: ProgressEvent): void {
  if (!window.isDestroyed()) window.webContents.send('media:progress', event)
}

function runProcess(
  executable: string,
  args: string[],
  job?: { controller: AbortController; process?: ChildProcessWithoutNullStreams },
  onLine?: (line: string) => void,
  onStderrData?: (chunk: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    if (job) job.process = child
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      chunk.split(/\r?\n/).filter(Boolean).forEach((line) => onLine?.(line))
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      onStderrData?.(chunk)
    })
    const abort = () => child.kill()
    job?.controller.signal.addEventListener('abort', abort, { once: true })
    child.on('error', reject)
    child.on('close', (code) => {
      job?.controller.signal.removeEventListener('abort', abort)
      if (job?.controller.signal.aborted) reject(new Error('任务已取消'))
      else if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `媒体处理失败（${code}）`))
    })
  })
}

async function probe(pathname: string): Promise<ProbeJson> {
  const output = await runProcess(unpacked(ffprobeStatic.path), [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', pathname,
  ])
  return JSON.parse(output) as ProbeJson
}

function publicMediaInfo(value: ProbeJson): MediaInfo {
  const audio = value.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio) throw new Error('文件中没有可识别的音轨')
  return {
    duration: Number(value.format?.duration || 0),
    codec: audio.codec_name || 'unknown',
    sampleRate: Number(audio.sample_rate || 0),
    channels: audio.channels || 0,
  }
}

async function detectSilences(
  inputPath: string,
  duration: number,
  id: string,
  window: BrowserWindow,
  job: { controller: AbortController; process?: ChildProcessWithoutNullStreams },
): Promise<SilenceInterval[]> {
  let detectionOutput = ''
  emitProgress(window, { id, stage: 'extracting', progress: 2, detail: '正在分析停顿位置' })
  await runProcess(unpacked(String(ffmpegStatic)), [
    '-hide_banner', '-i', inputPath, '-map', '0:a:0',
    '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-',
  ], job, undefined, (chunk) => { detectionOutput += chunk })
  return parseSilenceDetectOutput(detectionOutput, duration)
}

async function prepareChunks(
  inputPath: string,
  id: string,
  window: BrowserWindow,
  job: { controller: AbortController; process?: ChildProcessWithoutNullStreams },
  mediaDuration: number,
): Promise<{ chunks: PreparedAudioChunk[]; silences: SilenceInterval[]; tempDir?: string }> {
  const sourceStat = await fs.stat(inputPath)
  const extension = path.extname(inputPath).slice(1).toLowerCase()
  if ((extension === 'mp3' || extension === 'wav') && sourceStat.size <= DIRECT_UPLOAD_BYTES) {
    const silences = await detectSilences(inputPath, mediaDuration, id, window, job)
    emitProgress(window, { id, stage: 'extracting', progress: 100, detail: '无需转换，保留原始音频' })
    logDiagnostic('audio-chunks-prepared', { jobId: id, duration: mediaDuration, sourceFormat: extension, outputFormat: extension, chunks: 1, direct: true })
    return { chunks: [{ file: inputPath, start: 0, end: mediaDuration, overlapWithPrevious: 0 }], silences }
  }

  const metadata = await probe(inputPath)
  const audio = metadata.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio) throw new Error('文件中没有可识别的音轨')
  const duration = Math.max(Number(metadata.format?.duration || 0), 0.1)
  const channels = Math.max(audio.channels || 1, 1)
  const sourceBitRate = Math.max(Number(audio.bit_rate || metadata.format?.bit_rate || 128000), 32000)
  const encoding = selectAudioEncoding({ codec: audio.codec_name || 'unknown', sourceBitRate, channels })
  const tempDir = path.join(os.tmpdir(), `tingxie-${id}-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  const silences = await detectSilences(inputPath, duration, id, window, job)
  const planned = planAudioChunks(duration, encoding.estimatedBytesPerSecond, silences)
  if (!planned.length) throw new Error('未能生成有效的音频切片计划')
  let fileCounter = 0
  let completedChunks = 0

  async function materialize(plan: PlannedChunk, depth = 0): Promise<PreparedAudioChunk[]> {
    const output = path.join(tempDir, `part-${String(fileCounter++).padStart(4, '0')}.${encoding.outputExt}`)
    const chunkDuration = Math.max(0.05, plan.end - plan.start)
    await runProcess(unpacked(String(ffmpegStatic)), [
      '-y', '-ss', plan.start.toFixed(3), '-i', inputPath, '-t', chunkDuration.toFixed(3),
      '-map', '0:a:0', '-vn', ...encoding.codecArgs, '-progress', 'pipe:1', '-nostats', output,
    ], job)
    const size = (await fs.stat(output)).size
    if (size <= HARD_CHUNK_BYTES) {
      completedChunks += 1
      emitProgress(window, {
        id,
        stage: 'extracting',
        progress: Math.min(99, 8 + Math.round(completedChunks / planned.length * 90)),
        detail: `已生成 ${completedChunks} 个音频片段`,
      })
      return [{ file: output, start: plan.logicalStart, end: plan.end, overlapWithPrevious: plan.overlapWithPrevious }]
    }

    await fs.rm(output, { force: true })
    if (depth >= 3 || chunkDuration <= 0.2) {
      throw new Error('音频切片在多次缩短后仍超过接口大小限制')
    }
    emitProgress(window, { id, stage: 'extracting', progress: 8, detail: '切片超限，正在自动缩短' })
    const [left, right] = splitOversizedChunk(plan, silences)
    return [...await materialize(left, depth + 1), ...await materialize(right, depth + 1)]
  }

  const chunks: PreparedAudioChunk[] = []
  for (const plan of planned) chunks.push(...await materialize(plan))
  const ordered = chunks.map((chunk, index) => ({
    ...chunk,
    end: chunks[index + 1]?.start ?? duration,
  }))
  logDiagnostic('audio-chunks-prepared', {
    jobId: id,
    duration,
    sourceCodec: audio.codec_name || 'unknown',
    outputFormat: encoding.outputExt,
    copied: encoding.copy,
    chunks: ordered.length,
    averageSeconds: duration / ordered.length,
  })
  emitProgress(window, { id, stage: 'extracting', progress: 100, detail: `已生成 ${ordered.length} 个音频片段` })
  return { chunks: ordered, silences, tempDir }
}

function extractText(payload: unknown): string {
  const data = payload as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text)
      return ''
    }).join('').trim()
  }
  return ''
}

class TranscriptRequestError extends Error {
  constructor(readonly failure: RetryFailure) {
    super(failure.message)
    this.name = 'TranscriptRequestError'
  }
}

interface ChunkLogContext {
  jobId: string
  chunkIndex: number
  start: number
  end: number
}

function normalizeErrorFingerprint(status: number | undefined, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\b(?:req(?:uest)?[-_ ]?id)\s*[:=]?\s*[\w-]+/gi, 'request-id=<id>')
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim()
  return `${status ?? 'network'}|${normalized}`
}

function classifyRequestFailure(error: unknown, signal: AbortSignal): RetryFailure {
  if (error instanceof TranscriptRequestError) return error.failure
  if (signal.aborted) return { disposition: 'global', fingerprint: 'cancelled', message: '任务已取消' }
  const message = error instanceof Error ? error.message : '网络请求失败'
  return {
    disposition: 'transient',
    fingerprint: normalizeErrorFingerprint(undefined, message),
    message,
  }
}

async function requestTranscript(
  file: string,
  language: Language,
  signal: AbortSignal,
  apiConfig: ApiConfig,
  concurrency: AdaptiveConcurrencyController,
  rateLimiter: RequestRateLimiter,
  context: ChunkLogContext,
) {
  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav'
  const data = (await fs.readFile(file)).toString('base64')
  if (Buffer.byteLength(data, 'utf8') + 32 >= 10 * 1024 * 1024) {
    const failure: RetryFailure = { disposition: 'content', fingerprint: 'audio-too-large', message: '音频 Base64 编码后超过 10MB 接口限制', retryable: false }
    return { status: 'failed', error: failure.message, attempts: 1, errorAttempts: 1, rateLimitWaits: 0, failure } as const
  }

  let lastRateWaitMs = 0
  let lastRequestDurationMs = 0
  const outcome = await runChunkWithRetry({
    attempt: async (attemptNumber) => {
      const rateWaitStartedAt = Date.now()
      do {
        await abortableDelay(rateLimiter.reserve(), signal)
      } while (rateLimiter.isBlocked())
      lastRateWaitMs = Date.now() - rateWaitStartedAt
      const requestStartedAt = Date.now()
      let response: Response
      try {
        response = await fetch(serviceEndpoint(apiConfig.serviceMode, 'chat/completions'), {
          method: 'POST',
          headers: { 'api-key': apiConfig.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'mimo-v2.5-asr',
            messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${data}` } }] }],
            asr_options: { language },
          }),
          signal,
        })
      } catch (error) {
        lastRequestDurationMs = Date.now() - requestStartedAt
        if (signal.aborted) throw new TranscriptRequestError({ disposition: 'global', fingerprint: 'cancelled', message: '任务已取消' })
        const message = error instanceof Error ? error.message : '网络请求失败'
        throw new TranscriptRequestError({
          disposition: 'transient',
          fingerprint: normalizeErrorFingerprint(undefined, message),
          message,
        })
      }
      lastRequestDurationMs = Date.now() - requestStartedAt

      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (response.ok) {
        const text = extractText(body)
        if (!text) {
          throw new TranscriptRequestError({
            disposition: 'transient',
            fingerprint: 'empty-transcript',
            message: 'MiMo 返回了空的转写结果',
            status: response.status,
          })
        }
        const quality = inspectTranscriptQuality(text, context.end - context.start)
        if (quality.suspicious) {
          logDiagnostic('chunk-quality-rejected', {
            ...context,
            reason: quality.reason,
            maxRepeatCount: quality.maxRepeatCount,
            repetitionCoverage: Number(quality.repetitionCoverage.toFixed(3)),
            charactersPerSecond: Number(quality.charactersPerSecond.toFixed(2)),
          })
          throw new TranscriptRequestError({
            disposition: 'content',
            fingerprint: 'degenerate-repetition',
            message: '识别结果出现异常循环',
            status: response.status,
          })
        }
        const before = concurrency.current
        const rpmBefore = rateLimiter.currentRpm
        rateLimiter.reportSuccess()
        concurrency.reportSuccess(lastRequestDurationMs, rateLimiter.currentRpm)
        logDiagnostic('chunk-attempt-succeeded', {
          ...context,
          attempt: attemptNumber,
          rateWaitMs: lastRateWaitMs,
          requestDurationMs: lastRequestDurationMs,
          rpmBefore,
          rpmAfter: rateLimiter.currentRpm,
          concurrencyBefore: before,
          concurrencyAfter: concurrency.current,
        })
        return text
      }

      const errorObject = body.error as { message?: string; code?: string } | undefined
      const message = errorObject?.message || `MiMo 服务返回 ${response.status}`
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      const disposition: RetryFailure['disposition'] = response.status === 401 || response.status === 402 || response.status === 403 || response.status === 404
        || isPermanentQuotaError(response.status, message, errorObject?.code)
        ? 'global'
        : response.status === 429
          ? 'rate-limit'
          : response.status === 503
          ? 'pressure'
          : response.status === 408 || response.status >= 500
            ? 'transient'
            : 'content'
      throw new TranscriptRequestError({
        disposition,
        fingerprint: normalizeErrorFingerprint(response.status, message),
        message,
        status: response.status,
        retryAfterMs,
      })
    },
    classify: (error) => classifyRequestFailure(error, signal),
    delayFor: retryDelay,
    wait: (delayMs) => abortableDelay(delayMs, signal),
    onFailure: (failure, attemptNumber, delayMs) => {
      const before = concurrency.current
      const rpmBefore = rateLimiter.currentRpm
      if (failure.disposition === 'rate-limit') {
        const cooldownMs = delayMs
        concurrency.reportPressure(cooldownMs)
        rateLimiter.reportRateLimit(cooldownMs)
      } else if (failure.disposition === 'pressure') {
        const cooldownMs = delayMs
        concurrency.reportPressure(cooldownMs)
        rateLimiter.reportServicePressure(cooldownMs)
      } else if (failure.disposition === 'transient') {
        concurrency.reportTransientFailure()
      }
      logDiagnostic('chunk-attempt-failed', {
        ...context,
        attempt: attemptNumber,
        disposition: failure.disposition,
        status: failure.status,
        fingerprint: failure.fingerprint,
        retryDelayMs: delayMs,
        rateWaitMs: lastRateWaitMs,
        requestDurationMs: lastRequestDurationMs,
        rpmBefore,
        rpmAfter: rateLimiter.currentRpm,
        concurrencyBefore: before,
        concurrencyAfter: concurrency.current,
      })
    },
  })

  if (outcome.status === 'failed') {
    logDiagnostic('chunk-abandoned', {
      ...context,
      requests: outcome.attempts,
      errorAttempts: outcome.errorAttempts,
      rateLimitWaits: outcome.rateLimitWaits,
    })
  }
  return outcome
}

async function saveHistory(result: TranscriptResult): Promise<void> {
  const items = await readCachedHistory()
  const next = [result, ...items.filter((item) => item.id !== result.id)]
  cachedHistory = next
  await writeJson(historyPath(), next)
}

async function scanMediaDirectory(directory: string): Promise<SelectedMedia[]> {
  const selected: SelectedMedia[] = []
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()!
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const pathname = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(pathname)
      else if (entry.isFile() && SUPPORTED_INPUTS.includes(path.extname(entry.name).slice(1).toLocaleLowerCase())) {
        selected.push({ path: pathname, name: entry.name, size: (await fs.stat(pathname)).size })
      }
    }
  }
  return selected
}

function transcriptTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor(rounded % 3600 / 60)
  const secs = rounded % 60
  return hours
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
}

function plainTranscriptSegment(segment: TranscriptResult['segments'][number]): string {
  if (segment.status !== 'failed') return segment.text
  const range = segment.end === undefined
    ? transcriptTimestamp(segment.start)
    : `${transcriptTimestamp(segment.start)}–${transcriptTimestamp(segment.end)}`
  return `[${range} 转写失败：${segment.error || '未知错误'}]`
}

interface StoredTranscriptRepairSummary {
  recordId: string
  repairedOriginalChunkIndexes: number[]
  replacementChunkCount: number
  failedReplacementCount: number
  finalChunkCount: number
  remainingSuspiciousChunks: number
  backupPath?: string
}

async function repairStoredTranscript(recordId: string): Promise<StoredTranscriptRepairSummary> {
  const file = historyPath()
  const items = await readJson<TranscriptResult[]>(file, [])
  const recordIndex = items.findIndex((item) => item.id === recordId)
  if (recordIndex < 0) throw new Error(`未找到转写记录：${recordId}`)
  const record = items[recordIndex]
  if (!record.sourcePath) throw new Error('该转写记录没有可用的源文件路径')
  if (!record.chunks?.length) throw new Error('该转写记录没有保存切片信息')
  await fs.access(record.sourcePath)

  const suspiciousChunks = record.chunks.filter((chunk) => (
    chunk.status === 'success'
    && inspectTranscriptQuality(chunk.text, chunk.end - chunk.start).suspicious
  ))
  if (!suspiciousChunks.length) {
    return {
      recordId,
      repairedOriginalChunkIndexes: [],
      replacementChunkCount: 0,
      failedReplacementCount: 0,
      finalChunkCount: record.chunks.length,
      remainingSuspiciousChunks: 0,
    }
  }

  const settings = await readCachedSettings()
  const apiConfig = await getApiConfig()
  const language = settings.language || 'auto'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(path.dirname(file), `history.backup-before-quality-repair-${timestamp}.json`)
  await fs.copyFile(file, backupPath)

  const controller = new AbortController()
  const job = { controller } as { controller: AbortController; process?: ChildProcessWithoutNullStreams }
  const tempDir = path.join(os.tmpdir(), `tingxie-repair-${recordId}-${Date.now()}`)
  const concurrency = new AdaptiveConcurrencyController(apiConfig.adaptiveConcurrency)
  const rateLimiter = new RequestRateLimiter()
  const replacements = new Map<number, RecoveredTranscriptChunk[]>()
  let fileCounter = 0

  await fs.mkdir(tempDir, { recursive: true })
  try {
    async function splitRepairChunk(
      chunk: RecoverableAudioChunk,
      plan: TranscriptQualityRecoveryPlan,
      depth: number,
    ): Promise<[RecoverableAudioChunk, RecoverableAudioChunk]> {
      const physicalLead = chunk.overlapWithPrevious / 2
      const localSplit = physicalLead + plan.splitAt - chunk.start
      const leftDuration = physicalLead + plan.splitAt - chunk.start + plan.overlapPadding
      const rightOffset = Math.max(0, localSplit - plan.overlapPadding)
      const rightDuration = chunk.end - plan.splitAt + plan.overlapPadding
      const prefix = `quality-${String(fileCounter++).padStart(4, '0')}-d${depth}`
      const leftFile = path.join(tempDir, `${prefix}-left.mp3`)
      const rightFile = path.join(tempDir, `${prefix}-right.mp3`)
      await runProcess(unpacked(String(ffmpegStatic)), [
        '-y', '-ss', '0', '-i', chunk.file, '-t', leftDuration.toFixed(3),
        '-map', '0:a:0', '-vn', '-c:a', 'copy', leftFile,
      ], job)
      await runProcess(unpacked(String(ffmpegStatic)), [
        '-y', '-ss', rightOffset.toFixed(3), '-i', chunk.file, '-t', rightDuration.toFixed(3),
        '-map', '0:a:0', '-vn', '-c:a', 'copy', rightFile,
      ], job)
      return [
        { file: leftFile, start: chunk.start, end: plan.splitAt, overlapWithPrevious: chunk.overlapWithPrevious },
        { file: rightFile, start: plan.splitAt, end: chunk.end, overlapWithPrevious: plan.overlapPadding * 2 },
      ]
    }

    for (const original of suspiciousChunks) {
      const physicalLead = original.overlapWithPrevious / 2
      const sourceStart = Math.max(0, original.start - physicalLead)
      const sourceDuration = original.end - sourceStart
      const extractedFile = path.join(tempDir, `original-${String(original.index).padStart(4, '0')}.mp3`)
      await runProcess(unpacked(String(ffmpegStatic)), [
        '-y', '-ss', sourceStart.toFixed(3), '-i', record.sourcePath,
        '-t', sourceDuration.toFixed(3), '-map', '0:a:0', '-vn',
        '-c:a', 'libmp3lame', '-b:a', '256k', extractedFile,
      ], job)

      const recovered = await recoverTranscriptChunk({
        chunk: {
          file: extractedFile,
          start: original.start,
          end: original.end,
          overlapWithPrevious: (original.start - sourceStart) * 2,
        },
        silences: record.silences || [],
        transcribe: (candidate) => requestTranscript(
          candidate.file,
          language,
          controller.signal,
          apiConfig,
          concurrency,
          rateLimiter,
          { jobId: `repair:${recordId}`, chunkIndex: original.index, start: candidate.start, end: candidate.end },
        ),
        split: splitRepairChunk,
        onSplit: (candidate, plan, depth) => logDiagnostic('stored-chunk-quality-recovery-split', {
          recordId,
          originalChunkIndex: original.index,
          start: candidate.start,
          end: candidate.end,
          splitAt: plan.splitAt,
          overlapPadding: plan.overlapPadding,
          depth,
        }),
      })
      replacements.set(original.index, recovered)
    }

    const repairedChunks = applyChunkRepairs(record.chunks, replacements)
    const remainingSuspiciousChunks = repairedChunks.filter((chunk) => (
      chunk.status === 'success'
      && inspectTranscriptQuality(chunk.text, chunk.end - chunk.start).suspicious
    )).length
    if (remainingSuspiciousChunks) throw new Error('修复结果仍包含异常循环，已取消写入')

    const untouched = record.chunks.filter((chunk) => !replacements.has(chunk.index))
    const allUntouchedPreserved = untouched.every((original) => repairedChunks.some((candidate) => (
      candidate.start === original.start
      && candidate.end === original.end
      && candidate.overlapWithPrevious === original.overlapWithPrevious
      && candidate.text === original.text
      && candidate.status === original.status
      && candidate.error === original.error
    )))
    if (!allUntouchedPreserved) throw new Error('未标记的切片发生变化，已取消写入')

    const estimatedChunks: ChunkTranscriptOutcome[] = repairedChunks.map((chunk) => chunk.status === 'failed'
      ? {
          start: chunk.start,
          end: chunk.end,
          overlapWithPrevious: chunk.overlapWithPrevious,
          text: '',
          status: 'failed',
          error: chunk.error || '未知错误',
          attempts: chunk.attempts || 0,
          rateLimitWaits: chunk.rateLimitWaits,
        }
      : {
          start: chunk.start,
          end: chunk.end,
          overlapWithPrevious: chunk.overlapWithPrevious,
          text: chunk.text,
          status: 'success',
        })
    const segments: TranscriptResult['segments'] = estimateTranscriptSegments(
      estimatedChunks,
      record.duration,
      apiConfig.paragraphLength,
    )
    const failedSegmentCount = segments.filter((segment) => segment.status === 'failed').length
    const successfulChunkCount = repairedChunks.filter((chunk) => chunk.status === 'success').length
    const outcome: NonNullable<TranscriptResult['outcome']> = failedSegmentCount === 0
      ? 'complete'
      : successfulChunkCount > 0
        ? 'partial'
        : 'failed'
    const repairedRecord: TranscriptResult = {
      ...record,
      text: segments.map(plainTranscriptSegment).join('\n\n'),
      segments,
      chunks: repairedChunks,
      outcome,
      failedSegmentCount,
      analysis: undefined,
    }
    items[recordIndex] = repairedRecord
    await writeJson(file, items)

    const replacementChunks = [...replacements.values()].flat()
    const summary: StoredTranscriptRepairSummary = {
      recordId,
      repairedOriginalChunkIndexes: suspiciousChunks.map((chunk) => chunk.index),
      replacementChunkCount: replacementChunks.length,
      failedReplacementCount: replacementChunks.filter((chunk) => chunk.status === 'failed').length,
      finalChunkCount: repairedChunks.length,
      remainingSuspiciousChunks,
      backupPath,
    }
    logDiagnostic('stored-transcript-quality-repaired', { ...summary })
    return summary
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#ffffff',
    title: '听写',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
  return window
}

app.whenReady().then(async () => {
  const repairRecordId = process.env.TINGXIE_REPAIR_TRANSCRIPT_ID?.trim()
  if (repairRecordId) {
    try {
      const summary = await repairStoredTranscript(repairRecordId)
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    } catch (error) {
      process.exitCode = 1
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    }
    await diagnosticLogQueue.catch(() => undefined)
    app.quit()
    return
  }
  const window = createWindow()

  ipcMain.handle('media:open', async (): Promise<SelectedMedia[]> => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音视频文件', extensions: SUPPORTED_INPUTS }, { name: '所有文件', extensions: ['*'] }],
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async (file) => ({ path: file, name: path.basename(file), size: (await fs.stat(file)).size })))
  })

  ipcMain.handle('library:get', async (): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    return publicMediaLibrary(settings, await readMediaLibrary(settings))
  })

  ipcMain.handle('library:import', async (_event, input: { sources: SelectedMedia[]; folderId?: string }): Promise<MediaImportResult> => {
    const settings = await readCachedSettings()
    const root = mediaLibraryRoot(settings)
    const result = await importMediaAssets({
      index: await readMediaLibrary(settings),
      libraryRoot: root,
      sources: input.sources,
      folderId: input.folderId,
      createId: randomUUID,
      now: () => new Date().toISOString(),
    })
    const withMediaInfo: MediaLibraryIndex = {
      ...result.index,
      assets: await probeAllAssets(result.index.assets, new Set(result.imported.map((item) => item.id)), root),
    }
    await writeMediaLibrary(settings, withMediaInfo)
    return {
      library: publicMediaLibrary(settings, withMediaInfo),
      importedIds: result.imported.map((asset) => asset.id),
      duplicateIds: result.duplicates.map((asset) => asset.id),
    }
  })

  ipcMain.handle('library:import-folder', async (_event, folderId?: string): Promise<MediaImportResult | undefined> => {
    const choice = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: '导入媒体文件夹' })
    if (choice.canceled || !choice.filePaths[0]) return undefined
    const sources = await scanMediaDirectory(choice.filePaths[0])
    const settings = await readCachedSettings()
    const root = mediaLibraryRoot(settings)
    const result = await importMediaAssets({ index: await readMediaLibrary(settings), libraryRoot: root, sources, folderId, createId: randomUUID, now: () => new Date().toISOString() })
    const next: MediaLibraryIndex = {
      ...result.index,
      assets: await probeAllAssets(result.index.assets, new Set(result.imported.map((item) => item.id)), root),
    }
    await writeMediaLibrary(settings, next)
    return { library: publicMediaLibrary(settings, next), importedIds: result.imported.map((asset) => asset.id), duplicateIds: result.duplicates.map((asset) => asset.id) }
  })

  ipcMain.handle('library:create-folder', async (_event, name: string): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    const timestamp = new Date().toISOString()
    const next = createMediaFolder(await readMediaLibrary(settings), { id: randomUUID(), name, createdAt: timestamp, updatedAt: timestamp })
    await writeMediaLibrary(settings, next)
    return publicMediaLibrary(settings, next)
  })

  ipcMain.handle('library:rename-folder', async (_event, input: { id: string; name: string }): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    const next = renameMediaFolder(await readMediaLibrary(settings), input.id, input.name, new Date().toISOString())
    await writeMediaLibrary(settings, next)
    return publicMediaLibrary(settings, next)
  })

  ipcMain.handle('library:rename-asset', async (_event, input: { id: string; name: string }): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    const next = renameMediaAsset(await readMediaLibrary(settings), input.id, input.name, new Date().toISOString())
    await writeMediaLibrary(settings, next)
    return publicMediaLibrary(settings, next)
  })

  ipcMain.handle('library:move-assets', async (_event, input: { ids: string[]; folderId?: string }): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    const next = moveMediaAssets(await readMediaLibrary(settings), input.ids, input.folderId, new Date().toISOString())
    await writeMediaLibrary(settings, next)
    return publicMediaLibrary(settings, next)
  })

  ipcMain.handle('library:delete-assets', async (_event, ids: string[]): Promise<MediaLibrarySnapshot> => {
    const settings = await readCachedSettings()
    const index = await readMediaLibrary(settings)
    const deleting = index.assets.filter((asset) => ids.includes(asset.id))
    await Promise.all(deleting.map((asset) => fs.rm(resolveManagedMediaPath(mediaLibraryRoot(settings), asset), { force: true })))
    const next = { ...index, assets: index.assets.filter((asset) => !ids.includes(asset.id)) }
    await writeMediaLibrary(settings, next)
    return publicMediaLibrary(settings, next)
  })

  ipcMain.handle('library:recover-history-media', async (_event, transcriptId: string): Promise<MediaLibrarySnapshot> => {
    await ensureHistoryBackup(historyPath(), historyRecoveryBackupPath())
    const history = await readCachedHistory()
    const transcript = history.find((item) => item.id === transcriptId)
    if (!transcript) throw new Error('未找到该历史转写')
    if (!transcript.sourcePath) throw new Error('该记录没有保存原音频路径，可重新导入音频后手动核对')
    const sourceStat = await fs.stat(transcript.sourcePath).catch(() => undefined)
    if (!sourceStat?.isFile()) throw new Error('原音频已不在原位置，但转写文字仍可正常查看和导出')

    const settings = await readCachedSettings()
    let index = await readMediaLibrary(settings)
    const timestamp = new Date().toISOString()
    let recoveredFolder = index.folders.find((folder) => folder.name === '恢复的历史录音')
    if (!recoveredFolder) {
      recoveredFolder = { id: randomUUID(), name: '恢复的历史录音', createdAt: timestamp, updatedAt: timestamp }
      index = createMediaFolder(index, recoveredFolder)
    }
    const imported = await importMediaAssets({
      index,
      libraryRoot: mediaLibraryRoot(settings),
      sources: [{ path: transcript.sourcePath, name: transcript.fileName || path.basename(transcript.sourcePath), size: sourceStat.size }],
      folderId: recoveredFolder.id,
      createId: randomUUID,
      now: () => timestamp,
    })
    const asset = imported.imported[0] || imported.duplicates[0]
    if (!asset) throw new Error('音频迁入媒体库失败')
    index = linkTranscriptToAsset(
      imported.index,
      asset.id,
      transcript.id,
      transcript.outcome === 'failed' ? 'failed' : transcript.outcome === 'partial' ? 'partial' : 'transcribed',
      timestamp,
    )
    index = {
      ...index,
      assets: index.assets.map((item) => item.id === asset.id ? { ...item, duration: transcript.duration || item.duration } : item),
    }
    await writeMediaLibrary(settings, index)
    cachedHistory = attachManagedMediaToHistory(history, transcript.id, asset.id)
    await writeJson(historyPath(), cachedHistory)
    return publicMediaLibrary(settings, index)
  })

  ipcMain.handle('library:choose-root', async (): Promise<MediaLibrarySnapshot | undefined> => {
    const choice = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择媒体库存储位置' })
    if (choice.canceled || !choice.filePaths[0]) return undefined
    const currentSettings = await readCachedSettings()
    const currentRoot = mediaLibraryRoot(currentSettings)
    const nextRoot = path.resolve(choice.filePaths[0])
    if (nextRoot !== currentRoot) {
      const entries = await fs.readdir(nextRoot).catch(() => [])
      if (entries.length) throw new Error('请选择一个空文件夹作为新的媒体库位置')
      await fs.mkdir(nextRoot, { recursive: true })
      await fs.cp(currentRoot, nextRoot, { recursive: true }).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
      currentSettings.mediaLibraryRoot = nextRoot
      await writeJson(settingsPath(), currentSettings); invalidateSettings()
    }
    return publicMediaLibrary(currentSettings, await readMediaLibrary(currentSettings))
  })

  ipcMain.handle('media:probe', async (_event, pathname: string) => publicMediaInfo(await probe(pathname)))

  ipcMain.handle('media:transcribe', async (_event, input: { id: string; path: string; fileName: string; language: Language; mediaId?: string }) => {
    const controller = new AbortController()
    const job = { controller } as { controller: AbortController; process?: ChildProcessWithoutNullStreams }
    activeJobs.set(input.id, job)
    let tempDir: string | undefined
    try {
      emitProgress(window, { id: input.id, stage: 'preparing', progress: 0, detail: '正在分析媒体信息' })
      const apiConfig = await getApiConfig()
      const media = publicMediaInfo(await probe(input.path))
      const prepared = await prepareChunks(input.path, input.id, window, job, media.duration)
      tempDir = prepared.tempDir
      const concurrency = new AdaptiveConcurrencyController(apiConfig.adaptiveConcurrency)
      const rateLimiter = new RequestRateLimiter()
      let recoveryFileCounter = 0

      async function splitForQualityRecovery(
        chunk: RecoverableAudioChunk,
        plan: TranscriptQualityRecoveryPlan,
        depth: number,
      ): Promise<[RecoverableAudioChunk, RecoverableAudioChunk]> {
        if (!tempDir) tempDir = path.join(os.tmpdir(), `tingxie-${input.id}-${Date.now()}-quality-recovery`)
        await fs.mkdir(tempDir, { recursive: true })
        const extension = path.extname(chunk.file) || '.mp3'
        const physicalLead = chunk.overlapWithPrevious / 2
        const localSplit = physicalLead + plan.splitAt - chunk.start
        const leftDuration = physicalLead + plan.splitAt - chunk.start + plan.overlapPadding
        const rightOffset = Math.max(0, localSplit - plan.overlapPadding)
        const rightDuration = chunk.end - plan.splitAt + plan.overlapPadding
        const prefix = `quality-${String(recoveryFileCounter++).padStart(4, '0')}-d${depth}`
        const leftFile = path.join(tempDir, `${prefix}-left${extension}`)
        const rightFile = path.join(tempDir, `${prefix}-right${extension}`)
        await runProcess(unpacked(String(ffmpegStatic)), [
          '-y', '-ss', '0', '-i', chunk.file, '-t', leftDuration.toFixed(3),
          '-map', '0:a:0', '-vn', '-c:a', 'copy', leftFile,
        ], job)
        await runProcess(unpacked(String(ffmpegStatic)), [
          '-y', '-ss', rightOffset.toFixed(3), '-i', chunk.file, '-t', rightDuration.toFixed(3),
          '-map', '0:a:0', '-vn', '-c:a', 'copy', rightFile,
        ], job)
        return [
          { file: leftFile, start: chunk.start, end: plan.splitAt, overlapWithPrevious: chunk.overlapWithPrevious },
          { file: rightFile, start: plan.splitAt, end: chunk.end, overlapWithPrevious: plan.overlapPadding * 2 },
        ]
      }

      emitProgress(window, {
        id: input.id,
        stage: 'transcribing',
        progress: 0,
        detail: apiConfig.adaptiveConcurrency ? '正在自适应并发识别' : '正在顺序识别',
      })
      let failedChunks = 0
      const chunkGroups = await runAdaptivePool(prepared.chunks, async (chunk, chunkIndex) => {
        if (controller.signal.aborted) throw new Error('任务已取消')
        const recovered = await recoverTranscriptChunk({
          chunk,
          silences: prepared.silences,
          transcribe: (candidate) => requestTranscript(
            candidate.file,
            input.language,
            controller.signal,
            apiConfig,
            concurrency,
            rateLimiter,
            { jobId: input.id, chunkIndex, start: candidate.start, end: candidate.end },
          ),
          split: splitForQualityRecovery,
          onSplit: (candidate, plan, depth) => {
            logDiagnostic('chunk-quality-recovery-split', {
              jobId: input.id,
              chunkIndex,
              start: candidate.start,
              end: candidate.end,
              splitAt: plan.splitAt,
              overlapPadding: plan.overlapPadding,
              depth,
            })
            emitProgress(window, {
              id: input.id,
              stage: 'transcribing',
              progress: 0,
              detail: `第 ${chunkIndex + 1} 段出现异常循环，正在自动拆分恢复`,
            })
          },
        })
        failedChunks += recovered.filter((candidate) => candidate.status === 'failed').length
        return recovered
      }, concurrency, (completed, total, currentConcurrency) => {
        emitProgress(window, {
          id: input.id,
          stage: 'transcribing',
          progress: Math.round(completed / total * 100),
          detail: apiConfig.adaptiveConcurrency
            ? `已完成 ${completed}/${total} 段 · 失败 ${failedChunks} · 并发 ${currentConcurrency} · ${rateLimiter.currentRpm} RPM`
            : `已完成 ${completed}/${total} 段 · 失败 ${failedChunks}`,
        })
      })
      const chunkTranscripts = chunkGroups.flat()
      const segments: TranscriptResult['segments'] = estimateTranscriptSegments(chunkTranscripts, media.duration, apiConfig.paragraphLength)
      const failedSegmentCount = segments.filter((segment) => segment.status === 'failed').length
      const successfulChunkCount = chunkTranscripts.length - failedChunks
      const resultOutcome: NonNullable<TranscriptResult['outcome']> = failedSegmentCount === 0
        ? 'complete'
        : successfulChunkCount > 0
          ? 'partial'
          : 'failed'
      const result: TranscriptResult = {
        id: input.id,
        fileName: input.fileName,
        createdAt: new Date().toISOString(),
        text: segments.map(plainTranscriptSegment).join('\n\n'),
        segments,
        duration: media.duration,
        outcome: resultOutcome,
        failedSegmentCount,
        sourcePath: input.path,
        mediaId: input.mediaId,
        silences: prepared.silences,
        chunks: chunkTranscripts.map((chunk, index) => ({
          index,
          start: chunk.start,
          end: chunk.end ?? media.duration,
          overlapWithPrevious: chunk.overlapWithPrevious,
          text: chunk.text,
          status: chunk.status === 'failed' ? 'failed' : 'success',
          ...(chunk.status === 'failed' ? { error: chunk.error, attempts: chunk.attempts, rateLimitWaits: chunk.rateLimitWaits } : {}),
        })),
      }
      await saveHistory(result)
      if (input.mediaId) {
        const storedSettings = await readCachedSettings()
        const linked = linkTranscriptToAsset(
          await readMediaLibrary(storedSettings),
          input.mediaId,
          result.id,
          resultOutcome === 'complete' ? 'transcribed' : resultOutcome,
          new Date().toISOString(),
        )
        await writeMediaLibrary(storedSettings, linked)
      }
      logDiagnostic('transcription-completed', {
        jobId: input.id,
        inputChunks: prepared.chunks.length,
        chunks: chunkTranscripts.length,
        successfulChunks: successfulChunkCount,
        failedChunks,
        outcome: resultOutcome,
      })
      const detail = resultOutcome === 'complete'
        ? '转写完成'
        : resultOutcome === 'partial'
          ? `转写完成，${failedSegmentCount} 个片段失败`
          : '所有片段均转写失败'
      emitProgress(window, { id: input.id, stage: 'done', progress: 100, detail })
      return result
    } catch (error) {
      const cancelled = controller.signal.aborted
      emitProgress(window, {
        id: input.id,
        stage: cancelled ? 'cancelled' : 'error',
        progress: 0,
        detail: error instanceof Error ? error.message : '未知错误',
      })
      logDiagnostic('transcription-failed', {
        jobId: input.id,
        cancelled,
        error: normalizeErrorFingerprint(undefined, error instanceof Error ? error.message : '未知错误'),
      })
      throw error
    } finally {
      activeJobs.delete(input.id)
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle('media:cancel', (_event, id: string) => {
    activeJobs.get(id)?.controller.abort()
    return true
  })

  ipcMain.handle('settings:get', async () => {
    const settings = await readCachedSettings()
    const serviceMode = settings.serviceMode || 'payg'
    const configuredServices = (Object.keys(settings.encryptedKeys || {}) as ServiceMode[])
      .filter((mode) => Boolean(settings.encryptedKeys?.[mode]))
    return {
      hasApiKey: configuredServices.includes(serviceMode),
      language: settings.language || 'auto',
      serviceMode,
      configuredServices,
      adaptiveConcurrency: settings.adaptiveConcurrency !== false,
      preferences: { ...DEFAULT_APP_PREFERENCES, ...settings.preferences },
      mediaLibraryRoot: mediaLibraryRoot(settings),
    }
  })

  ipcMain.handle('settings:save', async (_event, input: { apiKey?: string; language: Language; serviceMode?: ServiceMode; adaptiveConcurrency?: boolean }) => {
    const current = await readCachedSettings()
    const serviceMode = input.serviceMode || current.serviceMode || 'payg'
    current.encryptedKeys ||= {}
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
      current.encryptedKeys[serviceMode] = safeStorage.encryptString(input.apiKey.trim()).toString('base64')
    }
    current.language = input.language
    current.serviceMode = serviceMode
    current.adaptiveConcurrency = input.adaptiveConcurrency ?? current.adaptiveConcurrency ?? true
    delete current.encryptedKey
    await writeJson(settingsPath(), current); invalidateSettings()
    const configuredServices = (Object.keys(current.encryptedKeys) as ServiceMode[])
      .filter((mode) => Boolean(current.encryptedKeys?.[mode]))
    return {
      hasApiKey: configuredServices.includes(serviceMode),
      language: current.language,
      serviceMode,
      configuredServices,
      adaptiveConcurrency: current.adaptiveConcurrency,
      preferences: { ...DEFAULT_APP_PREFERENCES, ...current.preferences },
      mediaLibraryRoot: mediaLibraryRoot(current),
    }
  })

  ipcMain.handle('preferences:save', async (_event, input: Partial<AppPreferences>) => {
    const current = await readCachedSettings()
    const preferences: AppPreferences = { ...DEFAULT_APP_PREFERENCES, ...current.preferences, ...input }
    preferences.uiScale = Math.min(125, Math.max(85, Number(preferences.uiScale) || 100))
    preferences.uiFontScale = Math.min(125, Math.max(85, Number(preferences.uiFontScale) || 100))
    preferences.transcriptFontSize = Math.min(24, Math.max(12, Number(preferences.transcriptFontSize) || 16))
    preferences.smartFontSize = Math.min(20, Math.max(10, Number(preferences.smartFontSize) || 12))
    preferences.chatFontSize = Math.min(20, Math.max(11, Number(preferences.chatFontSize) || 13))
    preferences.captionFontSize = Math.min(18, Math.max(12, Number(preferences.captionFontSize) || 12))
    preferences.chatPanelWidth = Math.min(720, Math.max(340, Number(preferences.chatPanelWidth) || 410))
    preferences.paragraphLength = ['compact', 'standard', 'long'].includes(preferences.paragraphLength)
      ? preferences.paragraphLength
      : 'standard'
    preferences.glassStrength = Math.min(85, Math.max(25, Number(preferences.glassStrength) || 55))
    preferences.defaultVolume = Math.min(1, Math.max(0, Number(preferences.defaultVolume) || 0))
    preferences.minimumSilenceSeconds = Math.min(5, Math.max(0.3, Number(preferences.minimumSilenceSeconds) || 0.8))
    preferences.seekSeconds = [5, 10, 15].includes(Number(preferences.seekSeconds)) ? Number(preferences.seekSeconds) : 5
    preferences.seekLeadSeconds = Math.min(2, Math.max(0, Number(preferences.seekLeadSeconds) || 0))
    current.preferences = preferences
    await writeJson(settingsPath(), current); invalidateSettings()
    return preferences
  })

  ipcMain.handle('settings:test', async (_event, input: { apiKey?: string; serviceMode: ServiceMode }) => {
    const apiConfig = await getApiConfig(input.serviceMode, input.apiKey)
    const response = await fetch(serviceEndpoint(apiConfig.serviceMode, 'models'), { headers: { 'api-key': apiConfig.apiKey } })
    if (!response.ok) throw new Error(response.status === 401 ? 'API Key 无效' : `连接失败（${response.status}）`)
    return true
  })

  ipcMain.handle('ai:settings:get', async () => publicAISettings(await readCachedSettings()))

  ipcMain.handle('ai:provider:save', async (_event, input: { provider: AIProvider; apiKey?: string }) => {
    const current = await readCachedSettings()
    const providers = storedAIProviders(current)
    const validated = validateAIProvider(input.provider)
    if (validated.kind === 'mimo-payg' || validated.kind === 'mimo-token-plan') validated.id = validated.kind
    else if (!validated.id || validated.id === 'mimo-payg' || validated.id === 'mimo-token-plan') validated.id = randomUUID()

    const existing = providers.find((provider) => provider.id === validated.id)
    if (validated.kind === 'openai-compatible') {
      validated.encryptedApiKey = input.apiKey?.trim() ? encryptApiKey(input.apiKey) : existing?.encryptedApiKey
    } else if (input.apiKey?.trim()) {
      current.encryptedKeys ||= {}
      const mode: ServiceMode = validated.kind === 'mimo-payg' ? 'payg' : 'token-plan'
      current.encryptedKeys[mode] = encryptApiKey(input.apiKey)
    }

    const nextProviders = providers.filter((provider) => provider.id !== validated.id)
    nextProviders.push(validated)
    current.ai = {
      ...current.ai,
      providers: nextProviders,
      selectedProviderId: validated.id,
    }
    await writeJson(settingsPath(), current); invalidateSettings()
    return publicAISettings(current)
  })

  ipcMain.handle('ai:provider:delete', async (_event, id: string) => {
    const current = await readCachedSettings()
    const provider = storedAIProviders(current).find((item) => item.id === id)
    if (!provider) return publicAISettings(current)
    if (provider.kind !== 'openai-compatible') throw new Error('小米内置 Provider 不能删除')
    current.ai = {
      ...current.ai,
      providers: storedAIProviders(current).filter((item) => item.id !== id),
      selectedProviderId: current.ai?.selectedProviderId === id ? 'mimo-payg' : current.ai?.selectedProviderId,
    }
    await writeJson(settingsPath(), current); invalidateSettings()
    return publicAISettings(current)
  })

  ipcMain.handle('ai:provider:select', async (_event, id: string) => {
    const current = await readCachedSettings()
    if (!storedAIProviders(current).some((provider) => provider.id === id)) throw new Error('AI Provider 不存在')
    current.ai = { ...current.ai, selectedProviderId: id }
    await writeJson(settingsPath(), current); invalidateSettings()
    return publicAISettings(current)
  })

  ipcMain.handle('ai:provider:test', async (_event, input: { provider: AIProvider; apiKey?: string }) => {
    const current = await readCachedSettings()
    const validated = validateAIProvider(input.provider)
    const saved = storedAIProviders(current).find((provider) => provider.id === validated.id)
    validated.encryptedApiKey = saved?.encryptedApiKey
    const apiKey = providerApiKey(current, validated, input.apiKey)
    const response = await fetch(`${validated.baseUrl}/models`, { headers: providerHeaders(validated, apiKey) })
    if (!response.ok) throw new Error(response.status === 401 ? 'API Key 无效' : `连接失败（${response.status}）`)
    return true
  })

  ipcMain.handle('ai:token-plan:acknowledge', async () => {
    const current = await readCachedSettings()
    current.ai = { ...current.ai, tokenPlanAcknowledged: true }
    await writeJson(settingsPath(), current); invalidateSettings()
    return publicAISettings(current)
  })

  ipcMain.handle('ai:chat:get', async (_event, transcriptId: string): Promise<AIChatSession> => {
    const sessions = await readChatSessions()
    return sessions[transcriptId] || { transcriptId, messages: [], updatedAt: new Date().toISOString() }
  })

  ipcMain.handle('ai:chat:clear', async (_event, transcriptId: string): Promise<AIChatSession> => {
    const sessions = await readChatSessions()
    const session: AIChatSession = { transcriptId, messages: [], updatedAt: new Date().toISOString() }
    sessions[transcriptId] = session
    cachedChats = sessions
    await writeJson(chatsPath(), sessions)
    return session
  })

  ipcMain.handle('ai:chat:cancel', (_event, requestId: string) => {
    activeAIRequests.get(requestId)?.abort()
    return true
  })

  ipcMain.handle('ai:chat:send', async (_event, input: {
    requestId: string
    transcript: TranscriptResult
    providerId?: string
    userMessage?: string
    mode?: 'new' | 'regenerate'
  }): Promise<AIChatSession> => {
    const requestController = new AbortController()
    activeAIRequests.set(input.requestId, requestController)
    try {
      const settings = await readCachedSettings()
      const providerId = input.providerId || publicAISettings(settings).selectedProviderId
      const provider = storedAIProviders(settings).find((item) => item.id === providerId)
      if (!provider) throw new Error('AI Provider 不存在')
      if (provider.kind === 'mimo-token-plan' && settings.ai?.tokenPlanAcknowledged !== true) {
        throw new Error('使用 Token Plan 前必须确认其适用范围')
      }
      const apiKey = providerApiKey(settings, provider)
      const sessions = await readChatSessions()
      const existing = sessions[input.transcript.id] || {
        transcriptId: input.transcript.id,
        messages: [],
        updatedAt: new Date().toISOString(),
      }
      const messages: AIMessage[] = [...existing.messages]
      if (input.mode === 'regenerate') {
        if (messages.at(-1)?.role === 'assistant') messages.pop()
        if (messages.at(-1)?.role !== 'user') throw new Error('没有可重新生成的用户问题')
      } else {
        const content = input.userMessage?.trim()
        if (!content) throw new Error('请输入问题')
        messages.push({ id: randomUUID(), role: 'user', content, createdAt: new Date().toISOString() })
      }
      const pendingSession: AIChatSession = {
        transcriptId: input.transcript.id,
        messages,
        updatedAt: new Date().toISOString(),
      }
      await writeChatSession(pendingSession)

      const requestMessages = buildChatMessages(
        input.transcript,
        messages,
        provider.systemPrompt,
        provider.contextWindow,
        provider.maxOutputTokens,
      )
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: providerHeaders(provider, apiKey),
        signal: requestController.signal,
        body: JSON.stringify({
          model: provider.model,
          messages: requestMessages,
          max_completion_tokens: provider.maxOutputTokens,
          stream: true,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string }; message?: string }
        throw new Error(body.error?.message || body.message || `AI 服务返回 ${response.status}`)
      }

      const assistantText = await readCompletionResponse(response, (delta) => {
        emitAIStream(window, {
          requestId: input.requestId,
          transcriptId: input.transcript.id,
          type: 'delta',
          delta,
        })
      })
      if (!assistantText.trim()) throw new Error('AI 服务返回了空内容')
      const completed: AIChatSession = {
        transcriptId: input.transcript.id,
        messages: [...messages, {
          id: randomUUID(),
          role: 'assistant',
          content: assistantText,
          createdAt: new Date().toISOString(),
        }],
        updatedAt: new Date().toISOString(),
      }
      await writeChatSession(completed)
      emitAIStream(window, { requestId: input.requestId, transcriptId: input.transcript.id, type: 'done' })
      return completed
    } catch (error) {
      const message = requestController.signal.aborted
        ? '已停止生成'
        : error instanceof Error ? error.message : 'AI 请求失败'
      emitAIStream(window, { requestId: input.requestId, transcriptId: input.transcript.id, type: 'error', message })
      throw new Error(message)
    } finally {
      activeAIRequests.delete(input.requestId)
    }
  })

  ipcMain.handle('ai:analysis:generate', async (_event, input: { transcript: TranscriptResult; providerId?: string }): Promise<TranscriptResult> => {
    const settings = await readCachedSettings()
    const providerId = input.providerId || publicAISettings(settings).selectedProviderId
    const provider = storedAIProviders(settings).find((item) => item.id === providerId)
    if (!provider) throw new Error('AI Provider 不存在')
    if (provider.kind === 'mimo-token-plan' && settings.ai?.tokenPlanAcknowledged !== true) {
      throw new Error('使用 Token Plan 前必须确认其适用范围')
    }
    const apiKey = providerApiKey(settings, provider)
    const analysis = await generateTranscriptAnalysis({
      transcript: input.transcript,
      provider: {
        id: provider.id,
        model: provider.model,
        baseUrl: provider.baseUrl,
        maxOutputTokens: provider.maxOutputTokens,
        jsonMode: provider.kind === 'openai-compatible'
          ? analysisJsonModeUnsupportedProviders.has(provider.id) ? 'disabled' : 'auto'
          : 'required',
      },
      headers: providerHeaders(provider, apiKey),
      onAttempt: (diagnostic) => {
        if (diagnostic.outcome === 'json-mode-fallback') analysisJsonModeUnsupportedProviders.add(provider.id)
        logDiagnostic('analysis-attempt', {
          transcriptId: input.transcript.id,
          providerId: provider.id,
          model: provider.model,
          ...diagnostic,
        })
      },
    })
    const result = { ...input.transcript, analysis }
    await saveHistory(result)
    return result
  })

  ipcMain.handle('history:get', async () => {
    await ensureHistoryBackup(historyPath(), historyRecoveryBackupPath())
    return readCachedHistory()
  })
  ipcMain.handle('history:update', async (_event, result: TranscriptResult) => {
    await saveHistory(result)
    return result
  })
  ipcMain.handle('media:get-url', async (_event, transcriptId: string) => {
    const items = await readCachedHistory()
    const transcript = items.find((item) => item.id === transcriptId)
    const settings = await readCachedSettings()
    const library = await readMediaLibrary(settings)
    const managedAsset = transcript?.mediaId ? library.assets.find((asset) => asset.id === transcript.mediaId) : undefined
    const sourcePath = managedAsset ? resolveManagedMediaPath(mediaLibraryRoot(settings), managedAsset) : transcript?.sourcePath
    if (!sourcePath || !(await fs.stat(sourcePath).then(() => true).catch(() => false))) return ''
    const normalized = sourcePath.replace(/\\/g, '/')
    return encodeURI(`file:///${normalized}`)
  })
  ipcMain.handle('history:delete', async (_event, id: string) => {
    const items = await readCachedHistory()
    cachedHistory = items.filter((item) => item.id !== id)
    await writeJson(historyPath(), cachedHistory)
    const sessions = await readChatSessions()
    delete sessions[id]
    cachedChats = sessions
    await writeJson(chatsPath(), sessions)
    return true
  })

  ipcMain.handle('transcript:export', async (_event, result: TranscriptResult) => {
    const defaultName = `${path.parse(result.fileName).name}-转写.txt`
    const output = await dialog.showSaveDialog(window, {
      defaultPath: defaultName,
      filters: [{ name: '纯文本', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }],
    })
    if (output.canceled || !output.filePath) return false
    await fs.writeFile(output.filePath, result.text, 'utf8')
    return true
  })

  ipcMain.handle('transcript:copy', (_event, text: string) => {
    clipboard.writeText(text)
    return true
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
