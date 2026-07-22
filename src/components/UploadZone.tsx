import { FolderOpen, Upload } from 'lucide-react'
import { m } from 'motion/react'
import { memo, useEffect, useRef, useState, type DragEvent } from 'react'
import { motionSpring } from '../motion/tokens'

interface UploadZoneProps {
  onSelect(): void
  onDrop(files: File[]): void
}

export const UploadZone = memo(function UploadZone({ onSelect, onDrop }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [dropped, setDropped] = useState(false)
  const feedbackTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), [])

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    setDropped(true)
    window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => setDropped(false), 520)
    onDrop(Array.from(event.dataTransfer.files))
  }

  return (
    <m.div
      className={`upload-zone${dragging ? ' dragging' : ''}${dropped ? ' dropped' : ''}`}
      animate={dropped ? { scale: [1, 0.988, 1.006, 1] } : { scale: dragging ? 0.996 : 1 }}
      transition={dropped ? { duration: 0.36, times: [0, 0.35, 0.7, 1] } : motionSpring.snappy}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <m.div className="upload-visual" aria-hidden="true" animate={{ y: dragging ? -4 : 0 }} transition={motionSpring.snappy}>
        <span className="wave left"><i /><i /><i /><i /><i /></span>
        <Upload size={42} strokeWidth={1.8} />
        <span className="wave right"><i /><i /><i /><i /><i /></span>
      </m.div>
      <h2>把音视频拖到这里</h2>
      <p>支持 MP3、WAV、MP4、MOV、MKV，单次可添加多个文件</p>
      <button className="primary-button" onClick={onSelect}><FolderOpen size={18} />选择文件</button>
    </m.div>
  )
})
