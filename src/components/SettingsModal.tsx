import { CheckCircle2, ExternalLink, Eye, EyeOff, FolderCog, KeyRound, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { memo, useState } from 'react'
import { DEFAULT_APP_PREFERENCES, type AIProvider, type AISettings, type AppPreferences, type Language, type ServiceMode } from '../../electron/types'
import { useMotionVariants } from '../motion/variants'
import { AIProviderSettings } from './AIProviderSettings'
import { GlassSelect } from './GlassSelect'

const numberOptions = (values: number[], suffix: string) => values.map((value) => ({ value: String(value), label: `${value}${suffix}` }))

interface SettingsModalProps {
  configuredServices: ServiceMode[]
  language: Language
  serviceMode: ServiceMode
  adaptiveConcurrency: boolean
  aiSettings: AISettings
  preferences: AppPreferences
  mediaLibraryRoot: string
  initialSection?: 'asr' | 'ai' | 'personalize'
  onClose(): void
  onSave(apiKey: string, language: Language, serviceMode: ServiceMode, adaptiveConcurrency: boolean): Promise<void>
  onSavePreferences(preferences: AppPreferences): Promise<void>
  onChooseMediaLibraryRoot(): Promise<void>
  onTest(apiKey: string, serviceMode: ServiceMode): Promise<void>
  onAISettingsChange(settings: AISettings): void
  onSaveAIProvider(input: { provider: AIProvider; apiKey?: string }): Promise<AISettings>
  onDeleteAIProvider(id: string): Promise<AISettings>
  onSelectAIProvider(id: string): Promise<AISettings>
  onTestAIProvider(input: { provider: AIProvider; apiKey?: string }): Promise<void>
}

export const SettingsModal = memo(function SettingsModal({ configuredServices, language: initialLanguage, serviceMode: initialServiceMode, adaptiveConcurrency: initialAdaptiveConcurrency, aiSettings, preferences: initialPreferences, mediaLibraryRoot, initialSection = 'asr', onClose, onSave, onSavePreferences, onChooseMediaLibraryRoot, onTest, onAISettingsChange, onSaveAIProvider, onDeleteAIProvider, onSelectAIProvider, onTestAIProvider }: SettingsModalProps) {
  const { dialogPanel, fade } = useMotionVariants()
  const [section, setSection] = useState<'asr' | 'ai' | 'personalize'>(initialSection)
  const [apiKey, setApiKey] = useState('')
  const [language, setLanguage] = useState(initialLanguage)
  const [serviceMode, setServiceMode] = useState(initialServiceMode)
  const [adaptiveConcurrency, setAdaptiveConcurrency] = useState(initialAdaptiveConcurrency)
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [message, setMessage] = useState('')
  const [preferences, setPreferences] = useState(initialPreferences)
  const [preferenceBusy, setPreferenceBusy] = useState(false)
  const selectedHasKey = configuredServices.includes(serviceMode)
  const isTokenPlan = serviceMode === 'token-plan'

  async function save() {
    setBusy('save'); setMessage('')
    try {
      await onSave(apiKey, language, serviceMode, adaptiveConcurrency)
      setApiKey('')
      setMessage(`${isTokenPlan ? 'Token Plan' : '按量 API'} 设置已安全保存`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test'); setMessage('')
    try {
      await onTest(apiKey, serviceMode)
      setMessage(`连接成功，${isTokenPlan ? 'Token Plan' : '按量 API'} 可用`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败')
    } finally {
      setBusy(null)
    }
  }

  function chooseService(next: ServiceMode) {
    setServiceMode(next)
    setApiKey('')
    setMessage('')
  }

  const hasChanges = Boolean(apiKey)
    || language !== initialLanguage
    || serviceMode !== initialServiceMode
    || adaptiveConcurrency !== initialAdaptiveConcurrency

  return <m.div className="modal-backdrop" variants={fade} initial="initial" animate="animate" exit="exit" onMouseDown={onClose}>
    <m.section className="settings-modal" variants={dialogPanel} initial="initial" animate="animate" exit="exit" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><h2 id="settings-title">设置</h2><p>{section === 'asr' ? '配置 MiMo 语音识别服务' : section === 'ai' ? '配置转写内容的 AI 对话服务' : '调整界面、文字与播放行为'}</p></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><X size={20} /></button></header>
      <div className="settings-tabs" role="tablist"><button role="tab" aria-selected={section === 'asr'} className={section === 'asr' ? 'active' : ''} onClick={() => setSection('asr')}>语音转写{section === 'asr' && <m.i className="settings-tab-indicator" layoutId="settings-tab-indicator" />}</button><button role="tab" aria-selected={section === 'ai'} className={section === 'ai' ? 'active' : ''} onClick={() => setSection('ai')}>AI 服务{section === 'ai' && <m.i className="settings-tab-indicator" layoutId="settings-tab-indicator" />}</button><button role="tab" aria-selected={section === 'personalize'} className={section === 'personalize' ? 'active' : ''} onClick={() => setSection('personalize')}>个性化{section === 'personalize' && <m.i className="settings-tab-indicator" layoutId="settings-tab-indicator" />}</button></div>
      <AnimatePresence initial={false} mode="wait"><m.div key={section} className="settings-section-motion" variants={fade} initial="initial" animate="animate" exit="exit">
      {section === 'asr' ? <><div className="settings-content">
        <div className="field-label"><span>服务入口</span></div>
        <div className="service-options" role="radiogroup" aria-label="MiMo 服务入口">
          <label className={serviceMode === 'payg' ? 'service-option selected' : 'service-option'}>
            <input type="radio" name="service-mode" value="payg" checked={serviceMode === 'payg'} onChange={() => chooseService('payg')} />
            <span className="radio-dot" />
            <span><strong>按量计费 API</strong><small>api.xiaomimimo.com · sk- Key</small></span>
          </label>
          <label className={serviceMode === 'token-plan' ? 'service-option selected' : 'service-option'}>
            <input type="radio" name="service-mode" value="token-plan" checked={serviceMode === 'token-plan'} onChange={() => chooseService('token-plan')} />
            <span className="radio-dot" />
            <span><strong>Token Plan（中国区）</strong><small>token-plan-cn.xiaomimimo.com · tp- Key</small></span>
          </label>
        </div>

        <label className="field-label" htmlFor="api-key"><span>{isTokenPlan ? 'Token Plan API Key' : 'MiMo API Key'}</span><small>{selectedHasKey ? '已配置' : '未配置'}</small></label>
        <div className="key-input"><KeyRound size={18} /><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selectedHasKey ? `输入新的 ${isTokenPlan ? 'tp-' : 'sk-'} Key 可替换当前配置` : `请输入 ${isTokenPlan ? 'tp-' : 'sk-'} 开头的 API Key`} /><button aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        <div className="security-note"><ShieldCheck size={17} /><span>两套 API Key 分别使用 Windows 安全存储加密，仅由本机主进程读取；切换入口不会覆盖另一套凭据。</span></div>
        <label className="field-label" htmlFor="language"><span>默认识别语言</span></label>
        <GlassSelect className="settings-select" ariaLabel="默认识别语言" value={language} options={[{ value: 'auto', label: '自动检测' }, { value: 'zh', label: '中文' }, { value: 'en', label: '英文' }]} onValueChange={(value) => setLanguage(value as Language)} />
        <label className="concurrency-setting" htmlFor="adaptive-concurrency">
          <span><strong>自适应并发识别</strong><small>默认开启；按响应延迟快速调节并发，90–92 RPM 严格节流，429 限流等待不占错误重试</small></span>
          <input id="adaptive-concurrency" type="checkbox" checked={adaptiveConcurrency} onChange={(event) => setAdaptiveConcurrency(event.target.checked)} />
          <span className="toggle" aria-hidden="true"><i /></span>
        </label>
        <a className="docs-link" href={isTokenPlan ? 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call' : 'https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/Speech-Recognition'} target="_blank" rel="noreferrer">查看 {isTokenPlan ? 'Token Plan' : 'MiMo ASR'} 接入文档<ExternalLink size={14} /></a>
        {message && <div className="settings-message"><CheckCircle2 size={16} />{message}</div>}
      </div>
      <footer><button className="secondary-button" disabled={(!selectedHasKey && !apiKey) || busy !== null} onClick={test}>{busy === 'test' && <LoaderCircle className="spin" size={16} />}测试连接</button><button className="primary-button compact" disabled={busy !== null || !hasChanges} onClick={save}>{busy === 'save' && <LoaderCircle className="spin" size={16} />}保存设置</button></footer></> : section === 'ai' ? <AIProviderSettings settings={aiSettings} onChange={onAISettingsChange} onSave={onSaveAIProvider} onDelete={onDeleteAIProvider} onSelect={onSelectAIProvider} onTest={onTestAIProvider} /> : <>
        <div className="settings-content personalization-settings">
          <section className="preference-group"><div className="preference-group-heading"><strong>外观与排版</strong><span>所有文字设置均直接连接到对应界面区域</span></div><div className="preferences-grid">
            <label><span>主题</span><GlassSelect className="settings-select" ariaLabel="主题" value={preferences.theme} options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} onValueChange={(theme) => setPreferences({ ...preferences, theme: theme as AppPreferences['theme'] })} /></label>
            <label><span>强调色</span><GlassSelect className="settings-select" ariaLabel="强调色" value={preferences.accent} options={[{ value: 'blue', label: '海湾蓝' }, { value: 'purple', label: '鸢尾紫' }, { value: 'teal', label: '湖水青' }]} onValueChange={(accent) => setPreferences({ ...preferences, accent: accent as AppPreferences['accent'] })} /></label>
            <label><span>界面缩放 <b>{preferences.uiScale}%</b></span><input type="range" min="85" max="125" step="5" value={preferences.uiScale} onChange={(event) => setPreferences({ ...preferences, uiScale: Number(event.target.value) })} /></label>
            <label><span>玻璃强度 <b>{preferences.glassStrength}%</b></span><input type="range" min="25" max="85" step="5" value={preferences.glassStrength} onChange={(event) => setPreferences({ ...preferences, glassStrength: Number(event.target.value) })} /></label>
            <label><span>界面字体</span><GlassSelect ariaLabel="界面字体大小" className="settings-select" value={String(preferences.uiFontScale)} options={numberOptions([85, 90, 95, 100, 105, 110, 115, 125], '%')} onValueChange={(value) => setPreferences({ ...preferences, uiFontScale: Number(value) })} /></label>
            <label><span>转写字体</span><GlassSelect ariaLabel="转写字体大小" className="settings-select" value={String(preferences.transcriptFontSize)} options={numberOptions([12, 14, 16, 18, 20, 22, 24], 'px')} onValueChange={(value) => setPreferences({ ...preferences, transcriptFontSize: Number(value) })} /></label>
            <label><span>智能内容字体</span><GlassSelect ariaLabel="智能内容字体大小" className="settings-select" value={String(preferences.smartFontSize)} options={numberOptions([10, 11, 12, 13, 14, 16, 18, 20], 'px')} onValueChange={(value) => setPreferences({ ...preferences, smartFontSize: Number(value) })} /></label>
            <label><span>AI 对话字体</span><GlassSelect ariaLabel="AI 对话字体大小" className="settings-select" value={String(preferences.chatFontSize)} options={numberOptions([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 'px')} onValueChange={(value) => setPreferences({ ...preferences, chatFontSize: Number(value) })} /></label>
            <label><span>提示与辅助文字</span><GlassSelect ariaLabel="提示与辅助文字大小" className="settings-select" value={String(preferences.captionFontSize)} options={numberOptions([12, 13, 14, 15, 16, 17, 18], 'px')} onValueChange={(value) => setPreferences({ ...preferences, captionFontSize: Number(value) })} /></label>
            <label><span>AI 对话栏宽度 <b>{preferences.chatPanelWidth}px</b></span><input aria-label="AI 对话栏宽度" type="range" min="340" max="720" step="10" value={preferences.chatPanelWidth} onChange={(event) => setPreferences({ ...preferences, chatPanelWidth: Number(event.target.value) })} /></label>
            <label><span>新转写段落长度</span><GlassSelect ariaLabel="新转写段落长度" className="settings-select" value={preferences.paragraphLength} options={[{ value: 'compact', label: '紧凑 · 2–3 句' }, { value: 'standard', label: '标准 · 3–6 句' }, { value: 'long', label: '长段落 · 5–9 句' }]} onValueChange={(paragraphLength) => setPreferences({ ...preferences, paragraphLength: paragraphLength as AppPreferences['paragraphLength'] })} /></label>
            <label><span>内容密度</span><GlassSelect ariaLabel="内容密度" className="settings-select" value={preferences.density} options={[{ value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' }]} onValueChange={(density) => setPreferences({ ...preferences, density: density as AppPreferences['density'] })} /></label>
          </div></section>
          <section className="preference-group"><div className="preference-group-heading"><strong>工作区布局</strong><span>主区域可直接拖动分隔线；小窗口会自动采用紧凑布局</span></div><div className="layout-preference-summary"><span>侧栏 {preferences.sidebarWidth}px</span><span>上传区 {preferences.uploadPaneHeight}px</span><span>文件夹栏 {preferences.libraryFolderWidth}px</span><span>详情栏 {preferences.libraryInspectorWidth}px</span><button className="soft-button" onClick={() => setPreferences({ ...preferences, sidebarWidth: DEFAULT_APP_PREFERENCES.sidebarWidth, uploadPaneHeight: DEFAULT_APP_PREFERENCES.uploadPaneHeight, libraryFolderWidth: DEFAULT_APP_PREFERENCES.libraryFolderWidth, libraryInspectorWidth: DEFAULT_APP_PREFERENCES.libraryInspectorWidth, chatPanelWidth: DEFAULT_APP_PREFERENCES.chatPanelWidth })}>恢复默认布局</button></div></section>
          <section className="preference-group"><div className="preference-group-heading"><strong>播放与校对</strong><span>控制音频播放、跳转和自动跟随</span></div><div className="preferences-grid">
            <label><span>默认倍速</span><GlassSelect ariaLabel="默认倍速" className="settings-select" value={String(preferences.defaultPlaybackRate)} options={numberOptions([0.75, 1, 1.25, 1.5, 2], 'x')} onValueChange={(value) => setPreferences({ ...preferences, defaultPlaybackRate: Number(value) })} /></label>
            <label><span>默认音量 <b>{Math.round(preferences.defaultVolume * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={preferences.defaultVolume} onChange={(event) => setPreferences({ ...preferences, defaultVolume: Number(event.target.value) })} /></label>
            <label><span>前进/后退</span><GlassSelect ariaLabel="前进或后退时长" className="settings-select" value={String(preferences.seekSeconds)} options={numberOptions([5, 10, 15], ' 秒')} onValueChange={(value) => setPreferences({ ...preferences, seekSeconds: Number(value) })} /></label>
            <label><span>最短静音 <b>{preferences.minimumSilenceSeconds.toFixed(1)}s</b></span><input type="range" min="0.3" max="3" step="0.1" value={preferences.minimumSilenceSeconds} onChange={(event) => setPreferences({ ...preferences, minimumSilenceSeconds: Number(event.target.value) })} /></label>
            <label><span>跳转提前量 <b>{preferences.seekLeadSeconds.toFixed(1)}s</b></span><input type="range" min="0" max="2" step="0.1" value={preferences.seekLeadSeconds} onChange={(event) => setPreferences({ ...preferences, seekLeadSeconds: Number(event.target.value) })} /></label>
          </div></section>
          <section className="preference-group library-preference"><div className="preference-group-heading"><strong>媒体库存储</strong><span>导入文件会复制到此目录；更换位置时保留原目录作为安全备份</span></div><div className="library-root-control"><FolderCog size={19} /><code title={mediaLibraryRoot}>{mediaLibraryRoot}</code><button className="soft-button" onClick={() => void onChooseMediaLibraryRoot()}>更换位置</button></div></section>
          <div className="preference-toggles">
            {([
              ['skipSilence', '自动跳过静音', '播放时跳过达到最短阈值的静音段'],
              ['autoFollow', '播放时跟随原文', '滚动到当前近似时间对应的段落'],
              ['autoGenerateAnalysis', '转写后自动生成智能速览', '使用当前已选择的 AI Provider'],
              ['sidebarCollapsed', '默认收起左侧栏文字', '仅保留图标，为转写原文腾出更多宽度'],
              ['reducedMotion', '减少动态效果', '关闭平滑滚动与界面动画'],
            ] as const).map(([key, title, description]) => <label className="concurrency-setting" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} /><span className="toggle"><i /></span></label>)}
          </div>
          <p className="settings-audit-note">界面、转写、智能内容与 AI 对话字号分别控制对应区域；标题、时间和辅助说明会按所属字号自动派生。AI 对话栏宽度也可在结果页直接拖动调整。未实现的说话人区分不会在设置中展示。</p>
        </div>
        <footer><button className="primary-button compact" disabled={preferenceBusy || JSON.stringify(preferences) === JSON.stringify(initialPreferences)} onClick={async () => { setPreferenceBusy(true); try { await onSavePreferences(preferences); setMessage('个性化设置已保存并生效') } finally { setPreferenceBusy(false) } }}>{preferenceBusy && <LoaderCircle className="spin" size={16} />}保存并应用</button></footer>
      </>}
      </m.div></AnimatePresence>
    </m.section>
  </m.div>
})
