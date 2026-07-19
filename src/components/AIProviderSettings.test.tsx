import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AISettings } from '../../electron/types'
import { AIProviderSettings } from './AIProviderSettings'

const settings: AISettings = {
  providers: [{
    id: 'mimo-payg',
    name: '小米 MiMo（按量）',
    kind: 'mimo-payg',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    systemPrompt: '完整系统提示词',
    hasApiKey: true,
    builtIn: true,
  }],
  selectedProviderId: 'mimo-payg',
  tokenPlanAcknowledged: false,
  defaultSystemPrompt: '完整系统提示词',
}

describe('AI provider settings typography', () => {
  it('connects the system prompt editor to the AI conversation font setting', () => {
    const markup = renderToStaticMarkup(<AIProviderSettings
      settings={settings}
      onChange={() => undefined}
      onSave={async () => settings}
      onDelete={async () => settings}
      onSelect={async () => settings}
      onTest={async () => undefined}
    />)
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

    expect(markup).toContain('aria-label="系统提示词"')
    expect(markup).toContain('class="provider-system-prompt"')
    expect(css).toMatch(/\.provider-field textarea\s*\{[^}]*font-size:\s*var\(--chat-font-size\)/s)
  })
})
