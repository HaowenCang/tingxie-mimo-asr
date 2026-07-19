import { describe, expect, it } from 'vitest'
import { chatPanelWidthBounds, clampChatPanelWidth } from './PanelResizeHandle'

describe('AI chat panel width bounds', () => {
  it('protects the transcript width in compact windows', () => {
    expect(chatPanelWidthBounds(1080)).toEqual({ min: 340, max: 398 })
    expect(clampChatPanelWidth(720, 1080)).toBe(398)
  })

  it('allows a wider chat panel when space is available', () => {
    expect(chatPanelWidthBounds(1920)).toEqual({ min: 340, max: 720 })
    expect(clampChatPanelWidth(560, 1920)).toBe(560)
  })

  it('never shrinks below the readable minimum', () => {
    expect(clampChatPanelWidth(120, 1280)).toBe(340)
  })
})
