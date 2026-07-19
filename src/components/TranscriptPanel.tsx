import { AlertTriangle, Bot, Check, ChevronDown, Copy, Download, PanelLeftOpen, Search, TextCursorInput } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Language, TranscriptResult } from '../../electron/types'
import { formatDuration } from '../utils'

interface TranscriptPanelProps {
  result?: TranscriptResult
  language: Language
  onLanguage(language: Language): void
  onChange(result: TranscriptResult): void
  onExport(result: TranscriptResult): void
  chatOpen: boolean
  onOpenChat(): void
  onRestoreWorkspace(): void
}

function resizeTextarea(textarea: HTMLTextAreaElement): void {
  const scrollHeight = textarea.scrollHeight
  textarea.style.height = '0px'
  if (scrollHeight > 0) textarea.style.height = `${scrollHeight}px`
}

function AutoResizeTextarea({ value, onValueChange }: { value: string; onValueChange(value: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (ref.current) resizeTextarea(ref.current)
  }, [value])

  useEffect(() => {
    const textarea = ref.current
    const container = textarea?.parentElement
    if (!textarea || !container || typeof ResizeObserver === 'undefined') return
    let active = true
    let lastWidth = container.getBoundingClientRect().width
    let frame = 0
    const scheduleResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (active) resizeTextarea(textarea)
      })
    }
    scheduleResize()
    void document.fonts?.ready.then(scheduleResize)
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width
      if (Math.abs(nextWidth - lastWidth) < 0.5) return
      lastWidth = nextWidth
      scheduleResize()
    })
    observer.observe(container)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <textarea ref={ref} value={value} rows={1} onChange={(event) => onValueChange(event.target.value)} />
}

function transcriptText(segments: TranscriptResult['segments']): string {
  return segments.map((segment) => segment.status === 'failed'
    ? `[${formatDuration(segment.start)}${segment.end === undefined ? '' : `–${formatDuration(segment.end)}`} 转写失败：${segment.error || '未知错误'}]`
    : segment.text).join('\n\n')
}

export const TranscriptPanel = memo(function TranscriptPanel({ result, language, onLanguage, onChange, onExport, chatOpen, onOpenChat, onRestoreWorkspace }: TranscriptPanelProps) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const wordCount = useMemo(() => result?.segments
    .filter((segment) => segment.status !== 'failed')
    .reduce((total, segment) => total + segment.text.replace(/\s/g, '').length, 0) || 0, [result?.segments])
  const failedSegmentCount = result
    ? result.failedSegmentCount ?? result.segments.filter((segment) => segment.status === 'failed').length
    : 0

  async function copyText() {
    if (!result) return
    if (window.tingxie) {
      await window.tingxie.copyText(result.text)
    } else {
      try {
        await navigator.clipboard.writeText(result.text)
      } catch {
        const helper = document.createElement('textarea')
        helper.value = result.text
        helper.style.position = 'fixed'
        helper.style.opacity = '0'
        document.body.appendChild(helper)
        helper.select()
        document.execCommand('copy')
        helper.remove()
      }
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <aside className="transcript-panel">
      <div className="result-header">
        <div className="result-title-row">
          <h2>转写结果</h2>
          <div className="result-title-actions">{result && (chatOpen
            ? <button className="panel-mode-button" onClick={onRestoreWorkspace}><PanelLeftOpen size={15} />新增转写</button>
            : <button className="panel-mode-button primary" onClick={onOpenChat}><Bot size={15} />AI 对话</button>)}<label className="language-select">
            <span>语言</span>
            <select value={language} onChange={(event) => onLanguage(event.target.value as Language)}>
              <option value="auto">自动检测</option><option value="zh">中文</option><option value="en">英文</option>
            </select>
            <ChevronDown size={14} />
          </label></div>
        </div>
        {result ? (
          <>
            <div className="result-file-row">
              <strong title={result.fileName}>{result.fileName}</strong>
              <div className="result-actions">
                <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索转写内容" /></label>
                <button onClick={copyText}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制' : '复制'}</button>
                <button onClick={() => onExport(result)}><Download size={16} />导出</button>
              </div>
            </div>
            {failedSegmentCount > 0 && <div className="transcript-warning" role="status"><AlertTriangle size={16} /><span><strong>部分内容未能识别</strong>共有 {failedSegmentCount} 个音频片段在重试后仍失败，已按原时间位置标记。</span></div>}
            <div className="transcript-body">
              {result.segments.length > 1 || result.segments.some((segment) => segment.status === 'failed') ? result.segments.map((segment, index) => (
                <div className="segment" key={`${segment.start}-${index}`}>
                  <time>{formatDuration(segment.start)}{segment.end === undefined ? '' : `–${formatDuration(segment.end)}`}</time>
                  {segment.status === 'failed' ? <div className="failed-segment"><AlertTriangle size={18} /><div><strong>此片段转写失败</strong><p>{segment.error || '未知错误'} · 已尝试 {segment.attempts || 1} 次</p></div></div> : <AutoResizeTextarea
                    value={segment.text}
                    onValueChange={(value) => {
                      const segments = result.segments.map((item, itemIndex) => itemIndex === index ? { ...item, text: value } : item)
                      onChange({ ...result, segments, text: transcriptText(segments) })
                    }}
                  />}
                </div>
              )) : (
                <textarea
                  className="single-transcript"
                  value={result.text}
                  onChange={(event) => onChange({ ...result, text: event.target.value, segments: [{ start: 0, text: event.target.value }] })}
                />
              )}
            </div>
            <footer className="editor-footer"><span><TextCursorInput size={15} />可直接编辑转写内容</span><span>{wordCount} 字</span></footer>
          </>
        ) : (
          <div className="empty-result">
            <div className="empty-result-icon"><TextCursorInput size={28} /></div>
            <h3>转写结果会显示在这里</h3>
            <p>添加文件并完成识别后，可在这里编辑、复制或导出文本。</p>
          </div>
        )}
      </div>
    </aside>
  )
})
