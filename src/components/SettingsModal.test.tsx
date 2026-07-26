import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AISettings } from '../../electron/types'
import { SettingsModal } from './SettingsModal'

const aiSettings: AISettings = {
  providers: [],
  selectedProviderId: '',
  tokenPlanAcknowledged: false,
  defaultSystemPrompt: '',
}

function renderPreparationSettings(preferences = DEFAULT_APP_PREFERENCES) {
  return renderToStaticMarkup(<SettingsModal
    configuredServices={[]}
    language="auto"
    serviceMode="payg"
    adaptiveConcurrency
    aiSettings={aiSettings}
    preferences={preferences}
    mediaLibraryRoot="D:\\library"
    initialSection="personalize"
    onClose={() => undefined}
    onSave={async () => undefined}
    onSavePreferences={async () => undefined}
    onChooseMediaLibraryRoot={async () => undefined}
    onTest={async () => undefined}
    onAISettingsChange={() => undefined}
    onSaveAIProvider={async () => aiSettings}
    onDeleteAIProvider={async () => aiSettings}
    onSelectAIProvider={async () => aiSettings}
    onTestAIProvider={async () => undefined}
  />)
}

describe('local preparation settings', () => {
  it('renders an arbitrary positive fixed concurrency without the former upper bound', () => {
    const markup = renderPreparationSettings({
      ...DEFAULT_APP_PREFERENCES,
      preparationMode: 'fixed',
      preparationConcurrency: 37,
    })

    expect(markup).toContain('aria-label="同时准备的音频数"')
    expect(markup).toContain('value="37"')
    expect(markup).not.toContain('max="4"')
  })

  it('shows the resource warning in unlimited mode and hides the numeric input', () => {
    const markup = renderPreparationSettings({
      ...DEFAULT_APP_PREFERENCES,
      preparationMode: 'unlimited',
      preparationConcurrency: 37,
    })

    expect(markup).toContain('无限制模式不设置应用级并行上限')
    expect(markup).toContain('API 转写仍严格按媒体队列顺序执行')
    expect(markup).not.toContain('aria-label="同时准备的音频数"')
  })
})
