import { memo, useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronDown, ChevronUp, FileAudio, FileVideo, ListMusic, MoreHorizontal, RotateCcw, Square, X } from 'lucide-react'
import type { QueueFile } from '../types'
import { extensionOf, formatBytes, formatDuration, statusLabel } from '../utils'
import { changedQueueFile, isNearQueueBottom } from './queue-follow'

interface QueuePanelProps {
  files: QueueFile[]
  selectedId?: string
  onSelect(file: QueueFile): void
  onCancel(file: QueueFile): void
  onRemove(file: QueueFile): void
  onRetry(file: QueueFile): void
}

function isVideo(name: string): boolean {
  return /\.(mp4|mov|mkv|avi|webm|wmv|mpeg|mpg)$/i.test(name)
}

export const QueuePanel = memo(function QueuePanel({ files, selectedId, onSelect, onCancel, onRemove, onRetry }: QueuePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const previousFiles = useRef(files)
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(() => new Set())
  const scrollBehavior = () => document.documentElement.dataset.reducedMotion === 'true' ? 'auto' as const : 'smooth' as const

  useEffect(() => {
    const changed = changedQueueFile(previousFiles.current, files)
    previousFiles.current = files
    if (!changed || !followRef.current) return
    const frame = requestAnimationFrame(() => rowRefs.current.get(changed.id)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }))
    return () => cancelAnimationFrame(frame)
  }, [files])

  function resumeFollowing() {
    followRef.current = true
    setFollowing(true)
    const active = [...files].reverse().find((file) => ['preparing', 'extracting', 'transcribing'].includes(file.status)) || files.at(-1)
    if (active) rowRefs.current.get(active.id)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }

  return (
    <section className="queue-section">
      <div className="section-heading"><div><h2>转写队列</h2><p>新加入的文件会在这里显示处理状态</p></div><span>{files.length} 个文件</span></div>
      <div ref={listRef} className="queue-list" onScroll={(event) => { const nearBottom = isNearQueueBottom(event.currentTarget); followRef.current = nearBottom; setFollowing(nearBottom) }}>
        {!files.length && <div className="queue-empty"><span><ListMusic size={27} /></span><strong>队列中还没有任务</strong><p>选择或拖入音视频文件后，可在这里查看进度与重试失败任务。</p></div>}
        {files.map((file) => {
          const active = ['preparing', 'extracting', 'transcribing'].includes(file.status)
          return (
            <article
              key={file.id}
              ref={(element) => { if (element) rowRefs.current.set(file.id, element); else rowRefs.current.delete(file.id) }}
              className={`queue-row${selectedId === file.id ? ' selected' : ''}`}
              onClick={() => file.result && onSelect(file)}
            >
              <div className={`file-icon ${isVideo(file.name) ? 'video' : 'audio'}`}>
                {isVideo(file.name) ? <FileVideo size={22} /> : <FileAudio size={22} />}
              </div>
              <div className="file-main">
                <div className="file-title" title={file.name}>{file.name}</div>
                <div className="file-meta">{extensionOf(file.name)}<span>·</span>{formatDuration(file.duration)}<span>·</span>{formatBytes(file.size)}</div>
              </div>
              <div className="file-progress">
                <div className={`status-text ${file.status}${expandedDetails.has(file.id) ? ' expanded' : ''}`} aria-live="polite">{statusLabel(file.status, file.detail)}</div>
                {(file.detail?.length || 0) > 48 && <button className="queue-detail-toggle" onClick={(event) => { event.stopPropagation(); setExpandedDetails((current) => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else next.add(file.id); return next }) }}>{expandedDetails.has(file.id) ? <><ChevronUp size={12} />收起</> : <><ChevronDown size={12} />展开</>}</button>}
                <div className="progress-track"><span style={{ width: `${file.progress}%` }} /></div>
              </div>
              <div className="row-actions">
                {(file.status === 'done' || file.status === 'partial') && <span className={file.status === 'partial' ? 'done-mark partial' : 'done-mark'} aria-label={file.status === 'partial' ? '部分完成' : '完成'}><Check size={16} /></span>}
                {active && <button aria-label="取消任务" onClick={(event) => { event.stopPropagation(); onCancel(file) }}><Square size={15} /></button>}
                {file.status === 'error' && <button aria-label="重试" onClick={(event) => { event.stopPropagation(); onRetry(file) }}><RotateCcw size={16} /></button>}
                {['waiting', 'done', 'partial', 'error', 'cancelled'].includes(file.status) && <button aria-label="移除" onClick={(event) => { event.stopPropagation(); onRemove(file) }}><X size={17} /></button>}
                <MoreHorizontal className="more-glyph" size={19} />
              </div>
            </article>
          )
        })}
      </div>
      {!following && files.length > 0 && <button className="queue-follow-button" onClick={resumeFollowing}><ArrowDown size={14} />回到最新进度</button>}
    </section>
  )
})
