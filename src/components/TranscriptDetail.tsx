import { AlertTriangle, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Copy, Download, FileText, LoaderCircle, Search, Sparkles, WandSparkles, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppPreferences, TranscriptAnalysis, TranscriptChapter, TranscriptResult } from '../../electron/types'
import { formatDuration } from '../utils'
import { AudioPlayer } from './AudioPlayer'
import { EditableTranscriptSegment } from './EditableTranscriptSegment'
import { findActiveTranscriptSegment } from './playback-timeline'
import { findTranscriptMatches, updateTranscriptSearchIndex, type TranscriptMatch, type TranscriptSearchIndex } from './searchTranscript'

const MAX_VISIBLE_SEARCH_RESULTS = 100

interface TranscriptDetailProps {
  result: TranscriptResult
  preferences: AppPreferences
  onChange(result: TranscriptResult, persist?: boolean): void
  onPatchSegment?(transcriptId: string, segmentId: string, patch: Partial<TranscriptResult['segments'][number]>): void
  onGenerateAnalysis(): Promise<void>
  onExport(): void
  onOpenChat(): void
  onNewTranscript(): void
  analysisBusy: boolean
  analysisError: string
}

function transcriptText(segments: TranscriptResult['segments']): string {
  return segments.map((segment) => segment.status === 'failed'
    ? `[${formatDuration(segment.start)}–${formatDuration(segment.end || segment.start)} 转写失败：${segment.error || '未知错误'}]`
    : segment.text).join('\n\n')
}

function AnalysisView({ analysis, tab, onChapterSelect }: { analysis: TranscriptAnalysis; tab: 'chapters' | 'speech' | 'points'; onChapterSelect(chapter: TranscriptChapter, index: number): void }) {
  if (tab === 'chapters') return <div className="analysis-list">{analysis.chapters.map((chapter, index) => <button className="analysis-chapter-button" key={chapter.id} aria-label={`跳转到原文：${chapter.title}`} onClick={() => onChapterSelect(chapter, index)}><strong>≈ {chapter.title}</strong><p>{chapter.summary}</p></button>)}</div>
  const values = tab === 'speech' ? analysis.speechSummary : analysis.keyPoints
  return <div className="analysis-list">{values.map((value, index) => <article className="analysis-insight-card" key={`${value}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{value}</p></article>)}</div>
}

function MarkedExcerpt({ match }: { match: TranscriptMatch }) {
  const start = match.excerptMatchStart
  return <>{match.excerpt.slice(0, start)}<mark>{match.excerpt.slice(start, start + match.length)}</mark>{match.excerpt.slice(start + match.length)}</>
}

export const TranscriptDetail = memo(function TranscriptDetail({ result, preferences, onChange, onPatchSegment, onGenerateAnalysis, onExport, onOpenChat, onNewTranscript, analysisBusy, analysisError }: TranscriptDetailProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [activeMatch, setActiveMatch] = useState(0)
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [tab, setTab] = useState<'chapters' | 'speech' | 'points'>('chapters')
  const [activeSegment, setActiveSegment] = useState(-1)
  const [seekTo, setSeekTo] = useState<{ time: number; nonce: number }>()
  const [copied, setCopied] = useState(false)
  const [jumpedSegment, setJumpedSegment] = useState<number>()
  const [timelineOffset, setTimelineOffset] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const playbackTimeRef = useRef(0)
  const jumpHighlightTimer = useRef<number | undefined>(undefined)
  const searchIndexRef = useRef<TranscriptSearchIndex | undefined>(undefined)
  const chapterBySegment = useMemo(() => new Map(result.analysis?.chapters.map((chapter) => [chapter.startSegmentId, chapter]) || []), [result.analysis])
  const searchIndex = useMemo(() => {
    const next = updateTranscriptSearchIndex(searchIndexRef.current, result.segments)
    searchIndexRef.current = next
    return next
  }, [result.segments])
  const searchMatches = useMemo(() => findTranscriptMatches(result.segments, deferredQuery, searchIndex), [result.segments, deferredQuery, searchIndex])
  const visibleSearchMatches = searchMatches.slice(0, MAX_VISIBLE_SEARCH_RESULTS)
  const matchingSegmentIndexes = useMemo(() => new Set(searchMatches.map((match) => match.segmentIndex)), [searchMatches])
  const rowVirtualizer = useVirtualizer({
    count: result.segments.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => result.segments[index]?.id || `segment-${index}`,
    estimateSize: () => 126,
    overscan: 7,
    scrollMargin: timelineOffset,
    initialRect: { width: 900, height: 720 },
  })

  const handlePlaybackProgress = useCallback((time: number) => {
    playbackTimeRef.current = time
    const next = findActiveTranscriptSegment(result.segments, result.duration, time)
    setActiveSegment((current) => current === next ? current : next)
  }, [result.segments, result.duration])

  useEffect(() => setActiveMatch(0), [deferredQuery])

  useEffect(() => {
    playbackTimeRef.current = 0
    setActiveSegment(-1)
  }, [result.id])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const timeline = timelineRef.current
    if (!scroll || !timeline || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const next = timeline.offsetTop
      setTimelineOffset((current) => current === next ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    for (const child of scroll.children) observer.observe(child)
    return () => observer.disconnect()
  }, [overviewOpen, deferredQuery, result.analysis, analysisError])

  useEffect(() => {
    if (!preferences.autoFollow || activeSegment < 0 || playbackTimeRef.current <= 0.05) return
    rowVirtualizer.scrollToIndex(activeSegment, { align: 'center' })
  }, [activeSegment, preferences.autoFollow, rowVirtualizer])

  useEffect(() => () => window.clearTimeout(jumpHighlightTimer.current), [])

  async function copy() {
    if (window.tingxie) await window.tingxie.copyText(result.text)
    else await navigator.clipboard.writeText(result.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  function seek(time: number) {
    setSeekTo({ time, nonce: Date.now() })
  }

  function jumpToSegment(index: number) {
    const segment = result.segments[index]
    if (!segment) return
    seek(segment.manualStart ?? segment.start)
    setJumpedSegment(index)
    rowVirtualizer.scrollToIndex(index, { align: 'center' })
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-segment-index="${index}"]`)?.focus({ preventScroll: true }))
    window.clearTimeout(jumpHighlightTimer.current)
    jumpHighlightTimer.current = window.setTimeout(() => setJumpedSegment(undefined), 1600)
  }

  function chapterSegmentIndex(chapter: TranscriptChapter, chapterIndex: number) {
    const exactIndex = result.segments.findIndex((segment, index) => (segment.id || `segment-${index}`) === chapter.startSegmentId)
    if (exactIndex >= 0) return exactIndex
    const suffix = chapter.startSegmentId.match(/(\d+)$/)?.[1]
    if (suffix !== undefined) return Math.min(result.segments.length - 1, Number(suffix))
    const chapters = result.analysis?.chapters.length || 1
    return Math.min(result.segments.length - 1, Math.round(chapterIndex / Math.max(1, chapters - 1) * Math.max(0, result.segments.length - 1)))
  }

  function jumpToChapter(chapter: TranscriptChapter, chapterIndex: number) {
    jumpToSegment(chapterSegmentIndex(chapter, chapterIndex))
  }

  function jumpToMatch(index: number) {
    if (!searchMatches.length) return
    const normalized = (index + searchMatches.length) % searchMatches.length
    setActiveMatch(normalized)
    jumpToSegment(searchMatches[normalized].segmentIndex)
  }

  const updateSegment = useCallback((index: number, patch: Partial<TranscriptResult['segments'][number]>, persist = true) => {
    const segments = result.segments.map((segment, segmentIndex) => segmentIndex === index ? { ...segment, ...patch } : segment)
    onChange({ ...result, revision: (result.revision ?? 0) + 1, segments, text: transcriptText(segments) }, persist)
  }, [result, onChange])

  const commitSegmentText = useCallback((index: number, text: string) => {
    const segment = result.segments[index]
    if (!segment) return
    updateSegment(index, { text }, !onPatchSegment)
    onPatchSegment?.(result.id, segment.id || `segment-${index}`, { text })
  }, [result.id, result.segments, onPatchSegment, updateSegment])

  return <main className="transcript-detail">
    <header className="detail-header glass-section">
      <div><span className="detail-file-icon"><FileText size={19} /></span><span><h1>{result.fileName}</h1><p>{formatDuration(result.duration)} · {result.segments.filter((segment) => segment.status !== 'failed').length} 个段落 · 时间为切片内近似估算</p></span></div>
      <div className="detail-actions"><label className="detail-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文" />{query && <><span>{searchMatches.length ? `${activeMatch + 1}/${searchMatches.length}` : '0 项'}</span><button aria-label="清除搜索" onClick={() => setQuery('')}><X size={13} /></button></>}</label><button onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制'}</button><button onClick={onExport}><Download size={15} />导出</button><button className="detail-ai-button" onClick={onOpenChat}><Bot size={16} />AI 对话</button><button onClick={onNewTranscript}>新增转写</button></div>
    </header>

    <div className="detail-scroll" ref={scrollRef}>
      <section className="smart-overview glass-section">
        <header><div><span><Sparkles size={17} /></span><div><h2>智能速览</h2><p>由已保存的对话 API 基于当前原文生成</p></div></div><div>{result.analysis && <button className="icon-button" aria-label={overviewOpen ? '收起智能速览' : '展开智能速览'} onClick={() => setOverviewOpen((value) => !value)}>{overviewOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}<button className="primary-button compact" disabled={analysisBusy} onClick={onGenerateAnalysis}>{analysisBusy ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />}{result.analysis ? '重新生成' : '生成智能速览'}</button></div></header>
        {analysisError ? <div className="analysis-error" role="alert" aria-live="polite"><AlertTriangle size={17} /><div><strong>智能速览生成失败</strong><p>{analysisError}</p></div><button disabled={analysisBusy} onClick={onGenerateAnalysis}>重试</button></div> : null}
        {overviewOpen && (result.analysis ? <>
          <div className="keyword-row">{result.analysis.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
          <div className="overview-copy"><strong>全文概要</strong><p>{result.analysis.overview}</p></div>
          <div className="analysis-tabs"><button className={tab === 'chapters' ? 'active' : ''} onClick={() => setTab('chapters')}>章节速览</button><button className={tab === 'speech' ? 'active' : ''} onClick={() => setTab('speech')}>发言总结</button><button className={tab === 'points' ? 'active' : ''} onClick={() => setTab('points')}>要点回顾</button></div>
          <AnalysisView analysis={result.analysis} tab={tab} onChapterSelect={jumpToChapter} />
        </> : analysisError ? null : <div className="overview-empty"><p>生成关键词、全文概要、章节、内容脉络、要点与行动项。当前版本不会推断或展示说话人身份。</p></div>)}
      </section>

      <section className="original-section">
        <header><div><FileText size={18} /><h2>原文</h2></div><span>点击 ≈ 时间可播放核对 · 可直接编辑</span></header>
        {query.trim() && <aside className={`transcript-search-results${searchMatches.length ? '' : ' empty'}`} aria-live="polite">
          <div className="search-results-heading"><div><Search size={16} /><strong>{searchMatches.length ? `找到 ${searchMatches.length} 处结果` : '没有找到匹配内容'}</strong></div>{searchMatches.length > 0 && <span><button aria-label="上一个结果" onClick={() => jumpToMatch(activeMatch - 1)}><ChevronLeft size={15} /></button><button aria-label="下一个结果" onClick={() => jumpToMatch(activeMatch + 1)}><ChevronRight size={15} /></button></span>}</div>
          {searchMatches.length ? <><div className="search-result-list">{visibleSearchMatches.map((match, index) => <button key={match.id} className={activeMatch === index ? 'active' : ''} onClick={() => jumpToMatch(index)}><time>≈ {formatDuration(result.segments[match.segmentIndex].start)}</time><span><MarkedExcerpt match={match} /></span></button>)}</div>{searchMatches.length > MAX_VISIBLE_SEARCH_RESULTS && <p className="search-result-limit">结果较多，列表仅显示前 {MAX_VISIBLE_SEARCH_RESULTS} 项；可继续使用上一项/下一项浏览全部结果。</p>}</> : <p>请检查关键词，或尝试更短、更常见的词语。</p>}
        </aside>}
        {result.failedSegmentCount ? <div className="transcript-warning"><AlertTriangle size={16} />{result.failedSegmentCount} 个切片重试后仍失败，已保留原时间缺口。</div> : null}
        <div ref={timelineRef} className="timeline" data-virtualized="true" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index
            const segment = result.segments[index]
            const id = segment.id || `segment-${index}`
            const chapter = chapterBySegment.get(id)
            const matches = matchingSegmentIndexes.has(index)
            return <div key={id} data-index={index} ref={rowVirtualizer.measureElement} className="virtual-timeline-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start - timelineOffset}px)` }}>
              {chapter && <button className="inline-chapter-card" onClick={() => jumpToSegment(index)}><span>章节速览 · ≈ {formatDuration(segment.start)}</span><strong>{chapter.title}</strong><p>{chapter.summary}</p></button>}
              <article data-segment-id={id} data-segment-index={index} tabIndex={-1} className={`timeline-segment ${activeSegment === index ? 'active' : ''} ${jumpedSegment === index ? 'chapter-jump-target' : ''} ${matches ? 'match' : ''} ${segment.status === 'failed' ? 'failed' : ''}`}>
                <div className="timeline-time"><button onClick={() => seek(segment.manualStart ?? segment.start)}>≈ {formatDuration(segment.manualStart ?? segment.start)}</button><i /><button className="calibrate-button" title="用当前播放位置校正本段起点" onClick={() => updateSegment(index, { start: playbackTimeRef.current, manualStart: playbackTimeRef.current, estimated: false })}><Clock3 size={12} /></button></div>
                {segment.status === 'failed' ? <div className="failed-segment"><AlertTriangle size={17} /><div><strong>此片段转写失败</strong><p>{segment.error || '未知错误'} · 真实错误尝试 {segment.attempts || 1} 次{segment.rateLimitWaits ? ` · 限流等待 ${segment.rateLimitWaits} 次（不计入重试）` : ''} · {formatDuration(segment.start)}–{formatDuration(segment.end || segment.start)}</p></div></div> : <EditableTranscriptSegment index={index} text={segment.text} onCommit={commitSegmentText} />}
              </article>
            </div>
          })}
        </div>
      </section>
    </div>
    <AudioPlayer transcript={result} preferences={preferences} seekTo={seekTo} onTimeChange={handlePlaybackProgress} />
  </main>
})
