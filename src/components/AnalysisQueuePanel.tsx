import { AlertTriangle, Clock3, Eye, FileClock, LoaderCircle, PauseCircle, Play, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import type { AppPreferences, BackgroundAnalysisQueueSnapshot, TranscriptSummary } from '../../electron/types'
import { buildAnalysisQueueView, type AnalysisQueueViewItem, type AnalysisQueueViewStatus } from './analysis-queue-view-model'

type QueueFilter = 'all' | 'active' | 'pending' | 'error'

interface AnalysisQueuePanelProps {
  snapshot: BackgroundAnalysisQueueSnapshot
  history: TranscriptSummary[]
  preferences: AppPreferences
  providerName?: string
  providerConfigured: boolean
  onClose(): void
  onOpen(transcriptId: string): void
  onGenerate(transcriptId: string): Promise<void>
  onRetry(transcriptId: string): Promise<void>
  onDismiss(transcriptId: string): Promise<void>
}

const ACTIVE = new Set<AnalysisQueueViewStatus>(['running', 'queued', 'retry-wait'])
const PENDING = new Set<AnalysisQueueViewStatus>(['missing', 'stale'])
const ERRORS = new Set<AnalysisQueueViewStatus>(['blocked', 'failed', 'history-error'])

function statusMeta(item: AnalysisQueueViewItem): { label: string; detail: string; tone: string } {
  if (item.status === 'running') return { label: '正在生成', detail: `第 ${item.attempts} 次请求`, tone: 'active' }
  if (item.status === 'queued') return { label: '排队中', detail: item.queuePosition ? `队列第 ${item.queuePosition} 位` : '等待后台处理', tone: 'active' }
  if (item.status === 'retry-wait') return { label: '等待重试', detail: item.nextRetryAt ? `预计 ${new Date(item.nextRetryAt).toLocaleTimeString()}` : '服务恢复后自动继续', tone: 'waiting' }
  if (item.status === 'blocked') return { label: '等待配置', detail: item.error || '请检查 AI Provider', tone: 'error' }
  if (item.status === 'failed') return { label: '生成失败', detail: item.error || '可修正配置后重试', tone: 'error' }
  if (item.status === 'history-error') return { label: '历史生成失败', detail: '可重新生成智能速览', tone: 'error' }
  if (item.status === 'stale') return { label: '速览已过期', detail: '原文修改后需要重新生成', tone: 'pending' }
  return { label: '尚未生成', detail: '从历史记录中检测到', tone: 'pending' }
}

function matchesFilter(status: AnalysisQueueViewStatus, filter: QueueFilter): boolean {
  if (filter === 'active') return ACTIVE.has(status)
  if (filter === 'pending') return PENDING.has(status)
  if (filter === 'error') return ERRORS.has(status)
  return true
}

const QueueStatusIcon = memo(function QueueStatusIcon({ status }: { status: AnalysisQueueViewStatus }) {
  if (status === 'running') return <LoaderCircle className="spin" size={17} />
  if (status === 'queued') return <Clock3 size={17} />
  if (status === 'retry-wait') return <RefreshCw size={17} />
  if (status === 'blocked') return <PauseCircle size={17} />
  if (status === 'failed' || status === 'history-error') return <AlertTriangle size={17} />
  return <FileClock size={17} />
})

export const AnalysisQueuePanel = memo(function AnalysisQueuePanel({
  snapshot,
  history,
  preferences,
  providerName,
  providerConfigured,
  onClose,
  onOpen,
  onGenerate,
  onRetry,
  onDismiss,
}: AnalysisQueuePanelProps) {
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [busyId, setBusyId] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(100)
  const [operationError, setOperationError] = useState('')
  const items = useMemo(() => buildAnalysisQueueView({ history, jobs: snapshot.jobs }), [history, snapshot.jobs])
  const filtered = useMemo(() => items.filter((item) => matchesFilter(item.status, filter)), [items, filter])
  const visible = filtered.slice(0, visibleLimit)
  const activeCount = items.filter((item) => ACTIVE.has(item.status)).length
  const pendingCount = items.filter((item) => PENDING.has(item.status)).length
  const errorCount = items.filter((item) => ERRORS.has(item.status)).length

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function perform(item: AnalysisQueueViewItem, operation: 'generate' | 'retry' | 'dismiss') {
    setBusyId(item.transcriptId)
    setOperationError('')
    try {
      if (operation === 'dismiss') await onDismiss(item.transcriptId)
      else if (operation === 'retry') await onRetry(item.transcriptId)
      else await onGenerate(item.transcriptId)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : '操作失败，请稍后重试。')
    } finally {
      setBusyId('')
    }
  }

  return <div className="analysis-queue-backdrop" onMouseDown={onClose}>
    <aside className="analysis-queue-panel" role="dialog" aria-modal="true" aria-labelledby="analysis-queue-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span><Sparkles size={19} /></span><div><h2 id="analysis-queue-title">智能速览队列</h2><p>后台任务与历史待生成记录</p></div></div>
        <button className="icon-button" aria-label="关闭智能速览队列" onClick={onClose}><X size={19} /></button>
      </header>
      <section className="analysis-queue-summary">
        <span><b>{activeCount}</b><small>处理中</small></span>
        <span><b>{pendingCount}</b><small>历史待生成</small></span>
        <span><b>{errorCount}</b><small>需要处理</small></span>
      </section>
      <div className="analysis-queue-policy">
        <span>{preferences.autoGenerateAnalysis ? <Play size={15} /> : <PauseCircle size={15} />}</span>
        <div><strong>{preferences.autoGenerateAnalysis ? '自动生成已开启' : '自动生成已暂停'}</strong><small>{providerConfigured ? `当前 Provider：${providerName || '已配置'}` : '尚未配置可用的 AI Provider'}</small></div>
      </div>
      {operationError && <div className="analysis-queue-operation-error" role="alert"><AlertTriangle size={15} />{operationError}</div>}
      <nav className="analysis-queue-filters" aria-label="智能速览队列筛选">
        {([
          ['all', `全部 ${items.length}`],
          ['active', `处理中 ${activeCount}`],
          ['pending', `待生成 ${pendingCount}`],
          ['error', `异常 ${errorCount}`],
        ] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setVisibleLimit(100) }}>{label}</button>)}
      </nav>
      <div className="analysis-queue-list">
        {visible.length === 0 ? <div className="analysis-queue-empty"><Sparkles size={25} /><strong>当前筛选下没有任务</strong><p>新转写完成或检测到历史缺失速览后会显示在这里。</p></div> : visible.map((item) => {
          const meta = statusMeta(item)
          const busy = busyId === item.transcriptId
          const canRetry = item.status === 'failed' || item.status === 'blocked' || item.status === 'history-error'
          const canGenerate = item.status === 'missing' || item.status === 'stale'
          const canDismiss = item.status !== 'running'
          return <article key={`${item.transcriptId}:${item.sourceRevision}`} className={`analysis-queue-item ${meta.tone}`}>
            <span className="analysis-queue-status-icon"><QueueStatusIcon status={item.status} /></span>
            <div className="analysis-queue-item-content">
              <div><strong title={item.fileName}>{item.fileName}</strong><span className={`analysis-status-pill ${meta.tone}`}>{meta.label}</span></div>
              <p>{meta.detail}</p>
              <small>{item.origin === 'manual' ? '手动任务' : item.origin === 'automatic' ? '自动任务' : '历史检测'} · {new Date(item.createdAt).toLocaleString()}</small>
            </div>
            <div className="analysis-queue-actions">
              <button className="icon-button" aria-label={`打开转写：${item.fileName}`} onClick={() => onOpen(item.transcriptId)}><Eye size={15} /></button>
              {(canRetry || canGenerate) && <button className="soft-button" disabled={busy} onClick={() => void perform(item, canRetry ? 'retry' : 'generate')}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{canGenerate ? item.status === 'stale' ? '重新生成' : '生成' : '重试'}</button>}
              {canDismiss && <button className="icon-button danger" disabled={busy} aria-label={`从智能速览队列移除：${item.fileName}`} onClick={() => void perform(item, 'dismiss')}><Trash2 size={15} /></button>}
            </div>
          </article>
        })}
        {visibleLimit < filtered.length && <button className="analysis-queue-more" onClick={() => setVisibleLimit((value) => value + 100)}>再显示 {Math.min(100, filtered.length - visibleLimit)} 项</button>}
      </div>
    </aside>
  </div>
})
