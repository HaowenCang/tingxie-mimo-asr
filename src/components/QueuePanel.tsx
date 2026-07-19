import { Check, FileAudio, FileVideo, ListMusic, MoreHorizontal, RotateCcw, Square, X } from 'lucide-react'
import type { QueueFile } from '../types'
import { extensionOf, formatBytes, formatDuration, statusLabel } from '../utils'

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

export function QueuePanel({ files, selectedId, onSelect, onCancel, onRemove, onRetry }: QueuePanelProps) {
  return (
    <section className="queue-section">
      <div className="section-heading"><div><h2>转写队列</h2><p>新加入的文件会在这里显示处理状态</p></div><span>{files.length} 个文件</span></div>
      <div className="queue-list">
        {!files.length && <div className="queue-empty"><span><ListMusic size={27} /></span><strong>队列中还没有任务</strong><p>选择或拖入音视频文件后，可在这里查看进度与重试失败任务。</p></div>}
        {files.map((file) => {
          const active = ['preparing', 'extracting', 'transcribing'].includes(file.status)
          return (
            <article
              key={file.id}
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
                <div className={`status-text ${file.status}`}>{statusLabel(file.status, file.detail)}</div>
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
    </section>
  )
}
