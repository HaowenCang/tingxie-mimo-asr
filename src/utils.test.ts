import { describe, expect, it } from 'vitest'
import { extensionOf, formatBytes, formatDuration, friendlyIpcError, statusLabel } from './utils'

describe('format helpers', () => {
  it('formats media durations with and without hours', () => {
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3665)).toBe('01:01:05')
  })

  it('formats file sizes and extensions for queue metadata', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(extensionOf('meeting.final.mp4')).toBe('MP4')
  })

  it('uses progress detail before the fallback status label', () => {
    expect(statusLabel('extracting', '正在提取音频 42%')).toBe('正在提取音频 42%')
    expect(statusLabel('done')).toBe('转写完成')
  })

  it('removes Electron IPC boilerplate from user-facing errors', () => {
    expect(friendlyIpcError(new Error("Error invoking remote method 'ai:analysis:generate': Error: AI 未返回 JSON 对象"), '失败')).toBe('AI 未返回 JSON 对象')
  })
})
