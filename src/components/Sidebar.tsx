import { memo } from 'react'
import { FileText, Library, PanelLeftClose, PanelLeftOpen, Settings, SquarePlus, Waves, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { TranscriptSummary } from '../../electron/types'
import { useMotionVariants } from '../motion/variants'

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
  const { fade, listItem } = useMotionVariants()
  return (
    <m.aside layout className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand"><Waves size={24} strokeWidth={2.2} /><AnimatePresence initial={false}>{!collapsed && <m.span key="brand-label" variants={fade} initial="initial" animate="animate" exit="exit">听写</m.span>}</AnimatePresence></div>
      <nav className="nav-list" aria-label="主导航">
        <button aria-label="新建转写" className={current === 'new' ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate('new')}>
          {current === 'new' && <m.i className="nav-active-indicator" layoutId="nav-active-indicator" />}
          <SquarePlus size={20} /><AnimatePresence initial={false}>{!collapsed && <m.span key="new-label" variants={fade} initial="initial" animate="animate" exit="exit">新建转写</m.span>}</AnimatePresence>
        </button>
        <button aria-label="媒体库" title={collapsed ? '媒体库' : undefined} className={current === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate('library')}>
          {current === 'library' && <m.i className="nav-active-indicator" layoutId="nav-active-indicator" />}
          <Library size={20} /><AnimatePresence initial={false}>{!collapsed && <m.span key="library-label" variants={fade} initial="initial" animate="animate" exit="exit">媒体库</m.span>}</AnimatePresence>
        </button>
      </nav>
      {recentTranscripts.length > 0 && <m.section layout className="sidebar-recents" aria-label="已打开的转写">
        <AnimatePresence initial={false}>{!collapsed && <m.h2 key="recent-heading" variants={fade} initial="initial" animate="animate" exit="exit">已打开</m.h2>}</AnimatePresence>
        <AnimatePresence initial={false} mode="popLayout">{recentTranscripts.map((item) => <m.div layout variants={listItem} initial="initial" animate="animate" exit="exit" key={item.id} className={`sidebar-recent-item${activeTranscriptId === item.id && current === 'new' ? ' active' : ''}`}>
          <button className="sidebar-recent-open" title={collapsed ? item.fileName : undefined} aria-label={`返回转写：${item.fileName}`} onClick={() => onOpenTranscript(item)}><FileText size={16} />{!collapsed && <m.span variants={fade} initial="initial" animate="animate" exit="exit">{item.fileName}</m.span>}</button>
          {!collapsed && <button className="sidebar-recent-remove" aria-label={`从已打开列表移除：${item.fileName}`} onClick={() => onRemoveRecent(item.id)}><X size={13} /></button>}
        </m.div>)}</AnimatePresence>
      </m.section>}
      <div className="sidebar-bottom">
        <button aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} className="nav-item sidebar-toggle" onClick={onToggle}><AnimatePresence initial={false} mode="wait"><m.span className="motion-icon-slot" key={collapsed ? 'open' : 'close'} variants={fade} initial="initial" animate="animate" exit="exit">{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</m.span></AnimatePresence>{!collapsed && <span>收起侧栏</span>}</button>
        <button aria-label="设置" title={collapsed ? '设置' : undefined} className="nav-item settings-link" onClick={onSettings}><Settings size={20} />{!collapsed && <span>设置</span>}</button>
      </div>
    </m.aside>
  )
})
