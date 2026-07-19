import { Eye, EyeOff, KeyRound, LoaderCircle, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { AIProvider, AISettings } from '../../electron/types'

interface AIProviderSettingsProps {
  settings: AISettings
  onChange(settings: AISettings): void
  onSave(input: { provider: AIProvider; apiKey?: string }): Promise<AISettings>
  onDelete(id: string): Promise<AISettings>
  onSelect(id: string): Promise<AISettings>
  onTest(input: { provider: AIProvider; apiKey?: string }): Promise<void>
}

const DEFAULT_BASE_URLS = {
  'mimo-payg': 'https://api.xiaomimimo.com/v1',
  'mimo-token-plan': 'https://token-plan-cn.xiaomimimo.com/v1',
}

function selectedProvider(settings: AISettings): AIProvider {
  return settings.providers.find((provider) => provider.id === settings.selectedProviderId) || settings.providers[0]
}

export const AIProviderSettings = memo(function AIProviderSettings({ settings, onChange, onSave, onDelete, onSelect, onTest }: AIProviderSettingsProps) {
  const [draft, setDraft] = useState<AIProvider>(() => selectedProvider(settings))
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | 'select' | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setDraft(selectedProvider(settings))
    setApiKey('')
  }, [settings.selectedProviderId, settings.providers])

  async function chooseProvider(id: string) {
    setBusy('select'); setMessage('')
    try {
      const next = await onSelect(id)
      onChange(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '切换失败')
    } finally {
      setBusy(null)
    }
  }

  function addProvider() {
    setDraft({
      id: '',
      name: '自定义 Provider',
      kind: 'openai-compatible',
      baseUrl: '',
      model: '',
      contextWindow: 128_000,
      maxOutputTokens: 4096,
      systemPrompt: settings.defaultSystemPrompt,
      hasApiKey: false,
      builtIn: false,
    })
    setApiKey('')
    setMessage('')
  }

  function resetBuiltIn() {
    if (draft.kind === 'openai-compatible') return
    const baseUrl = DEFAULT_BASE_URLS[draft.kind]
    setDraft((current) => ({
      ...current,
      baseUrl,
      model: 'mimo-v2.5',
      contextWindow: 1_048_576,
      maxOutputTokens: 8192,
      systemPrompt: settings.defaultSystemPrompt,
    }))
    setMessage('已恢复内置默认值，保存后生效')
  }

  async function save() {
    setBusy('save'); setMessage('')
    try {
      const next = await onSave({ provider: draft, apiKey: apiKey || undefined })
      onChange(next)
      setApiKey('')
      setMessage('AI Provider 设置已安全保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test'); setMessage('')
    try {
      await onTest({ provider: draft, apiKey: apiKey || undefined })
      setMessage('连接成功，Provider 可用')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (draft.builtIn || !draft.id || !window.confirm(`确定删除“${draft.name}”吗？`)) return
    setBusy('delete'); setMessage('')
    try {
      const next = await onDelete(draft.id)
      onChange(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  const canUseStoredKey = Boolean(draft.id && draft.hasApiKey)
  const disabled = busy !== null

  return <div className="ai-provider-settings">
    <div className="provider-toolbar">
      <label><span>当前 Provider</span><select value={draft.id && settings.providers.some((provider) => provider.id === draft.id) ? draft.id : ''} disabled={busy === 'select'} onChange={(event) => chooseProvider(event.target.value)}>
        {!draft.id && <option value="">新建自定义 Provider</option>}
        {settings.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
      </select></label>
      <button className="secondary-button compact-button" onClick={addProvider} disabled={disabled}><Plus size={15} />新增</button>
      {!draft.builtIn && draft.id && <button className="danger-icon-button" aria-label="删除自定义 Provider" onClick={remove} disabled={disabled}><Trash2 size={16} /></button>}
    </div>

    {draft.kind === 'mimo-token-plan' && <div className="token-plan-note"><ShieldAlert size={17} /><span>Token Plan 官方限定于 Coding 场景。首次用于转写 AI 对话时，应用会要求用户确认使用范围。</span></div>}

    <div className="provider-form-grid">
      <label className="provider-field"><span>名称</span><input value={draft.name} disabled={draft.builtIn} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="provider-field"><span>Model ID</span>{draft.builtIn
        ? <select value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}><option value="mimo-v2.5">mimo-v2.5</option><option value="mimo-v2.5-pro">mimo-v2.5-pro</option></select>
        : <input value={draft.model} placeholder="例如 gpt-4.1-mini" onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} />}</label>
      <label className="provider-field wide"><span>Base URL</span><input value={draft.baseUrl} placeholder="https://example.com/v1" onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
      <label className="provider-field"><span>上下文长度</span><input type="number" min="1024" step="1024" value={draft.contextWindow} onChange={(event) => setDraft((current) => ({ ...current, contextWindow: Number(event.target.value) }))} /></label>
      <label className="provider-field"><span>最大输出 Token</span><input type="number" min="1" step="256" value={draft.maxOutputTokens} onChange={(event) => setDraft((current) => ({ ...current, maxOutputTokens: Number(event.target.value) }))} /></label>
      <label className="provider-field wide"><span>API Key <small>{canUseStoredKey ? '已配置' : '未配置'}</small></span><div className="provider-key-input"><KeyRound size={16} /><input type={showKey ? 'text' : 'password'} value={apiKey} placeholder={canUseStoredKey ? '留空以继续使用已保存的 Key' : '请输入 API Key'} onChange={(event) => setApiKey(event.target.value)} /><button aria-label={showKey ? '隐藏 AI API Key' : '显示 AI API Key'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <label className="provider-field wide"><span>系统提示词</span><textarea className="provider-system-prompt" aria-label="系统提示词" rows={12} value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} /></label>
    </div>

    <div className="provider-form-footer">
      <div>{draft.builtIn && <button className="text-button" onClick={resetBuiltIn} disabled={disabled}><RotateCcw size={14} />恢复内置默认值</button>}</div>
      <div className="provider-form-actions">
        <button className="secondary-button" disabled={disabled || (!canUseStoredKey && !apiKey)} onClick={test}>{busy === 'test' && <LoaderCircle className="spin" size={15} />}测试连接</button>
        <button className="primary-button compact" disabled={disabled} onClick={save}>{busy === 'save' && <LoaderCircle className="spin" size={15} />}保存 Provider</button>
      </div>
    </div>
    {message && <div className="provider-message">{message}</div>}
  </div>
})
