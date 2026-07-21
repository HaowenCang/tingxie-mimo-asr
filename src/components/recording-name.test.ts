import { describe, expect, it } from 'vitest'
import { normalizeRecordingName } from './recording-name'

describe('recording name editor', () => {
  it('stores a visually wrapped multi-line draft as one normalized display name', () => {
    expect(normalizeRecordingName('很长的录音名称\n第二行继续显示\n\n第三行')).toBe('很长的录音名称 第二行继续显示 第三行')
  })
})
