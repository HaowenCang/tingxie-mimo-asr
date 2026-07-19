import { FolderOpen, Upload } from 'lucide-react'
import { memo, useState, type DragEvent } from 'react'

interface UploadZoneProps {
  onSelect(): void
  onDrop(files: File[]): void
}

export const UploadZone = memo(function UploadZone({ onSelect, onDrop }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    onDrop(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className={`upload-zone${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="upload-visual" aria-hidden="true">
        <span className="wave left"><i /><i /><i /><i /><i /></span>
        <Upload size={42} strokeWidth={1.8} />
        <span className="wave right"><i /><i /><i /><i /><i /></span>
      </div>
      <h2>把音视频拖到这里</h2>
      <p>支持 MP3、WAV、MP4、MOV、MKV，单次可添加多个文件</p>
      <button className="primary-button" onClick={onSelect}><FolderOpen size={18} />选择文件</button>
    </div>
  )
})
