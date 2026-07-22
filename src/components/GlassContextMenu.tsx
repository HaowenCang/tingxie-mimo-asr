import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { memo, type ReactElement, type ReactNode } from 'react'

export type GlassContextMenuEntry =
  | { type: 'separator'; id: string }
  | { type: 'action'; id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect(): void }
  | { type: 'submenu'; id: string; label: string; icon?: ReactNode; disabled?: boolean; children: GlassContextMenuEntry[] }

interface GlassContextMenuProps {
  children: ReactElement
  entries: GlassContextMenuEntry[]
  ariaLabel: string
  onOpenChange?(open: boolean): void
}

function MenuEntries({ entries }: { entries: GlassContextMenuEntry[] }) {
  return entries.map((entry) => {
    if (entry.type === 'separator') return <ContextMenu.Separator key={entry.id} className="glass-context-separator" />
    if (entry.type === 'submenu') return <ContextMenu.Sub key={entry.id}>
      <ContextMenu.SubTrigger className="glass-context-item" disabled={entry.disabled}>
        <span className="glass-context-icon">{entry.icon}</span><span>{entry.label}</span><ChevronRight className="glass-context-chevron" size={14} />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal><ContextMenu.SubContent className="glass-context-content" sideOffset={5} collisionPadding={12}><MenuEntries entries={entry.children} /></ContextMenu.SubContent></ContextMenu.Portal>
    </ContextMenu.Sub>
    return <ContextMenu.Item
      key={entry.id}
      className={`glass-context-item${entry.danger ? ' danger' : ''}`}
      disabled={entry.disabled}
      onSelect={entry.onSelect}
    >
      <span className="glass-context-icon">{entry.icon}</span><span>{entry.label}</span>
    </ContextMenu.Item>
  })
}

export const GlassContextMenu = memo(function GlassContextMenu({ children, entries, ariaLabel, onOpenChange }: GlassContextMenuProps) {
  return <ContextMenu.Root onOpenChange={onOpenChange}>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content className="glass-context-content" aria-label={ariaLabel} collisionPadding={12}>
        <MenuEntries entries={entries} />
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
})
