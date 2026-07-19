import { describe, expect, it } from 'vitest'
import { resolveProviderSystemPrompt } from './ai-provider-defaults'

describe('AI provider system prompt recovery', () => {
  it('restores the built-in prompt when a stored provider lost the field', () => {
    expect(resolveProviderSystemPrompt(undefined, '内置完整提示词')).toBe('内置完整提示词')
    expect(resolveProviderSystemPrompt('   ', '内置完整提示词')).toBe('内置完整提示词')
  })

  it('preserves a user-customized prompt', () => {
    expect(resolveProviderSystemPrompt('  我的自定义提示词  ', '内置完整提示词')).toBe('  我的自定义提示词  ')
  })
})
