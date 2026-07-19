import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MediaAsset, MediaFolder, SelectedMedia } from './types'

export interface MediaLibraryIndex {
  version: 1
  folders: MediaFolder[]
  assets: MediaAsset[]
}

export interface ImportMediaAssetsOptions {
  index: MediaLibraryIndex
  libraryRoot: string
  sources: SelectedMedia[]
  folderId?: string
  createId(): string
  now(): string
  copyConcurrency?: number
  onCopyProgress?(completed: number, total: number): void
}

export interface ImportMediaAssetsResult {
  index: MediaLibraryIndex
  imported: MediaAsset[]
  duplicates: MediaAsset[]
}

function safeExtension(name: string): string {
  return path.extname(name).toLocaleLowerCase().replace(/[^.a-z0-9]/g, '')
}

export function mediaSourceSignature(source: Pick<SelectedMedia, 'path' | 'name' | 'size'>): string {
  return `${source.size}\0${source.name.toLocaleLowerCase()}\0${path.resolve(source.path).toLocaleLowerCase()}`
}

function assetSourceSignature(asset: MediaAsset): string | undefined {
  if (!asset.originalPath) return undefined
  return mediaSourceSignature({ path: asset.originalPath, name: asset.originalName, size: asset.size })
}

async function copyWithConcurrency<T>(items: T[], concurrency: number, copy: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  let firstError: unknown
  async function worker() {
    while (!firstError) {
      const index = cursor++
      if (index >= items.length) return
      try {
        await copy(items[index])
      } catch (error) {
        firstError = error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()))
  if (firstError) throw firstError
}

export function resolveManagedMediaPath(libraryRoot: string, asset: MediaAsset): string {
  const root = path.resolve(libraryRoot)
  const resolved = path.resolve(root, asset.relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('媒体库路径越界')
  return resolved
}

export async function importMediaAssets({
  index,
  libraryRoot,
  sources,
  folderId,
  createId,
  now,
  copyConcurrency = 2,
  onCopyProgress,
}: ImportMediaAssetsOptions): Promise<ImportMediaAssetsResult> {
  const imported: MediaAsset[] = []
  const duplicates: MediaAsset[] = []
  const mediaDir = path.join(libraryRoot, 'media')
  await fs.mkdir(mediaDir, { recursive: true })
  const signatures = new Map<string, MediaAsset>()
  for (const asset of index.assets) {
    const signature = assetSourceSignature(asset)
    if (signature) signatures.set(signature, asset)
  }
  const planned: Array<{ source: SelectedMedia; asset: MediaAsset; destination: string; temporary: string }> = []

  for (const source of sources) {
    const signature = mediaSourceSignature(source)
    const duplicate = signatures.get(signature)
    if (duplicate) {
      duplicates.push(duplicate)
      continue
    }
    const id = createId()
    const extension = safeExtension(source.name)
    const relativePath = path.join('media', `${id}${extension}`)
    const destination = path.join(libraryRoot, relativePath)
    const temporary = `${destination}.part`
    const timestamp = now()
    const asset: MediaAsset = {
      id,
      displayName: source.name,
      originalName: source.name,
      relativePath,
      size: source.size,
      extension: extension.replace(/^\./, '').toLocaleUpperCase(),
      ...(folderId ? { folderId } : {}),
      transcriptStatus: 'untranscribed',
      managed: true,
      importedAt: timestamp,
      updatedAt: timestamp,
      originalPath: path.resolve(source.path),
    }
    imported.push(asset)
    signatures.set(signature, asset)
    planned.push({ source, asset, destination, temporary })
  }

  let completed = duplicates.length
  onCopyProgress?.(completed, sources.length)
  try {
    await copyWithConcurrency(planned, copyConcurrency, async ({ source, asset, destination, temporary }) => {
      const sourceStat = await fs.stat(source.path)
      await fs.copyFile(source.path, temporary)
      const copied = await fs.stat(temporary)
      if (copied.size !== sourceStat.size) throw new Error(`媒体复制校验失败：${source.name}`)
      await fs.rename(temporary, destination)
      asset.size = sourceStat.size
      completed += 1
      onCopyProgress?.(completed, sources.length)
    })
  } catch (error) {
    await Promise.all(planned.flatMap(({ destination, temporary }) => [destination, temporary]).map((file) => fs.rm(file, { force: true }).catch(() => undefined)))
    throw error
  }

  return { index: { ...index, assets: [...index.assets, ...imported] }, imported, duplicates }
}

export function createMediaFolder(index: MediaLibraryIndex, folder: MediaFolder): MediaLibraryIndex {
  const name = folder.name.trim()
  if (!name) throw new Error('文件夹名称不能为空')
  if (folder.parentId && !index.folders.some((item) => item.id === folder.parentId)) throw new Error('上级文件夹不存在')
  const duplicate = index.folders.some((item) => item.parentId === folder.parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (duplicate) throw new Error('同级已有同名文件夹')
  return { ...index, folders: [...index.folders, { ...folder, name }] }
}

export function renameMediaFolder(index: MediaLibraryIndex, id: string, name: string, updatedAt: string): MediaLibraryIndex {
  const folder = index.folders.find((item) => item.id === id)
  if (!folder) throw new Error('文件夹不存在')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名称不能为空')
  if (index.folders.some((item) => item.id !== id && item.parentId === folder.parentId && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw new Error('同级已有同名文件夹')
  }
  return { ...index, folders: index.folders.map((item) => item.id === id ? { ...item, name: trimmed, updatedAt } : item) }
}

export function renameMediaAsset(index: MediaLibraryIndex, id: string, displayName: string, updatedAt: string): MediaLibraryIndex {
  const trimmed = displayName.trim()
  if (!trimmed) throw new Error('录音名称不能为空')
  if (!index.assets.some((item) => item.id === id)) throw new Error('录音不存在')
  return { ...index, assets: index.assets.map((item) => item.id === id ? { ...item, displayName: trimmed, updatedAt } : item) }
}

export function moveMediaAssets(index: MediaLibraryIndex, assetIds: string[], folderId: string | undefined, updatedAt: string): MediaLibraryIndex {
  if (folderId && !index.folders.some((item) => item.id === folderId)) throw new Error('目标文件夹不存在')
  const ids = new Set(assetIds)
  return {
    ...index,
    assets: index.assets.map((item) => ids.has(item.id)
      ? { ...item, ...(folderId ? { folderId } : { folderId: undefined }), updatedAt }
      : item),
  }
}

export function linkTranscriptToAsset(index: MediaLibraryIndex, assetId: string, transcriptId: string, status: MediaAsset['transcriptStatus'], updatedAt: string): MediaLibraryIndex {
  return {
    ...index,
    assets: index.assets.map((asset) => asset.id === assetId
      ? { ...asset, transcriptId, transcriptStatus: status, updatedAt }
      : asset),
  }
}
