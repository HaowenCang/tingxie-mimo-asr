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
}

export interface ImportMediaAssetsResult {
  index: MediaLibraryIndex
  imported: MediaAsset[]
  duplicates: MediaAsset[]
}

function safeExtension(name: string): string {
  return path.extname(name).toLocaleLowerCase().replace(/[^.a-z0-9]/g, '')
}

function sameSource(asset: MediaAsset, source: SelectedMedia): boolean {
  return asset.size === source.size
    && asset.originalName.toLocaleLowerCase() === source.name.toLocaleLowerCase()
    && asset.originalPath?.toLocaleLowerCase() === path.resolve(source.path).toLocaleLowerCase()
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
}: ImportMediaAssetsOptions): Promise<ImportMediaAssetsResult> {
  const imported: MediaAsset[] = []
  const duplicates: MediaAsset[] = []
  const nextAssets = [...index.assets]
  const mediaDir = path.join(libraryRoot, 'media')
  await fs.mkdir(mediaDir, { recursive: true })

  for (const source of sources) {
    const duplicate = nextAssets.find((asset) => sameSource(asset, source))
    if (duplicate) {
      duplicates.push(duplicate)
      continue
    }
    const sourceStat = await fs.stat(source.path)
    const id = createId()
    const extension = safeExtension(source.name)
    const relativePath = path.join('media', `${id}${extension}`)
    const destination = path.join(libraryRoot, relativePath)
    const temporary = `${destination}.part`
    try {
      await fs.copyFile(source.path, temporary)
      const copied = await fs.stat(temporary)
      if (copied.size !== sourceStat.size) throw new Error(`媒体复制校验失败：${source.name}`)
      await fs.rename(temporary, destination)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    const timestamp = now()
    const asset: MediaAsset = {
      id,
      displayName: source.name,
      originalName: source.name,
      relativePath,
      size: sourceStat.size,
      extension: extension.replace(/^\./, '').toLocaleUpperCase(),
      ...(folderId ? { folderId } : {}),
      transcriptStatus: 'untranscribed',
      managed: true,
      importedAt: timestamp,
      updatedAt: timestamp,
      originalPath: path.resolve(source.path),
    }
    imported.push(asset)
    nextAssets.push(asset)
  }

  return { index: { ...index, assets: nextAssets }, imported, duplicates }
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
