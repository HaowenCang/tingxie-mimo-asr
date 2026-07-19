import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AISettings } from '../electron/types'
import { loadStartupData } from './startup-data'

describe('startup data loading', () => {
  it('keeps AI settings available when history loading fails', async () => {
    const aiSettings: AISettings = {
      providers: [{ id: 'mimo-payg', name: 'MiMo', kind: 'mimo-payg', baseUrl: 'https://example.com/v1', model: 'mimo-v2.5', contextWindow: 1_048_576, maxOutputTokens: 8192, systemPrompt: '完整系统提示词', hasApiKey: true, builtIn: true }],
      selectedProviderId: 'mimo-payg',
      tokenPlanAcknowledged: false,
      defaultSystemPrompt: '完整系统提示词',
    }
    const result = await loadStartupData({
      getSettings: vi.fn().mockResolvedValue({ hasApiKey: true, language: 'auto', serviceMode: 'payg', configuredServices: ['payg'], adaptiveConcurrency: true, preferences: DEFAULT_APP_PREFERENCES, mediaLibraryRoot: 'D:/media' }),
      getHistory: vi.fn().mockRejectedValue(new Error('history unavailable')),
      getAISettings: vi.fn().mockResolvedValue(aiSettings),
      getMediaLibrary: vi.fn().mockResolvedValue({ rootPath: 'D:/media', folders: [], assets: [] }),
    })

    expect(result.aiSettings).toBe(aiSettings)
    expect(result.history).toBeUndefined()
    expect(result.errors.map((item) => item.resource)).toContain('history')
  })
})
