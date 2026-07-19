import { CalendarDays, FileText, Search, Trash2 } from 'lucide-react'
import type { TranscriptResult } from '../../electron/types'
import { formatDuration } from '../utils'

interface HistoryViewProps {
  items: TranscriptResult[]
  onOpen(item: TranscriptResult): void
  onDelete(item: TranscriptResult): void
}

export function HistoryView({ items, onOpen, onDelete }: HistoryViewProps) {
  return (
    <main className="history-view">
      <header className="page-header"><div><h1>历史记录</h1><p>最近完成的转写保存在这台电脑上</p></div><label className="history-search"><Search size={17} /><input placeholder="搜索文件名" /></label></header>
      {items.length ? <div className="history-table">
        <div className="history-table-head"><span>文件</span><span>时长</span><span>创建时间</span><span /></div>
        {items.map((item) => <div className="history-row" role="button" tabIndex={0} key={item.id} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(item) }}>
          <span className="history-file"><i><FileText size={19} /></i><span><strong>{item.fileName}</strong><small>{item.text.slice(0, 48)}{item.text.length > 48 ? '…' : ''}</small></span></span>
          <span>{formatDuration(item.duration)}</span>
          <span><CalendarDays size={14} />{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
          <span><button aria-label="删除" onClick={(event) => { event.stopPropagation(); onDelete(item) }}><Trash2 size={17} /></button></span>
        </div>)}
      </div> : <div className="history-empty"><FileText size={32} /><h2>还没有转写记录</h2><p>完成的转写会自动出现在这里。</p></div>}
    </main>
  )
}
