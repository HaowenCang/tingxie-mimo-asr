import { describe, expect, it } from 'vitest'
import type { AIMessage } from '../../electron/types'
import { isNearConversationBottom, shouldRenderMessageMarkdown, visibleAIMessageWindow } from './ai-chat-view-model'

const messages: AIMessage[] = Array.from({ length: 120 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 ? 'assistant' : 'user',
  content: `message ${index}`,
  createdAt: '2026-07-21T00:00:00.000Z',
}))

describe('AI chat view model', () => {
  it('mounts only the recent message window until the user expands history', () => {
    const windowed = visibleAIMessageWindow(messages, false)
    expect(windowed.hiddenCount).toBe(80)
    expect(windowed.messages).toHaveLength(40)
    expect(windowed.messages[0].id).toBe('message-80')
    expect(visibleAIMessageWindow(messages, true)).toEqual({ messages, hiddenCount: 0 })
  })

  it('only considers the conversation sticky when the viewport is near its bottom', () => {
    expect(isNearConversationBottom({ scrollTop: 780, clientHeight: 200, scrollHeight: 1_000 })).toBe(true)
    expect(isNearConversationBottom({ scrollTop: 520, clientHeight: 200, scrollHeight: 1_000 })).toBe(false)
  })

  it('defers Markdown parsing until an assistant stream is complete', () => {
    expect(shouldRenderMessageMarkdown({ id: 'streaming', role: 'assistant', content: '## partial', createdAt: 'now' })).toBe(false)
    expect(shouldRenderMessageMarkdown({ id: 'complete', role: 'assistant', content: '## complete', createdAt: 'now' })).toBe(true)
    expect(shouldRenderMessageMarkdown({ id: 'user', role: 'user', content: '## literal', createdAt: 'now' })).toBe(false)
  })
})
