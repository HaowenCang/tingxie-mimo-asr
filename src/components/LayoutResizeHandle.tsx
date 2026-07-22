import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface LayoutResizeHandleProps {
  className: string
  label: string
  orientation: 'vertical' | 'horizontal'
  value: number
  min: number
  max: number
  direction?: 1 | -1
  onResize(value: number): void
  onCommit(value: number): void
  onReset(): void
}

export const LayoutResizeHandle = memo(function LayoutResizeHandle({ className, label, orientation, value, min, max, direction = 1, onResize, onCommit, onReset }: LayoutResizeHandleProps) {
  const dragRef = useRef<{ pointerId: number; start: number; value: number; latest: number } | undefined>(undefined)
  useEffect(() => () => document.documentElement.classList.remove('resizing-layout'), [])

  function clamp(next: number) { return Math.round(Math.min(max, Math.max(min, next))) }
  function pointerCoordinate(event: PointerEvent<HTMLDivElement>) { return orientation === 'vertical' ? event.clientX : event.clientY }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, start: pointerCoordinate(event), value, latest: value }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('dragging')
    document.documentElement.classList.add('resizing-layout')
    event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.latest = clamp(drag.value + (pointerCoordinate(event) - drag.start) * direction)
    onResize(drag.latest)
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.classList.remove('dragging')
    document.documentElement.classList.remove('resizing-layout')
    onCommit(drag.latest)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const previous = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const next = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (![previous, next, 'Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') return onReset()
    const delta = (event.shiftKey ? 48 : 16) * (event.key === previous ? -1 : 1) * direction
    const resized = clamp(value + delta)
    onResize(resized)
    onCommit(resized)
  }

  return <div className={`layout-resizer ${className}`} role="separator" aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} title="拖动调整大小，双击恢复默认" onDoubleClick={onReset} onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}><span /></div>
})
