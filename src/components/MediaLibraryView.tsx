import { CheckSquare, FileAudio, FileClock, FilePlus2, FileText, Folder, FolderInput, FolderPlus, Library, Search, Square, Trash2, Upload, X } from 'lucide-react'
import { memo, useDeferredValue, useMemo, useState } from 'react'
import type { MediaAsset, MediaLibrarySnapshot, TranscriptSummary } from '../../electron/types'
import { formatBytes, formatDuration } from '../utils'

interface MediaLibraryViewProps {
  library: MediaLibrarySnapshot
  history: TranscriptSummary[]
  onLibraryChange(library: MediaLibrarySnapshot): void
  onOpenTranscript(result: TranscriptSummary): void
  onTranscribe(asset: MediaAsset): void
  onImportFiles(folderId?: string): void
  onImportFolder(folderId?: string): void
  onRecoverHistoryMedia?(result: TranscriptSummary): Promise<void>
}

type Scope = 'all' | 'unfiled' | string

function statusLabel(asset: MediaAsset): string {
  if (asset.transcriptStatus === 'transcribed') return '已转写'
  if (asset.transcriptStatus === 'partial') return '部分完成'
  if (asset.transcriptStatus === 'failed') return '转写失败'
  return '未转写'
}

export const MediaLibraryView = memo(function MediaLibraryView({ library, history, onLibraryChange, onOpenTranscript, onTranscribe, onImportFiles, onImportFolder, onRecoverHistoryMedia }: MediaLibraryViewProps) {
  const [scope, setScope] = useState<Scope>('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | MediaAsset['transcriptStatus']>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const linkedTranscriptIds = useMemo(() => new Set(library.assets.map((asset) => asset.transcriptId).filter(Boolean)), [library.assets])
  const unlinkedHistory = useMemo(() => history.filter((item) => !linkedTranscriptIds.has(item.id)), [history, linkedTranscriptIds])

  const visible = useMemo(() => library.assets.filter((asset) => {
    const inScope = scope === 'all' || (scope === 'unfiled' ? !asset.folderId : asset.folderId === scope)
    const hasStatus = status === 'all' || asset.transcriptStatus === status
    const matches = !deferredQuery || `${asset.displayName} ${asset.originalName} ${asset.extension}`.toLocaleLowerCase().includes(deferredQuery)
    return inScope && hasStatus && matches
  }), [library.assets, scope, status, deferredQuery])
  const visibleHistory = useMemo(() => {
    const candidates = scope === 'history' ? history : scope === 'all' ? unlinkedHistory : []
    return candidates.filter((item) => {
      const itemStatus = item.outcome === 'failed' ? 'failed' : item.outcome === 'partial' ? 'partial' : 'transcribed'
      const hasStatus = status === 'all' || status === itemStatus
      const matches = !deferredQuery || `${item.fileName} ${item.preview}`.toLocaleLowerCase().includes(deferredQuery)
      return hasStatus && matches
    })
  }, [history, unlinkedHistory, scope, status, deferredQuery])

  const focused = library.assets.find((asset) => asset.id === selected.at(-1))
  const allVisibleSelected = visible.length > 0 && visible.every((asset) => selected.includes(asset.id))

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name || !window.tingxie) return
    onLibraryChange(await window.tingxie.createMediaFolder(name))
    setNewFolderName('')
  }

  async function move(folderId?: string) {
    if (!selected.length || !window.tingxie) return
    onLibraryChange(await window.tingxie.moveMediaAssets(selected, folderId))
  }

  async function removeSelected() {
    if (!selected.length || !window.tingxie || !window.confirm(`确定从媒体库永久删除选中的 ${selected.length} 个文件吗？`)) return
    onLibraryChange(await window.tingxie.deleteMediaAssets(selected))
    setSelected([])
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
          <button className={scope === 'all' ? 'folder-row active' : 'folder-row'} onClick={() => setScope('all')}><Library size={16} /><span>全部文件</span><b>{library.assets.length + unlinkedHistory.length}</b></button>
          <button className={scope === 'history' ? 'folder-row active' : 'folder-row'} onClick={() => { setScope('history'); setSelected([]) }}><FileClock size={16} /><span>历史转写</span><b>{history.length}</b></button>
          <button className={scope === 'unfiled' ? 'folder-row active' : 'folder-row'} onClick={() => setScope('unfiled')}><Folder size={16} /><span>未分组</span><b>{library.assets.filter((asset) => !asset.folderId).length}</b></button>
          {library.folders.map((folder) => <button key={folder.id} className={scope === folder.id ? 'folder-row active' : 'folder-row'} onClick={() => setScope(folder.id)}><Folder size={16} /><span>{folder.name}</span><b>{library.assets.filter((asset) => asset.folderId === folder.id).length}</b></button>)}
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
          {recoveryMessage && <div className="library-recovery-message" role="status">{recoveryMessage}</div>}
          {selected.length > 0 && <div className="batch-bar">
            <span><CheckSquare size={16} />已选择 {selected.length} 项</span>
            <label><FolderInput size={15} /><select defaultValue="" onChange={(event) => { void move(event.target.value === '__root' ? undefined : event.target.value); event.target.value = '' }}><option value="" disabled>移动到…</option><option value="__root">未分组</option>{library.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <button className="danger-button" onClick={() => void removeSelected()}><Trash2 size={15} />删除</button>
            <button onClick={() => setSelected([])}>取消</button>
          </div>}
          <div className="library-table" role="table" aria-label="媒体文件">
            <div className="library-table-head" role="row">
              <button onClick={() => setSelected(allVisibleSelected ? selected.filter((id) => !visible.some((asset) => asset.id === id)) : [...new Set([...selected, ...visible.map((asset) => asset.id)])])} aria-label="全选可见文件">{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>
              <span>名称</span><span>时长</span><span>大小</span><span>状态</span><span>导入时间</span>
            </div>
            {visible.map((asset) => <div key={asset.id} className={`library-table-row${selected.includes(asset.id) ? ' selected' : ''}`} role="row" onClick={() => toggle(asset.id)}>
              <button aria-label={`选择 ${asset.displayName}`}>{selected.includes(asset.id) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
              <div className="library-file-name"><span><FileAudio size={18} /></span><div><strong>{asset.displayName}</strong><small>{asset.extension}</small></div></div>
              <span>{formatDuration(asset.duration || 0)}</span><span>{formatBytes(asset.size)}</span><span><i className={`asset-status ${asset.transcriptStatus}`}>{statusLabel(asset)}</i></span><span>{new Date(asset.importedAt).toLocaleDateString()}</span>
            </div>)}
            {visibleHistory.map((item) => <div key={`history-${item.id}`} className="library-table-row legacy-transcript-row" role="row">
              <button aria-label={`打开转写：${item.fileName}`} title="打开转写" onClick={() => onOpenTranscript(item)}><FileText size={16} /></button>
              <div className="library-file-name"><span><FileText size={18} /></span><div><strong>{item.fileName}</strong><small>历史转写 · 文字已恢复</small>{item.sourceAvailable && !linkedTranscriptIds.has(item.id) && onRecoverHistoryMedia ? <button className="legacy-recover-button" onClick={() => void recoverHistoryMedia(item)}>迁入原音频</button> : null}</div></div>
              <span>{formatDuration(item.duration || 0)}</span><span>{item.segmentCount} 段</span><span><i className={`asset-status ${item.outcome === 'failed' ? 'failed' : item.outcome === 'partial' ? 'partial' : 'transcribed'}`}>{item.outcome === 'failed' ? '失败记录' : item.outcome === 'partial' ? '部分完成' : '文字完整'}</i></span><span>{new Date(item.createdAt).toLocaleDateString()}</span>
            </div>)}
            {!visible.length && !visibleHistory.length && <div className="library-empty"><FilePlus2 size={30} /><strong>{deferredQuery ? '没有匹配的媒体或转写' : scope === 'history' ? '还没有历史转写' : '此分组还没有文件'}</strong><span>{deferredQuery ? '尝试更换关键词或状态筛选' : scope === 'history' ? '旧版本转写记录会安全显示在这里' : '导入过往录音，或从“新建转写”添加文件'}</span></div>}
          </div>
        </div>

        <aside className="library-inspector">
          {focused ? <>
            <div className="inspector-art"><FileAudio size={34} /></div>
            <label>显示名称<input defaultValue={focused.displayName} key={focused.id} onBlur={(event) => void renameFocused(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
            <dl><div><dt>格式</dt><dd>{focused.extension}</dd></div><div><dt>时长</dt><dd>{formatDuration(focused.duration || 0)}</dd></div><div><dt>大小</dt><dd>{formatBytes(focused.size)}</dd></div><div><dt>状态</dt><dd>{statusLabel(focused)}</dd></div></dl>
            {focused.transcriptId && history.some((item) => item.id === focused.transcriptId)
              ? <button className="primary-button" onClick={() => onOpenTranscript(history.find((item) => item.id === focused.transcriptId)!)}>打开转写</button>
              : <button className="primary-button" onClick={() => onTranscribe(focused)}>开始转写</button>}
          </> : <div className="inspector-empty">{scope === 'history' ? <FileClock size={30} /> : <FileAudio size={30} />}<strong>{scope === 'history' ? '历史转写已恢复' : '选择一个文件'}</strong><span>{scope === 'history' ? '点击每条记录左侧的文档图标即可打开完整文字' : '查看详情、重命名或打开转写'}</span></div>}
        </aside>
      </section>
    </main>
  )
})
