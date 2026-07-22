import { describe, expect, it } from 'vitest'
import { clampLayoutValue } from './layout-resize'

describe('primary layout resize bounds', () => {
  it('keeps the main sidebar usable without consuming the workspace', () => {
    expect(clampLayoutValue('sidebar', 90, 1440)).toBe(150)
    expect(clampLayoutValue('sidebar', 500, 1440)).toBe(280)
  })

  it('keeps upload, library list and inspector regions visible in the available space', () => {
    expect(clampLayoutValue('upload', 600, 700)).toBe(410)
    expect(clampLayoutValue('library-folder', 500, 1080)).toBe(360)
    expect(clampLayoutValue('library-inspector', 500, 1080)).toBe(320)
  })
})
