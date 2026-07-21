import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MediaLibrarySnapshot, TranscriptResult } from '../../electron/types'
import { summarizeTranscript } from '../../electron/transcript-summary'
import { MediaLibraryView } from './MediaLibraryView'

describe('legacy transcript recovery', () => {
  it('keeps old transcript records visible when the managed media library is empty', () => {
    const library: MediaLibrarySnapshot = { rootPath: 'D:\\听写媒体库', folders: [], assets: [] }
    const oldTranscript: TranscriptResult = {
      id: 'legacy-1',
      fileName: '2026年07月15日 19点01分.m4a',
      createdAt: '2026-07-18T08:46:09.816Z',
      text: '仍然存在的旧转写文字',
      duration: 3600,
      segments: [{ start: 0, text: '仍然存在的旧转写文字' }],
      sourcePath: 'D:\\Downloads\\2026年07月15日 19点01分.m4a',
    }

    const markup = renderToStaticMarkup(<MediaLibraryView
      library={library}
      history={[summarizeTranscript(oldTranscript)]}
      onLibraryChange={() => undefined}
      onOpenTranscript={() => undefined}
      onTranscribe={() => undefined}
      onImportFiles={() => undefined}
      onImportFolder={() => undefined}
    />)

    expect(markup).toContain('历史转写')
    expect(markup).toContain('2026年07月15日 19点01分.m4a')
    expect(markup).toContain('选择 2026年07月15日 19点01分.m4a')
  })

  it('virtualizes a 10,000 item media library instead of mounting every row', () => {
    const library: MediaLibrarySnapshot = {
      rootPath: 'D:\\library',
      folders: [],
      assets: Array.from({ length: 10_000 }, (_, index) => ({
        id: `asset-${index}`,
        displayName: `Recording ${index}.m4a`,
        originalName: `Recording ${index}.m4a`,
        relativePath: `media/asset-${index}.m4a`,
        size: 1024,
        extension: 'M4A',
        transcriptStatus: 'untranscribed' as const,
        managed: true,
        importedAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      })),
    }

    const markup = renderToStaticMarkup(<MediaLibraryView
      library={library}
      history={[]}
      onLibraryChange={() => undefined}
      onOpenTranscript={() => undefined}
      onTranscribe={() => undefined}
      onImportFiles={() => undefined}
      onImportFolder={() => undefined}
    />)

    expect(markup).toContain('data-virtualized="true"')
    expect(markup).toContain('Recording 0.m4a')
    expect(markup).not.toContain('Recording 9999.m4a')
  })

  it('shows staged import progress instead of leaving a large import looking stalled', () => {
    const markup = renderToStaticMarkup(<MediaLibraryView
      library={{ rootPath: 'D:\\library', folders: [], assets: [] }}
      history={[]}
      importProgress={{ stage: 'copying', completed: 25, total: 100, detail: '正在复制媒体 25/100' }}
      onLibraryChange={() => undefined}
      onOpenTranscript={() => undefined}
      onTranscribe={() => undefined}
      onImportFiles={() => undefined}
      onImportFolder={() => undefined}
    />)

    expect(markup).toContain('正在复制媒体 25/100')
    expect(markup).toContain('<progress')
  })

  it('renders nested folders with explicit management controls', () => {
    const markup = renderToStaticMarkup(<MediaLibraryView
      library={{
        rootPath: 'D:\\library',
        folders: [
          { id: 'parent', name: '项目资料', createdAt: 'now', updatedAt: 'now' },
          { id: 'child', parentId: 'parent', name: '访谈录音', createdAt: 'now', updatedAt: 'now' },
        ],
        assets: [],
      }}
      history={[]}
      onLibraryChange={() => undefined}
      onOpenTranscript={() => undefined}
      onTranscribe={() => undefined}
      onImportFiles={() => undefined}
      onImportFolder={() => undefined}
    />)

    expect(markup).toContain('data-folder-depth="1"')
    expect(markup).toContain('aria-label="根文件夹名称"')
    expect(markup).toContain('创建根文件夹')
    expect(markup).not.toContain('folder-action-menu')
  })
})
