import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckSquare, ChevronRight, ExternalLink, FileAudio, FileClock, FilePlus2, FileText, Folder, FolderInput, FolderPlus, Library, Move, Pencil, Play, Search, Square, Trash2, Upload, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { DEFAULT_APP_PREFERENCES, type AppPreferences, type MediaAsset, type MediaFolder, type MediaImportProgress, type MediaLibrarySnapshot, type TranscriptSummary } from '../../electron/types'
import { formatBytes, formatDuration } from '../utils'
import { GlassSelect } from './GlassSelect'
import { GlassContextMenu, type GlassContextMenuEntry } from './GlassContextMenu'
import { LayoutResizeHandle } from './LayoutResizeHandle'
import { clampLayoutValue, DEFAULT_LIBRARY_FOLDER_WIDTH, DEFAULT_LIBRARY_INSPECTOR_WIDTH } from './layout-resize'
import { buildMediaLibraryIndex, filterMediaLibraryRows, folderIdFromScope, visibleMediaFolderTree, type MediaLibraryRow, type MediaLibraryScope } from './media-library-model'
import { normalizeRecordingName } from './recording-name'
import { useMotionVariants } from '../motion/variants'

interface MediaLibraryViewProps {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  preferences?: AppPreferences
  importProgress?: MediaImportProgress
  onLibraryChange(library: MediaLibrarySnapshot): void
  onHistoryChange?(history: TranscriptSummary[]): void
  onPreferencesChange?(preferences: AppPreferences): Promise<void>
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

function rowSelectionKey(row: MediaLibraryRow): string {
  return `${row.kind === 'asset' ? 'asset' : 'transcript'}:${row.id}`
}

function selectionIds(keys: Iterable<string>, prefix: 'asset' | 'transcript'): string[] {
  const marker = `${prefix}:`
  return [...keys].flatMap((key) => key.startsWith(marker) ? [key.slice(marker.length)] : [])
}

function AutoGrowNameEditor({ value, focusRequest, onChange, onSave, onCancel }: { value: string; focusRequest: number; onChange(value: string): void; onSave(): void; onCancel(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  useEffect(() => {
    if (!focusRequest) return
    ref.current?.focus()
    ref.current?.select()
  }, [focusRequest])
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave()
    }
  }
  return <textarea ref={ref} rows={1} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} aria-label="显示名称" />
}

export const MediaLibraryView = memo(function MediaLibraryView({ library, history, preferences = DEFAULT_APP_PREFERENCES, importProgress, onLibraryChange, onHistoryChange, onPreferencesChange, onOpenTranscript, onTranscribe, onImportFiles, onImportFolder, onRecoverHistoryMedia }: MediaLibraryViewProps) {
  const { dialogPanel, fade, fadeUp, listItem } = useMotionVariants()
  const [scope, setScope] = useState<MediaLibraryScope>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | MediaAsset['transcriptStatus']>('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [dragTargetId, setDragTargetId] = useState<string>()
  const [draggingKey, setDraggingKey] = useState<string>()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(library.folders.map((folder) => folder.id)))
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingChildFor, setCreatingChildFor] = useState<string>()
  const [movingFolderId, setMovingFolderId] = useState<string>()
  const [childFolderName, setChildFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string>()
  const [folderDraft, setFolderDraft] = useState('')
  const [deleteFolderId, setDeleteFolderId] = useState<string>()
  const [renameDraft, setRenameDraft] = useState('')
  const [renameFocusRequest, setRenameFocusRequest] = useState(0)
  const [focusedRowKey, setFocusedRowKey] = useState<string>()
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [error, setError] = useState('')
  const [folderPaneWidth, setFolderPaneWidth] = useState(preferences.libraryFolderWidth)
  const [inspectorPaneWidth, setInspectorPaneWidth] = useState(preferences.libraryInspectorWidth)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const libraryShellRef = useRef<HTMLElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const derived = useMemo(() => buildMediaLibraryIndex(library, history), [library, history])
  const folderTree = useMemo(() => visibleMediaFolderTree(library.folders, expandedFolders), [library.folders, expandedFolders])
  const folderOptions = useMemo(() => [{ value: '__root', label: '根目录（未分组）' }, ...visibleMediaFolderTree(library.folders, new Set(library.folders.map((folder) => folder.id))).map((node) => ({ value: node.folder.id, label: `${'　'.repeat(node.depth)}${node.path}` }))], [library.folders])
  const scopedFolderId = folderIdFromScope(scope, library.folders)
  const rows = useMemo(() => filterMediaLibraryRows(derived, scope, status, deferredQuery), [derived, scope, status, deferredQuery])
  const visibleSelectionKeys = useMemo(() => rows.map(rowSelectionKey), [rows])
  const focusedAssetId = focusedRowKey?.startsWith('asset:') ? focusedRowKey.slice(6) : undefined
  const focusedTranscriptId = focusedRowKey?.startsWith('transcript:') ? focusedRowKey.slice(11) : undefined
  const focused = focusedAssetId ? derived.assetById.get(focusedAssetId) : undefined
  const focusedTranscript = focused?.transcriptId ? derived.transcriptById.get(focused.transcriptId) : undefined
  const focusedHistory = focusedTranscriptId ? derived.transcriptById.get(focusedTranscriptId) : undefined
  const allVisibleSelected = visibleSelectionKeys.length > 0 && visibleSelectionKeys.every((key) => selected.has(key))
  const selectedAssetIds = useMemo(() => selectionIds(selected, 'asset'), [selected])
  const selectedTranscriptIds = useMemo(() => selectionIds(selected, 'transcript'), [selected])
  const deleteFolder = deleteFolderId ? library.folders.find((folder) => folder.id === deleteFolderId) : undefined
  const deleteDescendants = useMemo(() => deleteFolderId ? folderDescendants(library.folders, deleteFolderId) : new Set<string>(), [deleteFolderId, library.folders])
  const deleteAssetCount = useMemo(() => deleteFolderId ? library.assets.filter((asset) => asset.folderId === deleteFolderId || (asset.folderId && deleteDescendants.has(asset.folderId))).length : 0, [deleteFolderId, deleteDescendants, library.assets])
  const deleteTranscriptCount = useMemo(() => deleteFolderId ? history.filter((item) => item.folderId === deleteFolderId || (item.folderId && deleteDescendants.has(item.folderId))).length : 0, [deleteFolderId, deleteDescendants, history])
  const rowVirtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => tableScrollRef.current, getItemKey: (index) => `${rows[index]?.kind}-${rows[index]?.id}`, estimateSize: () => 61, overscan: 8, initialRect: { width: 900, height: 640 } })

  useEffect(() => { setRenameDraft(focused?.displayName || focusedHistory?.fileName || '') }, [focused?.id, focused?.displayName, focusedHistory?.id, focusedHistory?.fileName])
  useEffect(() => { setFolderPaneWidth(preferences.libraryFolderWidth) }, [preferences.libraryFolderWidth])
  useEffect(() => { setInspectorPaneWidth(preferences.libraryInspectorWidth) }, [preferences.libraryInspectorWidth])

  function commitLibraryPane(key: 'libraryFolderWidth' | 'libraryInspectorWidth', value: number) {
    if (preferences[key] !== value && onPreferencesChange) void onPreferencesChange({ ...preferences, [key]: value }).catch(() => undefined)
  }

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

  async function moveItems(folderId?: string, keys = selected) {
    if (!keys.size || !window.tingxie) return
    const assetIds = new Set(selectionIds(keys, 'asset'))
    const pureTranscriptIds: string[] = []
    for (const transcriptId of selectionIds(keys, 'transcript')) {
      const transcript = derived.transcriptById.get(transcriptId)
      if (transcript?.mediaId) assetIds.add(transcript.mediaId)
      else pureTranscriptIds.push(transcriptId)
    }
    setError('')
    try {
      if (assetIds.size) onLibraryChange(await window.tingxie.moveMediaAssets([...assetIds], folderId))
      if (pureTranscriptIds.length && onHistoryChange) onHistoryChange(await window.tingxie.moveTranscripts(pureTranscriptIds, folderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移动所选项目失败')
    }
  }

  async function deleteFolderWithMode(folder: MediaFolder, mode: 'preserve-content' | 'delete-media') {
    if (!window.tingxie) return
    const deleted = await run(() => window.tingxie!.deleteMediaFolder(folder.id, mode))
    if (deleted && onHistoryChange) onHistoryChange(await window.tingxie.getHistory())
    if (deleted) {
      setDeleteFolderId(undefined)
      if (mode === 'delete-media') setSelected(new Set())
    }
  }

  async function deleteItems(keys: Set<string>, includeLinkedTranscripts = false) {
    if (!keys.size || !window.tingxie) return
    const assetIds = selectionIds(keys, 'asset')
    const transcriptIds = new Set(selectionIds(keys, 'transcript'))
    if (includeLinkedTranscripts) {
      for (const assetId of assetIds) {
        const transcriptId = derived.assetById.get(assetId)?.transcriptId
        if (transcriptId) transcriptIds.add(transcriptId)
      }
    }
    const parts = [assetIds.length ? `${assetIds.length} 个媒体文件` : '', transcriptIds.size ? `${transcriptIds.size} 个转写记录` : ''].filter(Boolean)
    if (!window.confirm(`确定删除${parts.join('和')}吗？${assetIds.length && !includeLinkedTranscripts ? '媒体对应的已有转写会保留。' : ''}`)) return
    setError('')
    try {
      if (assetIds.length) onLibraryChange(await window.tingxie.deleteMediaAssets(assetIds))
      if (transcriptIds.size) {
        await window.tingxie.deleteTranscripts([...transcriptIds])
        if (onHistoryChange) onHistoryChange(await window.tingxie.getHistory())
        onLibraryChange(await window.tingxie.getMediaLibrary())
      }
      setSelected(new Set())
      if ((focusedAssetId && assetIds.includes(focusedAssetId)) || (focusedTranscriptId && transcriptIds.has(focusedTranscriptId))) setFocusedRowKey(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除所选项目失败')
    }
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
    setDragTargetId(undefined)
    setDraggingKey(undefined)
    const draggedFolder = event.dataTransfer.getData('application/x-tingxie-folder-id')
    if (draggedFolder && window.tingxie) void run(() => window.tingxie!.moveMediaFolder(draggedFolder, folderId))
    const assetIds = event.dataTransfer.getData('application/x-tingxie-media-ids')
    if (assetIds) void moveItems(folderId, new Set((JSON.parse(assetIds) as string[]).map((id) => `asset:${id}`)))
    const transcriptIds = event.dataTransfer.getData('application/x-tingxie-transcript-ids')
    if (transcriptIds) void moveItems(folderId, new Set((JSON.parse(transcriptIds) as string[]).map((id) => `transcript:${id}`)))
  }

  function moveSelectionEntries(keys: Set<string>): GlassContextMenuEntry[] {
    return folderOptions.map((option) => ({
      type: 'action' as const,
      id: `move-${option.value}`,
      label: typeof option.label === 'string' ? option.label : option.value,
      onSelect: () => void moveItems(option.value === '__root' ? undefined : option.value, keys),
    }))
  }

  function requestRename(rowKey: string) {
    setFocusedRowKey(rowKey)
    setRenameFocusRequest((value) => value + 1)
  }

  async function exportSummary(summary: TranscriptSummary) {
    if (!window.tingxie) return
    const result = await window.tingxie.getTranscript(summary.id)
    if (result) await window.tingxie.exportTranscript(result)
  }

  function rowContextEntries(row: MediaLibraryRow, rowKey: string, linkedTranscript?: TranscriptSummary): GlassContextMenuEntry[] {
    const keys = selected.has(rowKey) ? new Set(selected) : new Set([rowKey])
    const open = row.kind === 'history'
      ? () => onOpenTranscript(row.transcript)
      : linkedTranscript
        ? () => onOpenTranscript(linkedTranscript)
        : () => onTranscribe(row.asset)
    const transcript = row.kind === 'history' ? row.transcript : linkedTranscript
    const entries: GlassContextMenuEntry[] = [
      { type: 'action', id: 'open', label: row.kind === 'asset' && !linkedTranscript ? '开始转写' : '打开转写', icon: <Play size={14} />, onSelect: open },
      ...(row.kind === 'asset' ? [{ type: 'action' as const, id: 'show-file', label: '在文件夹中显示', icon: <ExternalLink size={14} />, onSelect: () => void window.tingxie?.showMediaItem(row.asset.id) }] : []),
      { type: 'action', id: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => requestRename(rowKey) },
      { type: 'submenu', id: 'move', label: keys.size > 1 ? '移动所选项目到' : '移动到', icon: <Move size={14} />, children: moveSelectionEntries(keys) },
    ]
    if (transcript) entries.push({ type: 'action', id: 'export', label: '导出转写', icon: <ExternalLink size={14} />, onSelect: () => void exportSummary(transcript) })
    entries.push({ type: 'separator', id: 'delete-separator' })
    if (row.kind === 'asset') {
      entries.push({ type: 'action', id: 'delete-media', label: keys.size > 1 ? '删除所选项目' : '删除媒体，保留转写', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItems(keys) })
      if (linkedTranscript && keys.size === 1) {
        entries.push({ type: 'action', id: 'delete-transcript', label: '删除转写，保留媒体', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItems(new Set([`transcript:${linkedTranscript.id}`])) })
        entries.push({ type: 'action', id: 'delete-both', label: '同时删除媒体和转写', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItems(keys, true) })
      }
    } else entries.push({ type: 'action', id: 'delete-transcript', label: keys.size > 1 ? '删除所选项目' : '删除转写记录', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItems(keys) })
    return entries
  }

  function folderContextEntries(folder: MediaFolder): GlassContextMenuEntry[] {
    const descendants = folderDescendants(library.folders, folder.id)
    return [
      { type: 'action', id: 'new-child', label: '新建子文件夹', icon: <FolderPlus size={14} />, onSelect: () => { setScope({ kind: 'folder', folderId: folder.id }); setCreatingChildFor(folder.id); setMovingFolderId(undefined); setChildFolderName(''); setExpandedFolders((current) => new Set(current).add(folder.id)) } },
      { type: 'action', id: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => { setScope({ kind: 'folder', folderId: folder.id }); setEditingFolderId(folder.id); setFolderDraft(folder.name); setCreatingChildFor(undefined); setMovingFolderId(undefined) } },
      { type: 'submenu', id: 'move', label: '移动到', icon: <Move size={14} />, children: folderOptions.map((option) => ({ type: 'action' as const, id: `folder-move-${option.value}`, label: typeof option.label === 'string' ? option.label : option.value, disabled: option.value === folder.id || descendants.has(option.value), onSelect: () => void run(() => window.tingxie!.moveMediaFolder(folder.id, option.value === '__root' ? undefined : option.value)) })) },
      { type: 'separator', id: 'delete-separator' },
      { type: 'action', id: 'delete', label: '删除文件夹', icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleteFolderId(folder.id) },
    ]
  }

  return <m.main layout variants={fadeUp} initial="initial" animate="animate" exit="exit" className="library-page">
    <header className="library-header"><div><h1>媒体库</h1><p>录音由应用安全保管，可用多级文件夹整理并批量操作</p></div><div className="library-header-actions"><button className="soft-button" onClick={() => onImportFolder(scopedFolderId)}><FolderInput size={17} />导入文件夹</button><button className="primary-button" onClick={() => onImportFiles(scopedFolderId)}><Upload size={17} />导入音视频</button></div></header>
    <section ref={libraryShellRef} className="library-shell glass-card" style={{ '--library-folder-width': `${folderPaneWidth}px`, '--library-inspector-width': `${inspectorPaneWidth}px` } as CSSProperties}>
      <aside className="folder-rail" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFolderDrop(event)}>
        <div className="folder-rail-title"><Library size={17} />分组</div>
        <button aria-label="全部文件" className={scope.kind === 'all' ? 'folder-row active' : 'folder-row'} onClick={() => setScope({ kind: 'all' })}><Library size={16} /><span>全部文件</span><b>{library.assets.length + derived.unlinkedHistory.length}</b></button>
        <button aria-label="历史转写" className={scope.kind === 'history' ? 'folder-row active' : 'folder-row'} onClick={() => { setScope({ kind: 'history' }); setSelected(new Set()) }}><FileClock size={16} /><span>历史转写</span><b>{history.length}</b></button>
        <button aria-label="未分组" className={`${scope.kind === 'unfiled' ? 'folder-row active' : 'folder-row'}${dragTargetId === '__unfiled' ? ' drop-target' : ''}`} onClick={() => setScope({ kind: 'unfiled' })} onDragEnter={() => setDragTargetId('__unfiled')} onDragLeave={() => setDragTargetId(undefined)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFolderDrop(event)}><Folder size={16} /><span>未分组</span><b>{derived.unfiledCount}</b></button>
        <div className="folder-tree"><AnimatePresence initial={false} mode="popLayout">{folderTree.map((node) => {
          const active = scope.kind === 'folder' && scope.folderId === node.folder.id
          return <m.div layout variants={listItem} initial="initial" animate="animate" exit="exit" key={node.folder.id} className={`folder-tree-item${active ? ' active' : ''}${dragTargetId === node.folder.id ? ' drop-target' : ''}${draggingKey === `folder:${node.folder.id}` ? ' dragging-item' : ''}`} data-folder-depth={node.depth} style={{ '--folder-depth': node.depth } as CSSProperties}>
            <GlassContextMenu ariaLabel={`${node.folder.name} 文件夹操作`} entries={folderContextEntries(node.folder)}><div className="folder-tree-row" draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-tingxie-folder-id', node.folder.id); setDraggingKey(`folder:${node.folder.id}`) }} onDragEnd={() => { setDraggingKey(undefined); setDragTargetId(undefined) }} onDragEnter={() => setDragTargetId(node.folder.id)} onDragLeave={() => setDragTargetId(undefined)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); handleFolderDrop(event, node.folder.id) }}>
              <button className="folder-disclosure" aria-label={expandedFolders.has(node.folder.id) ? '收起文件夹' : '展开文件夹'} disabled={!node.hasChildren} onClick={() => toggleFolder(node.folder.id)}>{node.hasChildren ? <ChevronRight className={expandedFolders.has(node.folder.id) ? 'expanded' : ''} size={14} /> : <span />}</button>
              {editingFolderId === node.folder.id ? <input aria-label={`重命名 ${node.folder.name}`} autoFocus className="folder-inline-input" value={folderDraft} onContextMenu={(event) => event.stopPropagation()} onChange={(event) => setFolderDraft(event.target.value)} onBlur={() => void renameFolder(node.folder)} onKeyDown={(event) => { if (event.key === 'Enter') void renameFolder(node.folder); if (event.key === 'Escape') setEditingFolderId(undefined) }} /> : <button aria-label={node.folder.name} className={active ? 'folder-row active' : 'folder-row'} onClick={() => setScope({ kind: 'folder', folderId: node.folder.id })}><Folder size={16} /><span>{node.folder.name}</span><b>{derived.folderCounts.get(node.folder.id) || 0}</b></button>}
            </div></GlassContextMenu>
            <AnimatePresence initial={false}>{active && <m.div variants={fade} initial="initial" animate="animate" exit="exit" className="folder-inline-actions" aria-label={`${node.folder.name} 文件夹操作`}>
              <button aria-label={`在 ${node.folder.name} 中新建子文件夹`} onClick={() => { setCreatingChildFor(node.folder.id); setMovingFolderId(undefined); setChildFolderName(''); setExpandedFolders((current) => new Set(current).add(node.folder.id)) }}><FolderPlus size={13} />子文件夹</button>
              <button aria-label={`重命名 ${node.folder.name}`} onClick={() => { setEditingFolderId(node.folder.id); setFolderDraft(node.folder.name); setCreatingChildFor(undefined); setMovingFolderId(undefined) }}><Pencil size={13} />重命名</button>
              <button aria-label={`移动 ${node.folder.name}`} onClick={() => { setMovingFolderId(node.folder.id); setCreatingChildFor(undefined) }}><Move size={13} />移动</button>
              <button className="danger" aria-label={`删除 ${node.folder.name}`} onClick={() => setDeleteFolderId(node.folder.id)}><Trash2 size={13} />删除</button>
            </m.div>}</AnimatePresence>
            {active && creatingChildFor === node.folder.id && <div className="folder-inline-editor"><input autoFocus value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(childFolderName, node.folder.id); if (event.key === 'Escape') setCreatingChildFor(undefined) }} placeholder="子文件夹名称" aria-label={`在 ${node.folder.name} 中创建子文件夹`} /><button aria-label="确认创建子文件夹" onClick={() => void createFolder(childFolderName, node.folder.id)}><FolderPlus size={14} /></button></div>}
            {active && movingFolderId === node.folder.id && <div className="folder-inline-move"><GlassSelect className="folder-path-select" contentClassName="folder-path-select-content" size="compact" ariaLabel={`移动 ${node.folder.name} 到`} value={node.folder.parentId || '__root'} options={folderOptions.map((option) => ({ ...option, disabled: option.value === node.folder.id || folderDescendants(library.folders, node.folder.id).has(option.value) }))} onValueChange={async (value) => { if (window.tingxie && await run(() => window.tingxie!.moveMediaFolder(node.folder.id, value === '__root' ? undefined : value))) setMovingFolderId(undefined) }} /></div>}
          </m.div>
        })}</AnimatePresence></div>
        <div className="new-folder-row"><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(newFolderName) }} placeholder="新建根文件夹" aria-label="根文件夹名称" /><button onClick={() => void createFolder(newFolderName)} aria-label="创建根文件夹"><FolderPlus size={16} /></button></div>
        <div className="library-location"><span>存储位置</span><code title={library.rootPath}>{library.rootPath}</code></div>
      </aside>
      <LayoutResizeHandle className="library-folder-resizer" label="调整文件夹栏宽度" orientation="vertical" value={folderPaneWidth} min={170} max={Math.max(170, (libraryShellRef.current?.clientWidth || 1200) - 720)} onResize={(value) => setFolderPaneWidth(clampLayoutValue('library-folder', value, libraryShellRef.current?.clientWidth || 1200))} onCommit={(value) => commitLibraryPane('libraryFolderWidth', clampLayoutValue('library-folder', value, libraryShellRef.current?.clientWidth || 1200))} onReset={() => { setFolderPaneWidth(DEFAULT_LIBRARY_FOLDER_WIDTH); commitLibraryPane('libraryFolderWidth', DEFAULT_LIBRARY_FOLDER_WIDTH) }} />
      <div className="library-list-pane">
        <div className="library-toolbar"><label className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或格式" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={14} /></button>}</label><GlassSelect size="compact" ariaLabel="转写状态筛选" value={status} options={[{ value: 'all', label: '全部状态' }, { value: 'untranscribed', label: '未转写' }, { value: 'transcribed', label: '已转写' }, { value: 'partial', label: '部分完成' }, { value: 'failed', label: '失败' }]} onValueChange={(value) => setStatus(value as typeof status)} /></div>
        <AnimatePresence initial={false}>{importProgress && <m.div variants={listItem} initial="initial" animate="animate" exit="exit" className="library-import-progress" role="status" aria-live="polite"><span>{importProgress.detail}</span><progress max={Math.max(1, importProgress.total)} value={importProgress.total ? importProgress.completed : undefined} /></m.div>}</AnimatePresence>
        <AnimatePresence initial={false}>{(recoveryMessage || error) && <m.div variants={listItem} initial="initial" animate="animate" exit="exit" className={error ? 'library-recovery-message error' : 'library-recovery-message'} role="status">{error || recoveryMessage}</m.div>}</AnimatePresence>
        <AnimatePresence initial={false}>{selected.size > 0 && <m.div layout variants={listItem} initial="initial" animate="animate" exit="exit" className="batch-bar"><span><CheckSquare size={16} />已选择 {selectedAssetIds.length ? `${selectedAssetIds.length} 个媒体` : ''}{selectedAssetIds.length && selectedTranscriptIds.length ? '、' : ''}{selectedTranscriptIds.length ? `${selectedTranscriptIds.length} 个转写` : ''}</span><GlassSelect className="folder-path-select" contentClassName="folder-path-select-content" size="compact" ariaLabel="移动所选项目" placeholder="移动到…" value="" options={folderOptions} onValueChange={(value) => void moveItems(value === '__root' ? undefined : value)} /><button className="danger-button" onClick={() => void deleteItems(new Set(selected))}><Trash2 size={15} />删除所选</button><button onClick={() => setSelected(new Set())}>取消</button></m.div>}</AnimatePresence>
        <div className="library-table" role="table" aria-label="媒体文件">
          <div className="library-table-head" role="row"><button onClick={() => setSelected((current) => { const next = new Set(current); for (const key of visibleSelectionKeys) { if (allVisibleSelected) next.delete(key); else next.add(key) } return next })} aria-label="全选可见项目">{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button><span>名称</span><span>时长</span><span>大小</span><span>状态</span><span>导入时间</span></div>
          <div ref={tableScrollRef} className="library-table-scroll" data-virtualized="true">{rows.length ? <div className="library-virtual-rows" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>{rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row: MediaLibraryRow = rows[virtualRow.index]
            const rowKey = rowSelectionKey(row)
            const linkedTranscript = row.kind === 'asset' && row.asset.transcriptId ? derived.transcriptById.get(row.asset.transcriptId) : undefined
            const openRow = () => {
              if (row.kind === 'history') onOpenTranscript(row.transcript)
              else if (linkedTranscript) onOpenTranscript(linkedTranscript)
              else setFocusedRowKey(rowKey)
            }
            return <div key={rowKey} className="library-virtual-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
              {row.kind === 'asset' ? <GlassContextMenu ariaLabel={`${row.asset.displayName} 操作`} entries={rowContextEntries(row, rowKey, linkedTranscript)} onOpenChange={(open) => { if (open) { if (!selected.has(rowKey)) setSelected(new Set([rowKey])); setFocusedRowKey(rowKey) } }}><div className={`library-table-row${selected.has(rowKey) ? ' selected' : ''}${focusedRowKey === rowKey ? ' focused' : ''}${draggingKey === rowKey ? ' dragging-item' : ''}`} role="row" tabIndex={0} draggable onDragStart={(event) => { setDraggingKey(rowKey); const keys = selected.has(rowKey) ? selected : new Set([rowKey]); const assetIds = selectionIds(keys, 'asset'); const transcriptIds = selectionIds(keys, 'transcript'); if (assetIds.length) event.dataTransfer.setData('application/x-tingxie-media-ids', JSON.stringify(assetIds)); if (transcriptIds.length) event.dataTransfer.setData('application/x-tingxie-transcript-ids', JSON.stringify(transcriptIds)) }} onDragEnd={() => { setDraggingKey(undefined); setDragTargetId(undefined) }} onClick={openRow} onKeyDown={(event) => { if (event.key === 'Enter') openRow() }}>
                <button className="library-row-select" aria-label={`选择 ${row.asset.displayName}`} onClick={(event) => { event.stopPropagation(); toggle(rowKey); setFocusedRowKey(rowKey) }}>{selected.has(rowKey) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                <div className="library-file-name"><span><FileAudio size={18} /></span><div><strong>{row.asset.displayName}</strong><small>{row.asset.extension}</small></div></div><span>{formatDuration(row.asset.duration || 0)}</span><span>{formatBytes(row.asset.size)}</span><span><i className={`asset-status ${row.asset.transcriptStatus}`}>{statusLabel(row.asset)}</i></span><span>{new Date(row.asset.importedAt).toLocaleDateString()}</span>
              </div></GlassContextMenu> : <GlassContextMenu ariaLabel={`${row.transcript.fileName} 操作`} entries={rowContextEntries(row, rowKey)} onOpenChange={(open) => { if (open) { if (!selected.has(rowKey)) setSelected(new Set([rowKey])); setFocusedRowKey(rowKey) } }}><div className={`library-table-row legacy-transcript-row${selected.has(rowKey) ? ' selected' : ''}${focusedRowKey === rowKey ? ' focused' : ''}${draggingKey === rowKey ? ' dragging-item' : ''}`} role="row" tabIndex={0} draggable onDragStart={(event) => { setDraggingKey(rowKey); const keys = selected.has(rowKey) ? selected : new Set([rowKey]); const transcriptIds = selectionIds(keys, 'transcript'); if (transcriptIds.length) event.dataTransfer.setData('application/x-tingxie-transcript-ids', JSON.stringify(transcriptIds)) }} onDragEnd={() => { setDraggingKey(undefined); setDragTargetId(undefined) }} onClick={openRow} onKeyDown={(event) => { if (event.key === 'Enter') openRow() }}>
                <button className="library-row-select" aria-label={`选择 ${row.transcript.fileName}`} onClick={(event) => { event.stopPropagation(); toggle(rowKey); setFocusedRowKey(rowKey) }}>{selected.has(rowKey) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                <div className="library-file-name"><span><FileText size={18} /></span><div><strong>{row.transcript.fileName}</strong><small>历史转写 · {row.transcript.sourceAvailable ? '可访问原音频' : '仅保留文字'}</small>{row.transcript.sourceAvailable && !derived.linkedTranscriptIds.has(row.id) && onRecoverHistoryMedia ? <button className="legacy-recover-button" onClick={(event) => { event.stopPropagation(); void recoverHistoryMedia(row.transcript) }}>迁入原音频</button> : null}</div></div><span>{formatDuration(row.transcript.duration || 0)}</span><span>{row.transcript.segmentCount} 段</span><span><i className={`asset-status ${row.transcript.outcome === 'failed' ? 'failed' : row.transcript.outcome === 'partial' ? 'partial' : 'transcribed'}`}>{row.transcript.outcome === 'failed' ? '失败记录' : row.transcript.outcome === 'partial' ? '部分完成' : '文字完整'}</i></span><span>{new Date(row.transcript.createdAt).toLocaleDateString()}</span>
              </div></GlassContextMenu>}
            </div>
          })}</div> : <div className="library-empty"><FilePlus2 size={30} /><strong>{deferredQuery ? '没有匹配的媒体或转写' : scope.kind === 'history' ? '还没有历史转写' : '此分组还没有文件'}</strong><span>{deferredQuery ? '尝试更换关键词或状态筛选' : '导入过往录音，或从“新建转写”添加文件'}</span></div>}</div>
        </div>
      </div>
      <LayoutResizeHandle className="library-inspector-resizer" label="调整媒体详情栏宽度" orientation="vertical" value={inspectorPaneWidth} min={210} max={Math.max(210, (libraryShellRef.current?.clientWidth || 1200) - 760)} direction={-1} onResize={(value) => setInspectorPaneWidth(clampLayoutValue('library-inspector', value, libraryShellRef.current?.clientWidth || 1200))} onCommit={(value) => commitLibraryPane('libraryInspectorWidth', clampLayoutValue('library-inspector', value, libraryShellRef.current?.clientWidth || 1200))} onReset={() => { setInspectorPaneWidth(DEFAULT_LIBRARY_INSPECTOR_WIDTH); commitLibraryPane('libraryInspectorWidth', DEFAULT_LIBRARY_INSPECTOR_WIDTH) }} />
      <aside className="library-inspector"><AnimatePresence initial={false} mode="wait"><m.div key={focused?.id || focusedHistory?.id || 'empty'} className="inspector-motion" variants={fade} initial="initial" animate="animate" exit="exit">{focused || focusedHistory ? <>
        <div className="inspector-art">{focused ? <FileAudio size={34} /> : <FileText size={34} />}</div>
        <label>显示名称<AutoGrowNameEditor value={renameDraft} focusRequest={renameFocusRequest} onChange={setRenameDraft} onSave={() => void renameFocused()} onCancel={() => setRenameDraft(focused?.displayName || focusedHistory?.fileName || '')} /></label>
        <button className="soft-button inspector-rename" onClick={() => void renameFocused()}><Pencil size={14} />保存名称</button>
        {focused ? <dl><div><dt>格式</dt><dd>{focused.extension}</dd></div><div><dt>时长</dt><dd>{formatDuration(focused.duration || 0)}</dd></div><div><dt>大小</dt><dd>{formatBytes(focused.size)}</dd></div><div><dt>状态</dt><dd>{statusLabel(focused)}</dd></div></dl> : <dl><div><dt>类型</dt><dd>历史转写</dd></div><div><dt>时长</dt><dd>{formatDuration(focusedHistory?.duration || 0)}</dd></div><div><dt>段落</dt><dd>{focusedHistory?.segmentCount || 0} 段</dd></div><div><dt>音频</dt><dd>{focusedHistory?.sourceAvailable ? '可访问' : '无对应音频'}</dd></div></dl>}
        {focused ? focusedTranscript ? <button className="primary-button" onClick={() => onOpenTranscript(focusedTranscript)}>打开转写</button> : <button className="primary-button" onClick={() => onTranscribe(focused)}>开始转写</button> : focusedHistory ? <><button className="primary-button" onClick={() => onOpenTranscript(focusedHistory)}>打开转写</button>{focusedHistory.sourceAvailable && !derived.linkedTranscriptIds.has(focusedHistory.id) && onRecoverHistoryMedia ? <button className="soft-button" onClick={() => void recoverHistoryMedia(focusedHistory)}>迁入原音频</button> : null}</> : null}
      </> : <div className="inspector-empty"><FileAudio size={30} /><strong>选择一个文件</strong><span>点击左侧方框查看详情；点击其余区域打开转写</span></div>}</m.div></AnimatePresence></aside>
    </section>
    <AnimatePresence initial={false}>{deleteFolder && <m.div variants={fade} initial="initial" animate="animate" exit="exit" className="modal-backdrop folder-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteFolderId(undefined) }}><m.section variants={dialogPanel} initial="initial" animate="animate" exit="exit" className="folder-delete-dialog glass-card" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title"><div className="delete-folder-icon"><Trash2 size={21} /></div><h2 id="delete-folder-title">删除“{deleteFolder.name}”</h2><p>包含 {deleteDescendants.size} 个子文件夹、{deleteAssetCount} 个媒体文件、{deleteTranscriptCount} 条纯文字转写。文字转写会安全移到上一级；请选择媒体文件的处理方式。</p><button className="secondary-button" onClick={() => void deleteFolderWithMode(deleteFolder, 'preserve-content')}>仅删除文件夹，内容移到上一级</button><button className="danger-button" onClick={() => void deleteFolderWithMode(deleteFolder, 'delete-media')}>删除文件夹及其媒体文件</button><button className="text-button" onClick={() => setDeleteFolderId(undefined)}>取消</button></m.section></m.div>}</AnimatePresence>
  </m.main>
})
