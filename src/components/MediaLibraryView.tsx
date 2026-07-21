import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckSquare, ChevronDown, ChevronRight, FileAudio, FileClock, FilePlus2, FileText, Folder, FolderInput, FolderPlus, Library, Move, Pencil, Search, Square, Trash2, Upload, X } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import type { MediaAsset, MediaFolder, MediaImportProgress, MediaLibrarySnapshot, TranscriptSummary } from '../../electron/types'
import { formatBytes, formatDuration } from '../utils'
import { GlassSelect } from './GlassSelect'
import { buildMediaLibraryIndex, filterMediaLibraryRows, folderIdFromScope, visibleMediaFolderTree, type MediaLibraryRow, type MediaLibraryScope } from './media-library-model'
import { normalizeRecordingName } from './recording-name'

interface MediaLibraryViewProps {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  importProgress?: MediaImportProgress
  onLibraryChange(library: MediaLibrarySnapshot): void
  onHistoryChange?(history: TranscriptSummary[]): void
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

function folderDescendants(folders: MediaFolder[], folderId: string): Set<string> {
  const descendants = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (!descendants.has(folder.id) && (folder.parentId === folderId || (folder.parentId && descendants.has(folder.parentId)))) {
        descendants.add(folder.id)
        changed = true
      }
    }
  }
  return descendants
}

function AutoGrowNameEditor({ value, onChange, onSave, onCancel }: { value: string; onChange(value: string): void; onSave(): void; onCancel(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave()
    }
  }
  return <textarea ref={ref} rows={1} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} aria-label="显示名称" />
}

export const MediaLibraryView = memo(function MediaLibraryView({ library, history, importProgress, onLibraryChange, onHistoryChange, onOpenTranscript, onTranscribe, onImportFiles, onImportFolder, onRecoverHistoryMedia }: MediaLibraryViewProps) {
  const [scope, setScope] = useState<MediaLibraryScope>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | MediaAsset['transcriptStatus']>('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(library.folders.map((folder) => folder.id)))
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingChildFor, setCreatingChildFor] = useState<string>()
  const [movingFolderId, setMovingFolderId] = useState<string>()
  const [childFolderName, setChildFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string>()
  const [folderDraft, setFolderDraft] = useState('')
  const [deleteFolderId, setDeleteFolderId] = useState<string>()
  const [renameDraft, setRenameDraft] = useState('')
  const [focusedRowKey, setFocusedRowKey] = useState<string>()
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [error, setError] = useState('')
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const derived = useMemo(() => buildMediaLibraryIndex(library, history), [library, history])
  const folderTree = useMemo(() => visibleMediaFolderTree(library.folders, expandedFolders), [library.folders, expandedFolders])
  const folderOptions = useMemo(() => [{ value: '__root', label: '根目录（未分组）' }, ...visibleMediaFolderTree(library.folders, new Set(library.folders.map((folder) => folder.id))).map((node) => ({ value: node.folder.id, label: `${'　'.repeat(node.depth)}${node.path}` }))], [library.folders])
  const scopedFolderId = folderIdFromScope(scope, library.folders)
  const rows = useMemo(() => filterMediaLibraryRows(derived, scope, status, deferredQuery), [derived, scope, status, deferredQuery])
  const visibleAssetIds = useMemo(() => rows.flatMap((row) => row.kind === 'asset' ? [row.id] : []), [rows])
  const focusedAssetId = focusedRowKey?.startsWith('asset:') ? focusedRowKey.slice(6) : undefined
  const focusedTranscriptId = focusedRowKey?.startsWith('transcript:') ? focusedRowKey.slice(11) : undefined
  const focused = focusedAssetId ? derived.assetById.get(focusedAssetId) : undefined
  const focusedTranscript = focused?.transcriptId ? derived.transcriptById.get(focused.transcriptId) : undefined
  const focusedHistory = focusedTranscriptId ? derived.transcriptById.get(focusedTranscriptId) : undefined
  const allVisibleSelected = visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selected.has(id))
  const deleteFolder = deleteFolderId ? library.folders.find((folder) => folder.id === deleteFolderId) : undefined
  const deleteDescendants = useMemo(() => deleteFolderId ? folderDescendants(library.folders, deleteFolderId) : new Set<string>(), [deleteFolderId, library.folders])
  const deleteAssetCount = useMemo(() => deleteFolderId ? library.assets.filter((asset) => asset.folderId === deleteFolderId || (asset.folderId && deleteDescendants.has(asset.folderId))).length : 0, [deleteFolderId, deleteDescendants, library.assets])
  const rowVirtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => tableScrollRef.current, getItemKey: (index) => `${rows[index]?.kind}-${rows[index]?.id}`, estimateSize: () => 61, overscan: 8, initialRect: { width: 900, height: 640 } })

  useEffect(() => { setRenameDraft(focused?.displayName || focusedHistory?.fileName || '') }, [focused?.id, focused?.displayName, focusedHistory?.id, focusedHistory?.fileName])

  const toggle = useCallback((id: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])

  async function run(operation: () => Promise<MediaLibrarySnapshot>): Promise<boolean> {
    setError('')
    try { onLibraryChange(await operation()); return true } catch (reason) { setError(reason instanceof Error ? reason.message : '媒体库操作失败'); return false }
  }

  async function createFolder(nameInput: string, parentId?: string) {
    const name = nameInput.trim()
    if (!name || !window.tingxie) return
    const created = await run(() => window.tingxie!.createMediaFolder(name, parentId))
    if (!created) return
    if (parentId) {
      setChildFolderName('')
      setCreatingChildFor(undefined)
      setExpandedFolders((current) => new Set(current).add(parentId))
    } else setNewFolderName('')
  }

  async function renameFolder(folder: MediaFolder) {
    const name = folderDraft.trim()
    if (!name || !window.tingxie) return
    if (await run(() => window.tingxie!.renameMediaFolder(folder.id, name))) setEditingFolderId(undefined)
  }

  async function moveAssets(folderId?: string, ids = [...selected]) {
    if (!ids.length || !window.tingxie) return
    await run(() => window.tingxie!.moveMediaAssets(ids, folderId))
  }

  async function renameFocused() {
    if (!window.tingxie) return
    const name = normalizeRecordingName(renameDraft)
    const currentName = focused?.displayName || focusedHistory?.fileName
    if (!name || !currentName || name === currentName) return
    if (focused) {
      if (await run(() => window.tingxie!.renameMediaAsset(focused.id, name)) && onHistoryChange) onHistoryChange(await window.tingxie.getHistory())
      return
    }
    if (focusedHistory) {
      setError('')
      try {
        const updated = await window.tingxie.renameTranscript(focusedHistory.id, name)
        if (onHistoryChange) onHistoryChange(await window.tingxie.getHistory())
        setRenameDraft(updated.fileName)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '转写名称保存失败')
      }
    }
  }

  async function recoverHistoryMedia(item: TranscriptSummary) {
    if (!onRecoverHistoryMedia) return
    setRecoveryMessage('')
    try { await onRecoverHistoryMedia(item); setRecoveryMessage(`“${item.fileName}”的音频已迁入媒体库`) }
    catch (reason) { setRecoveryMessage(reason instanceof Error ? reason.message : '历史音频迁移失败') }
  }

  function toggleFolder(id: string) {
    setExpandedFolders((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function handleFolderDrop(event: DragEvent, folderId?: string) {
    event.preventDefault()
    const draggedFolder = event.dataTransfer.getData('application/x-tingxie-folder-id')
    if (draggedFolder && window.tingxie) void run(() => window.tingxie!.moveMediaFolder(draggedFolder, folderId))
    const assetIds = event.dataTransfer.getData('application/x-tingxie-media-ids')
    if (assetIds) void moveAssets(folderId, JSON.parse(assetIds) as string[])
  }

  return <main className="library-page">
    <header className="library-header"><div><h1>媒体库</h1><p>录音由应用安全保管，可用多级文件夹整理并批量操作</p></div><div className="library-header-actions"><button className="soft-button" onClick={() => onImportFolder(scopedFolderId)}><FolderInput size={17} />导入文件夹</button><button className="primary-button" onClick={() => onImportFiles(scopedFolderId)}><Upload size={17} />导入音视频</button></div></header>
    <section className="library-shell glass-card">
      <aside className="folder-rail" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFolderDrop(event)}>
        <div className="folder-rail-title"><Library size={17} />分组</div>
        <button aria-label="全部文件" className={scope.kind === 'all' ? 'folder-row active' : 'folder-row'} onClick={() => setScope({ kind: 'all' })}><Library size={16} /><span>全部文件</span><b>{library.assets.length + derived.unlinkedHistory.length}</b></button>
        <button aria-label="历史转写" className={scope.kind === 'history' ? 'folder-row active' : 'folder-row'} onClick={() => { setScope({ kind: 'history' }); setSelected(new Set()) }}><FileClock size={16} /><span>历史转写</span><b>{history.length}</b></button>
        <button aria-label="未分组" className={scope.kind === 'unfiled' ? 'folder-row active' : 'folder-row'} onClick={() => setScope({ kind: 'unfiled' })} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFolderDrop(event)}><Folder size={16} /><span>未分组</span><b>{derived.unfiledCount}</b></button>
        <div className="folder-tree">{folderTree.map((node) => {
          const active = scope.kind === 'folder' && scope.folderId === node.folder.id
          return <div key={node.folder.id} className={`folder-tree-item${active ? ' active' : ''}`} data-folder-depth={node.depth} style={{ '--folder-depth': node.depth } as CSSProperties}>
            <div className="folder-tree-row" draggable onDragStart={(event) => event.dataTransfer.setData('application/x-tingxie-folder-id', node.folder.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); handleFolderDrop(event, node.folder.id) }}>
              <button className="folder-disclosure" aria-label={expandedFolders.has(node.folder.id) ? '收起文件夹' : '展开文件夹'} disabled={!node.hasChildren} onClick={() => toggleFolder(node.folder.id)}>{node.hasChildren ? expandedFolders.has(node.folder.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}</button>
              {editingFolderId === node.folder.id ? <input aria-label={`重命名 ${node.folder.name}`} autoFocus className="folder-inline-input" value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} onBlur={() => void renameFolder(node.folder)} onKeyDown={(event) => { if (event.key === 'Enter') void renameFolder(node.folder); if (event.key === 'Escape') setEditingFolderId(undefined) }} /> : <button aria-label={node.folder.name} className={active ? 'folder-row active' : 'folder-row'} onClick={() => setScope({ kind: 'folder', folderId: node.folder.id })}><Folder size={16} /><span>{node.folder.name}</span><b>{derived.folderCounts.get(node.folder.id) || 0}</b></button>}
            </div>
            {active && <div className="folder-inline-actions" aria-label={`${node.folder.name} 文件夹操作`}>
              <button aria-label={`在 ${node.folder.name} 中新建子文件夹`} onClick={() => { setCreatingChildFor(node.folder.id); setMovingFolderId(undefined); setChildFolderName(''); setExpandedFolders((current) => new Set(current).add(node.folder.id)) }}><FolderPlus size={13} />子文件夹</button>
              <button aria-label={`重命名 ${node.folder.name}`} onClick={() => { setEditingFolderId(node.folder.id); setFolderDraft(node.folder.name); setCreatingChildFor(undefined); setMovingFolderId(undefined) }}><Pencil size={13} />重命名</button>
              <button aria-label={`移动 ${node.folder.name}`} onClick={() => { setMovingFolderId(node.folder.id); setCreatingChildFor(undefined) }}><Move size={13} />移动</button>
              <button className="danger" aria-label={`删除 ${node.folder.name}`} onClick={() => setDeleteFolderId(node.folder.id)}><Trash2 size={13} />删除</button>
            </div>}
            {active && creatingChildFor === node.folder.id && <div className="folder-inline-editor"><input autoFocus value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(childFolderName, node.folder.id); if (event.key === 'Escape') setCreatingChildFor(undefined) }} placeholder="子文件夹名称" aria-label={`在 ${node.folder.name} 中创建子文件夹`} /><button aria-label="确认创建子文件夹" onClick={() => void createFolder(childFolderName, node.folder.id)}><FolderPlus size={14} /></button></div>}
            {active && movingFolderId === node.folder.id && <div className="folder-inline-move"><GlassSelect size="compact" ariaLabel={`移动 ${node.folder.name} 到`} value={node.folder.parentId || '__root'} options={folderOptions.map((option) => ({ ...option, disabled: option.value === node.folder.id || folderDescendants(library.folders, node.folder.id).has(option.value) }))} onValueChange={async (value) => { if (window.tingxie && await run(() => window.tingxie!.moveMediaFolder(node.folder.id, value === '__root' ? undefined : value))) setMovingFolderId(undefined) }} /></div>}
          </div>
        })}</div>
        <div className="new-folder-row"><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(newFolderName) }} placeholder="新建根文件夹" aria-label="根文件夹名称" /><button onClick={() => void createFolder(newFolderName)} aria-label="创建根文件夹"><FolderPlus size={16} /></button></div>
        <div className="library-location"><span>存储位置</span><code title={library.rootPath}>{library.rootPath}</code></div>
      </aside>
      <div className="library-list-pane">
        <div className="library-toolbar"><label className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或格式" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={14} /></button>}</label><GlassSelect size="compact" ariaLabel="转写状态筛选" value={status} options={[{ value: 'all', label: '全部状态' }, { value: 'untranscribed', label: '未转写' }, { value: 'transcribed', label: '已转写' }, { value: 'partial', label: '部分完成' }, { value: 'failed', label: '失败' }]} onValueChange={(value) => setStatus(value as typeof status)} /></div>
        {importProgress && <div className="library-import-progress" role="status" aria-live="polite"><span>{importProgress.detail}</span><progress max={Math.max(1, importProgress.total)} value={importProgress.total ? importProgress.completed : undefined} /></div>}
        {(recoveryMessage || error) && <div className={error ? 'library-recovery-message error' : 'library-recovery-message'} role="status">{error || recoveryMessage}</div>}
        {selected.size > 0 && <div className="batch-bar"><span><CheckSquare size={16} />已选择 {selected.size} 项</span><GlassSelect size="compact" ariaLabel="移动所选媒体" placeholder="移动到…" value="" options={folderOptions} onValueChange={(value) => void moveAssets(value === '__root' ? undefined : value)} /><button className="danger-button" onClick={async () => { if (!window.tingxie || !window.confirm(`确定从媒体库永久删除选中的 ${selected.size} 个文件吗？`)) return; await run(() => window.tingxie!.deleteMediaAssets([...selected])); setSelected(new Set()) }}><Trash2 size={15} />删除</button><button onClick={() => setSelected(new Set())}>取消</button></div>}
        <div className="library-table" role="table" aria-label="媒体文件">
          <div className="library-table-head" role="row"><button onClick={() => setSelected((current) => { const next = new Set(current); for (const id of visibleAssetIds) { if (allVisibleSelected) next.delete(id); else next.add(id) } return next })} aria-label="全选可见文件">{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button><span>名称</span><span>时长</span><span>大小</span><span>状态</span><span>导入时间</span></div>
          <div ref={tableScrollRef} className="library-table-scroll" data-virtualized="true">{rows.length ? <div className="library-virtual-rows" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>{rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row: MediaLibraryRow = rows[virtualRow.index]
            const rowKey = row.kind === 'asset' ? `asset:${row.id}` : `transcript:${row.id}`
            const linkedTranscript = row.kind === 'asset' && row.asset.transcriptId ? derived.transcriptById.get(row.asset.transcriptId) : undefined
            const openRow = () => {
              if (row.kind === 'history') onOpenTranscript(row.transcript)
              else if (linkedTranscript) onOpenTranscript(linkedTranscript)
              else setFocusedRowKey(rowKey)
            }
            return <div key={rowKey} className="library-virtual-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
              {row.kind === 'asset' ? <div className={`library-table-row${selected.has(row.id) ? ' selected' : ''}${focusedRowKey === rowKey ? ' focused' : ''}`} role="row" tabIndex={0} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-tingxie-media-ids', JSON.stringify(selected.has(row.id) ? [...selected] : [row.id]))} onClick={openRow} onKeyDown={(event) => { if (event.key === 'Enter') openRow() }}>
                <button className="library-row-select" aria-label={`选择 ${row.asset.displayName}`} onClick={(event) => { event.stopPropagation(); toggle(row.id); setFocusedRowKey(rowKey) }}>{selected.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                <div className="library-file-name"><span><FileAudio size={18} /></span><div><strong>{row.asset.displayName}</strong><small>{row.asset.extension}</small></div></div><span>{formatDuration(row.asset.duration || 0)}</span><span>{formatBytes(row.asset.size)}</span><span><i className={`asset-status ${row.asset.transcriptStatus}`}>{statusLabel(row.asset)}</i></span><span>{new Date(row.asset.importedAt).toLocaleDateString()}</span>
              </div> : <div className={`library-table-row legacy-transcript-row${focusedRowKey === rowKey ? ' focused' : ''}`} role="row" tabIndex={0} onClick={openRow} onKeyDown={(event) => { if (event.key === 'Enter') openRow() }}>
                <button className="library-row-select" aria-label={`选择 ${row.transcript.fileName}`} onClick={(event) => { event.stopPropagation(); setFocusedRowKey(rowKey) }}>{focusedRowKey === rowKey ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                <div className="library-file-name"><span><FileText size={18} /></span><div><strong>{row.transcript.fileName}</strong><small>历史转写 · {row.transcript.sourceAvailable ? '可访问原音频' : '仅保留文字'}</small>{row.transcript.sourceAvailable && !derived.linkedTranscriptIds.has(row.id) && onRecoverHistoryMedia ? <button className="legacy-recover-button" onClick={(event) => { event.stopPropagation(); void recoverHistoryMedia(row.transcript) }}>迁入原音频</button> : null}</div></div><span>{formatDuration(row.transcript.duration || 0)}</span><span>{row.transcript.segmentCount} 段</span><span><i className={`asset-status ${row.transcript.outcome === 'failed' ? 'failed' : row.transcript.outcome === 'partial' ? 'partial' : 'transcribed'}`}>{row.transcript.outcome === 'failed' ? '失败记录' : row.transcript.outcome === 'partial' ? '部分完成' : '文字完整'}</i></span><span>{new Date(row.transcript.createdAt).toLocaleDateString()}</span>
              </div>}
            </div>
          })}</div> : <div className="library-empty"><FilePlus2 size={30} /><strong>{deferredQuery ? '没有匹配的媒体或转写' : scope.kind === 'history' ? '还没有历史转写' : '此分组还没有文件'}</strong><span>{deferredQuery ? '尝试更换关键词或状态筛选' : '导入过往录音，或从“新建转写”添加文件'}</span></div>}</div>
        </div>
      </div>
      <aside className="library-inspector">{focused || focusedHistory ? <>
        <div className="inspector-art">{focused ? <FileAudio size={34} /> : <FileText size={34} />}</div>
        <label>显示名称<AutoGrowNameEditor value={renameDraft} onChange={setRenameDraft} onSave={() => void renameFocused()} onCancel={() => setRenameDraft(focused?.displayName || focusedHistory?.fileName || '')} /></label>
        <button className="soft-button inspector-rename" onClick={() => void renameFocused()}><Pencil size={14} />保存名称</button>
        {focused ? <dl><div><dt>格式</dt><dd>{focused.extension}</dd></div><div><dt>时长</dt><dd>{formatDuration(focused.duration || 0)}</dd></div><div><dt>大小</dt><dd>{formatBytes(focused.size)}</dd></div><div><dt>状态</dt><dd>{statusLabel(focused)}</dd></div></dl> : <dl><div><dt>类型</dt><dd>历史转写</dd></div><div><dt>时长</dt><dd>{formatDuration(focusedHistory?.duration || 0)}</dd></div><div><dt>段落</dt><dd>{focusedHistory?.segmentCount || 0} 段</dd></div><div><dt>音频</dt><dd>{focusedHistory?.sourceAvailable ? '可访问' : '无对应音频'}</dd></div></dl>}
        {focused ? focusedTranscript ? <button className="primary-button" onClick={() => onOpenTranscript(focusedTranscript)}>打开转写</button> : <button className="primary-button" onClick={() => onTranscribe(focused)}>开始转写</button> : focusedHistory ? <><button className="primary-button" onClick={() => onOpenTranscript(focusedHistory)}>打开转写</button>{focusedHistory.sourceAvailable && !derived.linkedTranscriptIds.has(focusedHistory.id) && onRecoverHistoryMedia ? <button className="soft-button" onClick={() => void recoverHistoryMedia(focusedHistory)}>迁入原音频</button> : null}</> : null}
      </> : <div className="inspector-empty"><FileAudio size={30} /><strong>选择一个文件</strong><span>点击左侧方框查看详情；点击其余区域打开转写</span></div>}</aside>
    </section>
    {deleteFolder && <div className="modal-backdrop folder-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteFolderId(undefined) }}><section className="folder-delete-dialog glass-card" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title"><div className="delete-folder-icon"><Trash2 size={21} /></div><h2 id="delete-folder-title">删除“{deleteFolder.name}”</h2><p>包含 {deleteDescendants.size} 个子文件夹、{deleteAssetCount} 个媒体文件。请选择安全处理方式。</p><button className="secondary-button" onClick={async () => { if (window.tingxie) await run(() => window.tingxie!.deleteMediaFolder(deleteFolder.id, 'preserve-content')); setDeleteFolderId(undefined) }}>仅删除文件夹，内容移到上一级</button><button className="danger-button" onClick={async () => { if (window.tingxie) await run(() => window.tingxie!.deleteMediaFolder(deleteFolder.id, 'delete-media')); setDeleteFolderId(undefined); setSelected(new Set()) }}>删除文件夹及其媒体文件</button><button className="text-button" onClick={() => setDeleteFolderId(undefined)}>取消</button></section></div>}
  </main>
})
