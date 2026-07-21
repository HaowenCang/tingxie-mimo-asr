import { memo } from 'react'
import { FileText, Library, PanelLeftClose, PanelLeftOpen, Settings, SquarePlus, Waves, X } from 'lucide-react'
import type { TranscriptSummary } from '../../electron/types'

interface SidebarProps {
  current: 'new' | 'library'
  collapsed: boolean
  onNavigate(value: 'new' | 'library'): void
  onToggle(): void
  onSettings(): void
  recentTranscripts: TranscriptSummary[]
  activeTranscriptId?: string
  onOpenTranscript(item: TranscriptSummary): void
  onRemoveRecent(id: string): void
}

export const Sidebar = memo(function Sidebar({ current, collapsed, onNavigate, onToggle, onSettings, recentTranscripts, activeTranscriptId, onOpenTranscript, onRemoveRecent }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand"><Waves size={24} strokeWidth={2.2} /><span>听写</span></div>
      <nav className="nav-list" aria-label="主导航">
        <button aria-label="新建转写" className={current === 'new' ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate('new')}>
          <SquarePlus size={20} /><span>新建转写</span>
        </button>
        <button aria-label="媒体库" title={collapsed ? '媒体库' : undefined} className={current === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate('library')}>
          <Library size={20} /><span>媒体库</span>
        </button>
      </nav>
      {recentTranscripts.length > 0 && <section className="sidebar-recents" aria-label="已打开的转写">
        {!collapsed && <h2>已打开</h2>}
        {recentTranscripts.map((item) => <div key={item.id} className={`sidebar-recent-item${activeTranscriptId === item.id && current === 'new' ? ' active' : ''}`}>
          <button className="sidebar-recent-open" title={collapsed ? item.fileName : undefined} aria-label={`返回转写：${item.fileName}`} onClick={() => onOpenTranscript(item)}><FileText size={16} /><span>{item.fileName}</span></button>
          {!collapsed && <button className="sidebar-recent-remove" aria-label={`从已打开列表移除：${item.fileName}`} onClick={() => onRemoveRecent(item.id)}><X size={13} /></button>}
        </div>)}
      </section>}
      <div className="sidebar-bottom">
        <button aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} className="nav-item sidebar-toggle" onClick={onToggle}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}<span>收起侧栏</span></button>
        <button aria-label="设置" title={collapsed ? '设置' : undefined} className="nav-item settings-link" onClick={onSettings}><Settings size={20} /><span>设置</span></button>
      </div>
    </aside>
  )
})
