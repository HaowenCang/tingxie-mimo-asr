import { AlertTriangle, Bot, Check, Copy, LoaderCircle, RefreshCw, Send, Settings2, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AIChatSession, AIMessage, AISettings, AIStreamEvent, TranscriptResult } from '../../electron/types'
import { MarkdownMessage } from './MarkdownMessage'

interface AIChatPanelProps {
  transcript: TranscriptResult
  settings: AISettings
  onSettingsChange(settings: AISettings): void
  onOpenSettings(): void
  onClose(): void
}

const EMPTY_SESSION = (transcriptId: string): AIChatSession => ({ transcriptId, messages: [], updatedAt: new Date().toISOString() })
const isMarkdownPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('markdown')
const PREVIEW_SESSION = (transcriptId: string): AIChatSession => isMarkdownPreview ? {
  transcriptId,
  updatedAt: new Date().toISOString(),
  messages: [
    { id: 'preview-user', role: 'user', content: '请总结并列出行动项。', createdAt: new Date().toISOString() },
    { id: 'preview-assistant', role: 'assistant', content: '## 核心结论\n\n团队已经进入开发阶段，下周将开始测试。\n\n> 以下是基于转写内容的整理。\n\n- [x] 完成需求评审\n- [ ] 进入第一轮测试\n\n| 事项 | 负责人 |\n| --- | --- |\n| A/B 测试 | 增长团队 |\n\n示例代码：`const ready = true`\n\n```ts\nconst nextStep = "test"\n```', createdAt: new Date().toISOString() },
  ],
} : EMPTY_SESSION(transcriptId)

export function AIChatPanel({ transcript, settings, onSettingsChange, onOpenSettings, onClose }: AIChatPanelProps) {
  const [session, setSession] = useState<AIChatSession>(() => PREVIEW_SESSION(transcript.id))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)
  const [error, setError] = useState('')
  const [showTokenPlanWarning, setShowTokenPlanWarning] = useState(false)
  const [pending, setPending] = useState<{ mode: 'new' | 'regenerate'; message?: string } | null>(null)
  const [copiedId, setCopiedId] = useState('')
  const activeRequestIdRef = useRef('')
  const deltaBufferRef = useRef('')
  const frameRef = useRef<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const provider = settings.providers.find((item) => item.id === settings.selectedProviderId) || settings.providers[0]

  useEffect(() => {
    let active = true
    setLoadingSession(true)
    setError('')
    if (!window.tingxie) {
      setSession(PREVIEW_SESSION(transcript.id))
      setLoadingSession(false)
      return
    }
    window.tingxie.getAIChat(transcript.id)
      .then((next) => { if (active) setSession(next) })
      .catch((nextError) => { if (active) setError(nextError instanceof Error ? nextError.message : '读取对话失败') })
      .finally(() => { if (active) setLoadingSession(false) })
    return () => { active = false }
  }, [transcript.id])

  useEffect(() => {
    if (!window.tingxie) return
    const flush = () => {
      frameRef.current = null
      const delta = deltaBufferRef.current
      deltaBufferRef.current = ''
      if (!delta) return
      setSession((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === 'streaming'
          ? { ...message, content: message.content + delta }
          : message),
      }))
    }
    return window.tingxie.onAIStream((event: AIStreamEvent) => {
      if (event.requestId !== activeRequestIdRef.current || event.transcriptId !== transcript.id || event.type !== 'delta' || !event.delta) return
      deltaBufferRef.current += event.delta
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(flush)
    })
  }, [transcript.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [session.messages])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  async function chooseProvider(id: string) {
    if (!window.tingxie) {
      onSettingsChange({ ...settings, selectedProviderId: id })
      return
    }
    try {
      onSettingsChange(await window.tingxie.selectAIProvider(id))
      setError('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '切换 Provider 失败')
    }
  }

  function optimisticMessages(currentMessages: AIMessage[], mode: 'new' | 'regenerate', message?: string): AIMessage[] {
    const now = new Date().toISOString()
    if (mode === 'regenerate') {
      const messages = currentMessages.at(-1)?.role === 'assistant' ? currentMessages.slice(0, -1) : [...currentMessages]
      return [...messages, { id: 'streaming', role: 'assistant', content: '', createdAt: now }]
    }
    return [
      ...currentMessages,
      { id: `local-${crypto.randomUUID()}`, role: 'user', content: message || '', createdAt: now },
      { id: 'streaming', role: 'assistant', content: '', createdAt: now },
    ]
  }

  async function startRequest(mode: 'new' | 'regenerate', message?: string) {
    if (!window.tingxie) {
      setError('桌面主进程未连接，预览模式不能发送 AI 请求')
      return
    }
    const requestId = crypto.randomUUID()
    activeRequestIdRef.current = requestId
    deltaBufferRef.current = ''
    setLoading(true)
    setError('')
    setSession((current) => ({ ...current, messages: optimisticMessages(current.messages, mode, message) }))
    if (mode === 'new') setInput('')
    try {
      const completed = await window.tingxie.sendAIMessage({
        requestId,
        transcript,
        providerId: provider.id,
        userMessage: message,
        mode,
      })
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      deltaBufferRef.current = ''
      setSession(completed)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'AI 请求失败')
      const persisted = await window.tingxie.getAIChat(transcript.id).catch(() => undefined)
      if (persisted) setSession(persisted)
    } finally {
      activeRequestIdRef.current = ''
      setLoading(false)
    }
  }

  function request(mode: 'new' | 'regenerate', message?: string) {
    if (!provider) return
    if (!provider.hasApiKey) {
      setError(`请先为 ${provider.name} 配置 API Key`)
      onOpenSettings()
      return
    }
    if (provider.kind === 'mimo-token-plan' && !settings.tokenPlanAcknowledged) {
      setPending({ mode, message })
      setShowTokenPlanWarning(true)
      return
    }
    void startRequest(mode, message)
  }

  async function confirmTokenPlan() {
    if (!window.tingxie || !pending) return
    try {
      const next = await window.tingxie.acknowledgeTokenPlan()
      onSettingsChange(next)
      setShowTokenPlanWarning(false)
      const action = pending
      setPending(null)
      await startRequest(action.mode, action.message)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '确认失败')
    }
  }

  async function clearChat() {
    if (!window.tingxie || !window.confirm('确定清空当前转写的全部 AI 对话吗？')) return
    setSession(await window.tingxie.clearAIChat(transcript.id))
    setError('')
  }

  async function copyMessage(message: AIMessage) {
    if (window.tingxie) await window.tingxie.copyText(message.content)
    else await navigator.clipboard.writeText(message.content)
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId(''), 1500)
  }

  function submit() {
    const message = input.trim()
    if (!message || loading) return
    request('new', message)
  }

  return <aside className="ai-chat-panel" id="ai-chat-panel">
    <header className="ai-chat-header">
      <div><span className="ai-avatar"><Bot size={17} /></span><span><strong>AI 对话</strong><small>基于当前转写与背景知识</small></span></div>
      <div><button aria-label="打开 AI 设置" onClick={onOpenSettings}><Settings2 size={17} /></button><button aria-label="关闭 AI 对话" onClick={onClose}><X size={18} /></button></div>
    </header>
    <div className="ai-provider-bar">
      <select aria-label="AI Provider" value={provider?.id || ''} disabled={loading} onChange={(event) => chooseProvider(event.target.value)}>{settings.providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select>
      <button aria-label="清空 AI 对话" disabled={loading || session.messages.length === 0} onClick={clearChat}><Trash2 size={15} /></button>
    </div>

    <div className="ai-messages">
      {loadingSession ? <div className="ai-loading"><LoaderCircle className="spin" size={19} />正在读取对话</div> : session.messages.length === 0 ? <div className="ai-empty">
        <span><Bot size={24} /></span><h3>询问这份转写</h3><p>可以总结内容、解释录音中提到的概念，或帮助梳理逻辑链路。</p>
        <div>{['总结核心观点', '提取行动项', '解释录音中的关键概念'].map((suggestion) => <button key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>)}</div>
      </div> : session.messages.map((message) => <article key={message.id} className={`ai-message ${message.role}`}>
        <div className="ai-message-role">{message.role === 'user' ? '你' : 'AI'}</div>
        <div className="ai-message-content">{message.content
          ? message.role === 'assistant' ? <MarkdownMessage content={message.content} /> : message.content
          : message.id === 'streaming' ? <span className="typing-indicator"><i /><i /><i /></span> : ''}</div>
        {message.role === 'assistant' && message.content && <button className="ai-message-copy" aria-label="复制 AI 回答" onClick={() => copyMessage(message)}>{copiedId === message.id ? <Check size={13} /> : <Copy size={13} />}</button>}
      </article>)}
      <div ref={messagesEndRef} />
    </div>

    {error && <div className="ai-error"><AlertTriangle size={14} />{error}</div>}
    <div className="ai-composer">
      <textarea aria-label="向 AI 提问" rows={3} value={input} disabled={loading} placeholder="询问转写内容，或让 AI 解释相关背景知识…" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
      }} />
      <div><span>Enter 发送 · Shift+Enter 换行</span>{loading
        ? <button className="stop-button" onClick={() => window.tingxie?.cancelAIMessage(activeRequestIdRef.current)}><Square size={14} fill="currentColor" />停止</button>
        : <button className="send-button" aria-label="发送 AI 消息" disabled={!input.trim()} onClick={submit}><Send size={16} /></button>}</div>
    </div>
    {session.messages.at(-1)?.role === 'assistant' && !loading && <button className="regenerate-button" onClick={() => request('regenerate')}><RefreshCw size={13} />重新生成</button>}

    {showTokenPlanWarning && <div className="ai-warning-backdrop"><section role="alertdialog" aria-modal="true" aria-labelledby="token-plan-warning-title"><AlertTriangle size={25} /><h3 id="token-plan-warning-title">确认 Token Plan 使用范围</h3><p>小米官方说明 Token Plan 仅限 Coding 场景，非 Coding 场景可能导致订阅暂停或 API Key 被封禁。请确认当前使用符合服务条款。</p><div><button className="secondary-button" onClick={() => { setShowTokenPlanWarning(false); setPending(null) }}>取消</button><button className="primary-button compact" onClick={confirmTokenPlan}>我已了解并继续</button></div></section></div>}
  </aside>
}
