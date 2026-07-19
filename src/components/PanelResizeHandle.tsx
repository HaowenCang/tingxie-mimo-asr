import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

export const DEFAULT_CHAT_PANEL_WIDTH = 410
export const MIN_CHAT_PANEL_WIDTH = 340
export const MAX_CHAT_PANEL_WIDTH = 720

const DESKTOP_BREAKPOINT = 1220
const DESKTOP_SIDEBAR_WIDTH = 176
const COMPACT_SIDEBAR_WIDTH = 78
const DESKTOP_HORIZONTAL_PADDING = 28
const COMPACT_HORIZONTAL_PADDING = 20
const GRID_GAPS = 24
const MIN_TRANSCRIPT_WIDTH = 560

export function chatPanelWidthBounds(shellWidth: number) {
  const compact = shellWidth <= DESKTOP_BREAKPOINT
  const sidebarWidth = compact ? COMPACT_SIDEBAR_WIDTH : DESKTOP_SIDEBAR_WIDTH
  const horizontalPadding = compact ? COMPACT_HORIZONTAL_PADDING : DESKTOP_HORIZONTAL_PADDING
  const available = shellWidth - sidebarWidth - horizontalPadding - GRID_GAPS - MIN_TRANSCRIPT_WIDTH
  return { min: MIN_CHAT_PANEL_WIDTH, max: Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, available)) }
}

export function clampChatPanelWidth(width: number, shellWidth: number) {
  const { min, max } = chatPanelWidthBounds(shellWidth)
  return Math.round(Math.min(max, Math.max(min, width)))
}

interface PanelResizeHandleProps {
  width: number
  shellWidth: number
  onResize(width: number): void
  onCommit(width: number): void
  onReset(): void
}

export const PanelResizeHandle = memo(function PanelResizeHandle({ width, shellWidth, onResize, onCommit, onReset }: PanelResizeHandleProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; latestWidth: number } | undefined>(undefined)
  const bounds = chatPanelWidthBounds(shellWidth)

  useEffect(() => () => document.documentElement.classList.remove('resizing-chat-panel'), [])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, latestWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('dragging')
    document.documentElement.classList.add('resizing-chat-panel')
    event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampChatPanelWidth(drag.startWidth + drag.startX - event.clientX, shellWidth)
    drag.latestWidth = next
    onResize(next)
  }

  function finishPointerDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.classList.remove('dragging')
    document.documentElement.classList.remove('resizing-chat-panel')
    onCommit(drag.latestWidth)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') {
      onReset()
      return
    }
    const step = event.shiftKey ? 64 : 24
    const next = clampChatPanelWidth(width + (event.key === 'ArrowLeft' ? step : -step), shellWidth)
    onResize(next)
    onCommit(next)
  }

  return <div
    className="chat-panel-resizer"
    role="separator"
    aria-label="调整 AI 对话宽度"
    aria-orientation="vertical"
    aria-controls="ai-chat-panel"
    aria-valuemin={bounds.min}
    aria-valuemax={bounds.max}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    title="拖动调整 AI 对话宽度，双击恢复默认"
    onDoubleClick={onReset}
    onKeyDown={handleKeyDown}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={finishPointerDrag}
    onPointerCancel={finishPointerDrag}
    onLostPointerCapture={finishPointerDrag}
  ><span /></div>
})
