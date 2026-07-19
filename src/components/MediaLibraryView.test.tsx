import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MediaLibrarySnapshot, TranscriptResult } from '../../electron/types'
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
      history={[oldTranscript]}
      onLibraryChange={() => undefined}
      onOpenTranscript={() => undefined}
      onTranscribe={() => undefined}
      onImportFiles={() => undefined}
      onImportFolder={() => undefined}
    />)

    expect(markup).toContain('历史转写')
    expect(markup).toContain('2026年07月15日 19点01分.m4a')
    expect(markup).toContain('打开转写')
  })
})
