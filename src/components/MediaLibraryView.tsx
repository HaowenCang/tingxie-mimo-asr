import { CheckSquare, FileAudio, FileClock, FilePlus2, FileText, Folder, FolderInput, FolderPlus, Library, Search, Square, Trash2, Upload, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import type { MediaAsset, MediaImportProgress, MediaLibrarySnapshot, TranscriptSummary } from '../../electron/types'
import { formatBytes, formatDuration } from '../utils'
import { buildMediaLibraryIndex, filterMediaLibraryRows, type MediaLibraryRow, type MediaLibraryScope } from './media-library-model'

interface MediaLibraryViewProps {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  importProgress?: MediaImportProgress
  onLibraryChange(library: MediaLibrarySnapshot): void
  onOpenTranscript(result: TranscriptSummary): void
  onTranscribe(asset: MediaAsset): void
  onImportFiles(folderId?: string): void
  onImportFolder(folderId?: string): void
  onRecoverHistoryMedia?(result: TranscriptSummary): Promise<void>
}

function statusLabel(asset: MediaAsset): string {
  if (asset.transcriptStatus === 'transcribed') return '已转写'
  if (asset.transcriptStatus === 'partial') return '部分完成'
  if (asset.transcriptStatus === 'failed') return '转写失败'
  return '未转写'
}

export const MediaLibraryView = memo(function MediaLibraryView({ library, history, importProgress, onLibraryChange, onOpenTranscript, onTranscribe, onImportFiles, onImportFolder, onRecoverHistoryMedia }: MediaLibraryViewProps) {
  const [scope, setScope] = useState<MediaLibraryScope>('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | MediaAsset['transcriptStatus']>('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [newFolderName, setNewFolderName] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const derived = useMemo(() => buildMediaLibraryIndex(library, history), [library, history])
  const rows = useMemo(() => filterMediaLibraryRows(derived, scope, status, deferredQuery), [derived, scope, status, deferredQuery])
  const visibleAssetIds = useMemo(() => rows.flatMap((row) => row.kind === 'asset' ? [row.id] : []), [rows])
  const focusedId = useMemo(() => [...selected].at(-1), [selected])
  const focused = focusedId ? derived.assetById.get(focusedId) : undefined
  const focusedTranscript = focused?.transcriptId ? derived.transcriptById.get(focused.transcriptId) : undefined
  const allVisibleSelected = visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selected.has(id))
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableScrollRef.current,
    getItemKey: (index) => `${rows[index]?.kind}-${rows[index]?.id}`,
    estimateSize: () => 61,
    overscan: 8,
    initialRect: { width: 900, height: 640 },
  })

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name || !window.tingxie) return
    onLibraryChange(await window.tingxie.createMediaFolder(name))
    setNewFolderName('')
  }

  async function move(folderId?: string) {
    if (!selected.size || !window.tingxie) return
    onLibraryChange(await window.tingxie.moveMediaAssets([...selected], folderId))
  }

  async function removeSelected() {
    if (!selected.size || !window.tingxie || !window.confirm(`确定从媒体库永久删除选中的 ${selected.size} 个文件吗？`)) return
    onLibraryChange(await window.tingxie.deleteMediaAssets([...selected]))
    setSelected(new Set())
  }

  async function renameFocused(name: string) {
    if (!focused || !window.tingxie || name.trim() === focused.displayName) return
    onLibraryChange(await window.tingxie.renameMediaAsset(focused.id, name))
  }

  async function recoverHistoryMedia(item: TranscriptSummary) {
    if (!onRecoverHistoryMedia) return
    setRecoveryMessage('')
    try {
      await onRecoverHistoryMedia(item)
      setRecoveryMessage(`“${item.fileName}”的音频已迁入媒体库`)
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : '历史音频迁移失败')
    }
  }

  return (
    <main className="library-page">
      <header className="library-header">
        <div><h1>媒体库</h1><p>录音由应用安全保管，可按文件夹整理并批量操作</p></div>
        <div className="library-header-actions">
          <button className="soft-button" onClick={() => onImportFolder(scope === 'all' || scope === 'unfiled' ? undefined : scope)}><FolderInput size={17} />导入文件夹</button>
          <button className="primary-button" onClick={() => onImportFiles(scope === 'all' || scope === 'unfiled' ? undefined : scope)}><Upload size={17} />导入音视频</button>
        </div>
      </header>

      <section className="library-shell glass-card">
        <aside className="folder-rail">
          <div className="folder-rail-title"><Library size={17} />分组</div>
          <button className={scope === 'all' ? 'folder-row active' : 'folder-row'} onClick={() => setScope('all')}><Library size={16} /><span>全部文件</span><b>{library.assets.length + derived.unlinkedHistory.length}</b></button>
          <button className={scope === 'history' ? 'folder-row active' : 'folder-row'} onClick={() => { setScope('history'); setSelected(new Set()) }}><FileClock size={16} /><span>历史转写</span><b>{history.length}</b></button>
          <button className={scope === 'unfiled' ? 'folder-row active' : 'folder-row'} onClick={() => setScope('unfiled')}><Folder size={16} /><span>未分组</span><b>{derived.unfiledCount}</b></button>
          {library.folders.map((folder) => <button key={folder.id} className={scope === folder.id ? 'folder-row active' : 'folder-row'} onClick={() => setScope(folder.id)}><Folder size={16} /><span>{folder.name}</span><b>{derived.folderCounts.get(folder.id) || 0}</b></button>)}
          <div className="new-folder-row">
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder="新文件夹" aria-label="新文件夹名称" />
            <button onClick={() => void createFolder()} aria-label="创建文件夹"><FolderPlus size={16} /></button>
          </div>
          <div className="library-location"><span>存储位置</span><code title={library.rootPath}>{library.rootPath}</code></div>
        </aside>

        <div className="library-list-pane">
          <div className="library-toolbar">
            <label className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或格式" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={14} /></button>}</label>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="转写状态筛选">
              <option value="all">全部状态</option><option value="untranscribed">未转写</option><option value="transcribed">已转写</option><option value="partial">部分完成</option><option value="failed">失败</option>
            </select>
          </div>
          {importProgress && <div className="library-import-progress" role="status" aria-live="polite">
            <span>{importProgress.detail}</span>
            <progress max={Math.max(1, importProgress.total)} value={importProgress.total ? importProgress.completed : undefined} />
          </div>}
          {recoveryMessage && <div className="library-recovery-message" role="status">{recoveryMessage}</div>}
          {selected.size > 0 && <div className="batch-bar">
            <span><CheckSquare size={16} />已选择 {selected.size} 项</span>
            <label><FolderInput size={15} /><select defaultValue="" onChange={(event) => { void move(event.target.value === '__root' ? undefined : event.target.value); event.target.value = '' }}><option value="" disabled>移动到…</option><option value="__root">未分组</option>{library.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <button className="danger-button" onClick={() => void removeSelected()}><Trash2 size={15} />删除</button>
            <button onClick={() => setSelected(new Set())}>取消</button>
          </div>}
          <div className="library-table" role="table" aria-label="媒体文件">
            <div className="library-table-head" role="row">
              <button onClick={() => setSelected((current) => {
                const next = new Set(current)
                for (const id of visibleAssetIds) {
                  if (allVisibleSelected) next.delete(id)
                  else next.add(id)
                }
                return next
              })} aria-label="全选可见文件">{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>
              <span>名称</span><span>时长</span><span>大小</span><span>状态</span><span>导入时间</span>
            </div>
            <div ref={tableScrollRef} className="library-table-scroll" data-virtualized="true">
              {rows.length ? <div className="library-virtual-rows" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row: MediaLibraryRow = rows[virtualRow.index]
                  return <div key={`${row.kind}-${row.id}`} className="library-virtual-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
                    {row.kind === 'asset' ? <div className={`library-table-row${selected.has(row.id) ? ' selected' : ''}`} role="row" onClick={() => toggle(row.id)}>
                      <button aria-label={`选择 ${row.asset.displayName}`}>{selected.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                      <div className="library-file-name"><span><FileAudio size={18} /></span><div><strong>{row.asset.displayName}</strong><small>{row.asset.extension}</small></div></div>
                      <span>{formatDuration(row.asset.duration || 0)}</span><span>{formatBytes(row.asset.size)}</span><span><i className={`asset-status ${row.asset.transcriptStatus}`}>{statusLabel(row.asset)}</i></span><span>{new Date(row.asset.importedAt).toLocaleDateString()}</span>
                    </div> : <div className="library-table-row legacy-transcript-row" role="row">
                      <button aria-label={`打开转写：${row.transcript.fileName}`} title="打开转写" onClick={() => onOpenTranscript(row.transcript)}><FileText size={16} /></button>
                      <div className="library-file-name"><span><FileText size={18} /></span><div><strong>{row.transcript.fileName}</strong><small>历史转写 · 文字已恢复</small>{row.transcript.sourceAvailable && !derived.linkedTranscriptIds.has(row.id) && onRecoverHistoryMedia ? <button className="legacy-recover-button" onClick={() => void recoverHistoryMedia(row.transcript)}>迁入原音频</button> : null}</div></div>
                      <span>{formatDuration(row.transcript.duration || 0)}</span><span>{row.transcript.segmentCount} 段</span><span><i className={`asset-status ${row.transcript.outcome === 'failed' ? 'failed' : row.transcript.outcome === 'partial' ? 'partial' : 'transcribed'}`}>{row.transcript.outcome === 'failed' ? '失败记录' : row.transcript.outcome === 'partial' ? '部分完成' : '文字完整'}</i></span><span>{new Date(row.transcript.createdAt).toLocaleDateString()}</span>
                    </div>}
                  </div>
                })}
              </div> : <div className="library-empty"><FilePlus2 size={30} /><strong>{deferredQuery ? '没有匹配的媒体或转写' : scope === 'history' ? '还没有历史转写' : '此分组还没有文件'}</strong><span>{deferredQuery ? '尝试更换关键词或状态筛选' : scope === 'history' ? '旧版本转写记录会安全显示在这里' : '导入过往录音，或从“新建转写”添加文件'}</span></div>}
            </div>
          </div>
        </div>

        <aside className="library-inspector">
          {focused ? <>
            <div className="inspector-art"><FileAudio size={34} /></div>
            <label>显示名称<input defaultValue={focused.displayName} key={focused.id} onBlur={(event) => void renameFocused(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
            <dl><div><dt>格式</dt><dd>{focused.extension}</dd></div><div><dt>时长</dt><dd>{formatDuration(focused.duration || 0)}</dd></div><div><dt>大小</dt><dd>{formatBytes(focused.size)}</dd></div><div><dt>状态</dt><dd>{statusLabel(focused)}</dd></div></dl>
            {focusedTranscript
              ? <button className="primary-button" onClick={() => onOpenTranscript(focusedTranscript)}>打开转写</button>
              : <button className="primary-button" onClick={() => onTranscribe(focused)}>开始转写</button>}
          </> : <div className="inspector-empty">{scope === 'history' ? <FileClock size={30} /> : <FileAudio size={30} />}<strong>{scope === 'history' ? '历史转写已恢复' : '选择一个文件'}</strong><span>{scope === 'history' ? '点击每条记录左侧的文档图标即可打开完整文字' : '查看详情、重命名或打开转写'}</span></div>}
        </aside>
      </section>
    </main>
  )
})
