import { Library, PanelLeftClose, PanelLeftOpen, Settings, SquarePlus, Waves } from 'lucide-react'

interface SidebarProps {
  current: 'new' | 'library'
  collapsed: boolean
  onNavigate(value: 'new' | 'library'): void
  onToggle(): void
  onSettings(): void
}

export function Sidebar({ current, collapsed, onNavigate, onToggle, onSettings }: SidebarProps) {
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
      <div className="sidebar-bottom">
        <button aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} className="nav-item sidebar-toggle" onClick={onToggle}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}<span>收起侧栏</span></button>
        <button aria-label="设置" title={collapsed ? '设置' : undefined} className="nav-item settings-link" onClick={onSettings}><Settings size={20} /><span>设置</span></button>
      </div>
    </aside>
  )
}
