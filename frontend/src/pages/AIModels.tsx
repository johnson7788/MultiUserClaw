import { useState, useEffect } from 'react'
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  Star,
  Edit2,
  Key,
  ExternalLink,
} from 'lucide-react'
import { listModels, updateModelsConfig } from '../lib/api'

// ── Provider catalog (based on ClawX) ───────────────────────────────

interface ProviderInfo {
  id: string
  name: string
  icon: string
  placeholder: string
  defaultBaseUrl?: string
  defaultApi: string
  defaultModel?: string
  requiresApiKey: boolean
  apiKeyUrl?: string
  category: 'official' | 'cn' | 'local' | 'custom'
}

const PROVIDER_CATALOG: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', icon: '🤖', placeholder: 'sk-ant-api03-...', defaultApi: 'anthropic-messages', defaultModel: 'claude-sonnet-4-20250514', requiresApiKey: true, category: 'official', apiKeyUrl: 'https://console.anthropic.com/' },
  { id: 'openai', name: 'OpenAI', icon: '💚', placeholder: 'sk-proj-...', defaultApi: 'openai-completions', defaultModel: 'gpt-4o', requiresApiKey: true, category: 'official', apiKeyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'google', name: 'Google Gemini', icon: '🔷', placeholder: 'AIza...', defaultApi: 'google-generative-ai', defaultModel: 'gemini-2.5-flash', requiresApiKey: true, category: 'official', apiKeyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultApi: 'openai-completions', defaultModel: 'anthropic/claude-opus-4.6', requiresApiKey: true, category: 'official', apiKeyUrl: 'https://openrouter.ai/keys' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', placeholder: 'sk-...', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultApi: 'openai-completions', defaultModel: 'deepseek-chat', requiresApiKey: true, category: 'cn' },
  { id: 'siliconflow', name: 'SiliconFlow', icon: '🌊', placeholder: 'sk-...', defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultApi: 'openai-completions', defaultModel: 'deepseek-ai/DeepSeek-V3', requiresApiKey: true, category: 'cn' },
  { id: 'moonshot', name: 'Moonshot / Kimi', icon: '🌙', placeholder: 'sk-...', defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultApi: 'openai-completions', defaultModel: 'kimi-k2.5', requiresApiKey: true, category: 'cn' },
  { id: 'dashscope', name: '通义千问 / Qwen', icon: '☁️', placeholder: 'sk-...', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultApi: 'openai-completions', defaultModel: 'qwen-max', requiresApiKey: true, category: 'cn' },
  { id: 'ark', name: 'ByteDance Ark / 豆包', icon: '🔥', placeholder: 'your-api-key', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultApi: 'openai-completions', requiresApiKey: true, category: 'cn' },
  { id: 'zhipu', name: '智谱 GLM', icon: '💡', placeholder: 'your-api-key', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultApi: 'openai-completions', defaultModel: 'glm-4-plus', requiresApiKey: true, category: 'cn' },
  { id: 'ollama', name: 'Ollama (本地)', icon: '🦙', defaultBaseUrl: 'http://localhost:11434/v1', defaultApi: 'openai-completions', placeholder: '', requiresApiKey: false, category: 'local' },
  { id: 'custom', name: '自定义 API', icon: '⚙️', placeholder: 'API key...', defaultApi: 'openai-completions', requiresApiKey: true, category: 'custom' },
]

const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
]

const CATEGORY_LABELS: Record<string, string> = {
  official: '国际服务',
  cn: '国内服务',
  local: '本地部署',
  custom: '自定义',
}

interface ProviderFormData {
  name: string
  baseUrl: string
  api: string
  apiKey: string
  models: { id: string; name: string }[]
}

export default function AIModels() {
  const [configuredModel, setConfiguredModel] = useState('')
  const [configuredProviders, setConfiguredProviders] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Add/edit provider form
  const [showForm, setShowForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderFormData>({
    name: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: [{ id: '', name: '' }],
  })

  // Provider picker
  const [showPicker, setShowPicker] = useState(false)

  const reload = () => {
    setLoading(true)
    listModels()
      .then(data => {
        setConfiguredModel(data.configuredModel || '')
        setConfiguredProviders(data.configuredProviders || {})
      })
      .catch(err => setError(err?.message || '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  // Set default model
  const handleSetDefault = async (provider: string, modelId: string) => {
    setSaving(true)
    setError('')
    try {
      const fullId = `${provider}/${modelId}`
      await updateModelsConfig({ defaultModel: fullId })
      setConfiguredModel(fullId)
      flash(`默认模型已设置为 ${fullId}`)
    } catch (err: any) {
      setError(err?.message || '设置失败')
    } finally {
      setSaving(false)
    }
  }

  // Pick a provider from catalog to add
  const handlePickProvider = (info: ProviderInfo) => {
    setForm({
      name: info.id,
      baseUrl: info.defaultBaseUrl || '',
      api: info.defaultApi,
      apiKey: '',
      models: info.defaultModel
        ? [{ id: info.defaultModel, name: '' }]
        : [{ id: '', name: '' }],
    })
    setEditingProvider(null)
    setShowPicker(false)
    setShowForm(true)
  }

  // Edit existing provider
  const handleEdit = (providerName: string) => {
    const p = configuredProviders[providerName]
    if (!p) return
    const models = (p.models || []).map((m: any) => ({ id: m.id || '', name: m.name || m.id || '' }))
    setForm({
      name: providerName,
      baseUrl: p.baseUrl || '',
      api: p.api || 'openai-completions',
      apiKey: p.apiKey || '',
      models: models.length > 0 ? models : [{ id: '', name: '' }],
    })
    setEditingProvider(providerName)
    setShowForm(true)
  }

  // Save provider
  const handleSave = async () => {
    if (!form.name.trim()) { setError('提供商名称不能为空'); return }
    const validModels = form.models.filter(m => m.id.trim())
    if (validModels.length === 0) { setError('至少添加一个模型'); return }

    setSaving(true)
    setError('')
    try {
      const newProviders = { ...configuredProviders }
      if (editingProvider && editingProvider !== form.name.trim()) {
        delete newProviders[editingProvider]
      }
      newProviders[form.name.trim()] = {
        baseUrl: form.baseUrl.trim() || undefined,
        api: form.api,
        apiKey: form.apiKey.trim() || undefined,
        models: validModels.map(m => ({
          id: m.id.trim(),
          name: m.name.trim() || m.id.trim(),
        })),
      }
      await updateModelsConfig({ providers: newProviders })
      setShowForm(false)
      flash('提供商配置已保存')
      reload()
    } catch (err: any) {
      setError(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // Delete provider
  const handleDeleteProvider = async (providerName: string) => {
    if (!confirm(`确定删除提供商 "${providerName}" 及其所有模型配置？`)) return
    setSaving(true)
    setError('')
    try {
      const newProviders = { ...configuredProviders }
      delete newProviders[providerName]
      await updateModelsConfig({ providers: newProviders })
      flash(`已删除提供商 ${providerName}`)
      reload()
    } catch (err: any) {
      setError(err?.message || '删除失败')
    } finally {
      setSaving(false)
    }
  }

  // Model row helpers
  const addModelRow = () => setForm(f => ({ ...f, models: [...f.models, { id: '', name: '' }] }))
  const removeModelRow = (i: number) => setForm(f => ({ ...f, models: f.models.filter((_, j) => j !== i) }))
  const updateModelRow = (i: number, field: 'id' | 'name', value: string) => {
    setForm(f => ({
      ...f,
      models: f.models.map((m, j) => j === i ? { ...m, [field]: value } : m),
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent-blue" />
      </div>
    )
  }

  const providerNames = Object.keys(configuredProviders)
  const hasProviders = providerNames.length > 0

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-text">AI 模型</h1>
          <p className="mt-1 text-sm text-dark-text-secondary">
            配置 AI 模型提供商
            {configuredModel && (
              <span className="ml-2">
                · 默认: <code className="rounded bg-dark-card px-1.5 py-0.5 text-xs text-accent-blue">{configuredModel}</code>
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-2 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors"
        >
          <Plus size={16} />
          添加提供商
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          {error}
          <button onClick={() => setError('')} className="ml-auto text-accent-red/70 hover:text-accent-red"><X size={14} /></button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-lg bg-accent-green/10 p-3 text-sm text-accent-green">{successMsg}</div>
      )}

      {/* Configured providers */}
      {hasProviders ? (
        <div className="mb-8 space-y-3">
          <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-2">
            已配置的提供商
          </h2>
          {providerNames.map(name => {
            const p = configuredProviders[name]
            const models: { id: string; name: string }[] = p.models || []
            const catalogInfo = PROVIDER_CATALOG.find(c => c.id === name)
            const icon = catalogInfo?.icon || '⚙️'
            const displayName = catalogInfo?.name || name

            return (
              <div
                key={name}
                className="rounded-xl border border-dark-border bg-dark-card overflow-hidden"
              >
                {/* Provider header */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-dark-text">{displayName}</span>
                        {p.apiKey && (
                          <span className="flex items-center gap-1 text-[10px] text-accent-green">
                            <Key size={10} /> 已配置
                          </span>
                        )}
                        {!p.apiKey && catalogInfo?.requiresApiKey && (
                          <span className="flex items-center gap-1 text-[10px] text-accent-red">
                            <Key size={10} /> 未配置
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-dark-text-secondary mt-0.5">
                        {p.baseUrl && <span className="mr-3">{p.baseUrl}</span>}
                        <span>{p.api || 'openai-completions'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(name)}
                      className="rounded-lg p-1.5 text-dark-text-secondary hover:text-dark-text hover:bg-dark-bg transition-colors"
                      title="编辑"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteProvider(name)}
                      className="rounded-lg p-1.5 text-dark-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Models */}
                {models.length > 0 && (
                  <div className="border-t border-dark-border">
                    {models.map((model, i) => {
                      const fullId = `${name}/${model.id}`
                      const isDefault = configuredModel === fullId
                      return (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between px-5 py-2.5 ${
                            i < models.length - 1 ? 'border-b border-dark-border' : ''
                          } ${isDefault ? 'bg-accent-blue/5' : 'hover:bg-dark-bg/50'} transition-colors`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${isDefault ? 'font-medium text-accent-blue' : 'text-dark-text'}`}>
                              {model.name || model.id}
                            </span>
                            {model.name && model.name !== model.id && (
                              <span className="text-xs text-dark-text-secondary">{model.id}</span>
                            )}
                            {isDefault && (
                              <span className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] text-accent-blue font-medium">
                                默认
                              </span>
                            )}
                          </div>
                          {!isDefault && (
                            <button
                              onClick={() => handleSetDefault(name, model.id)}
                              disabled={saving}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-dark-text-secondary hover:text-accent-blue hover:bg-accent-blue/5 transition-colors disabled:opacity-50"
                            >
                              <Star size={12} />
                              设为默认
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mb-8 rounded-xl border border-dark-border bg-dark-card px-4 py-16 text-center">
          <Key size={40} className="mx-auto mb-3 text-dark-text-secondary/50" />
          <p className="text-sm text-dark-text-secondary mb-3">尚未配置任何模型提供商</p>
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors"
          >
            <Plus size={14} />
            添加第一个提供商
          </button>
        </div>
      )}

      {/* Provider picker modal */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-dark-card border border-dark-border max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border shrink-0">
              <h3 className="text-base font-semibold text-dark-text">选择提供商</h3>
              <button onClick={() => setShowPicker(false)} className="rounded-lg p-1 text-dark-text-secondary hover:text-dark-text transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {(['official', 'cn', 'local', 'custom'] as const).map(category => {
                const items = PROVIDER_CATALOG.filter(p => p.category === category)
                if (items.length === 0) return null
                return (
                  <div key={category} className="mb-5 last:mb-0">
                    <h4 className="text-xs font-semibold text-dark-text-secondary uppercase tracking-wider mb-2">
                      {CATEGORY_LABELS[category]}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {items.map(info => {
                        const alreadyAdded = !!configuredProviders[info.id]
                        return (
                          <button
                            key={info.id}
                            onClick={() => handlePickProvider(info)}
                            disabled={alreadyAdded}
                            className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                              alreadyAdded
                                ? 'border-dark-border opacity-50 cursor-not-allowed'
                                : 'border-dark-border hover:border-accent-blue/50 hover:bg-accent-blue/5'
                            }`}
                          >
                            <span className="text-xl shrink-0">{info.icon}</span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-dark-text truncate">{info.name}</div>
                              {alreadyAdded && (
                                <div className="text-[10px] text-dark-text-secondary">已添加</div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit provider form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-dark-card border border-dark-border max-w-lg w-full mx-4 shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border shrink-0">
              <h3 className="text-base font-semibold text-dark-text">
                {editingProvider ? `编辑: ${editingProvider}` : '配置提供商'}
              </h3>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1 text-dark-text-secondary hover:text-dark-text transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-dark-text-secondary">提供商名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例如: openai, anthropic"
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
                />
              </div>

              {/* API Type + Base URL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-dark-text-secondary">API 类型</label>
                  <select
                    value={form.api}
                    onChange={e => setForm(f => ({ ...f, api: e.target.value }))}
                    className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue"
                  >
                    {API_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-dark-text-secondary">Base URL</label>
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
                  />
                </div>
              </div>

              {/* API Key */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-dark-text-secondary">API Key</label>
                  {(() => {
                    const info = PROVIDER_CATALOG.find(c => c.id === form.name)
                    if (info?.apiKeyUrl) {
                      return (
                        <a
                          href={info.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
                        >
                          获取 Key <ExternalLink size={10} />
                        </a>
                      )
                    }
                    return null
                  })()}
                </div>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                  placeholder={PROVIDER_CATALOG.find(c => c.id === form.name)?.placeholder || 'sk-...'}
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
                />
              </div>

              {/* Models */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-dark-text-secondary">模型列表 *</label>
                  <button onClick={addModelRow} className="flex items-center gap-1 text-xs text-accent-blue hover:text-accent-blue/80">
                    <Plus size={12} /> 添加模型
                  </button>
                </div>
                <div className="space-y-2">
                  {form.models.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.id}
                        onChange={e => updateModelRow(i, 'id', e.target.value)}
                        placeholder="模型 ID，例如 gpt-4o"
                        className="flex-1 rounded-lg border border-dark-border bg-dark-bg px-3 py-1.5 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
                      />
                      <input
                        type="text"
                        value={m.name}
                        onChange={e => updateModelRow(i, 'name', e.target.value)}
                        placeholder="显示名称（可选）"
                        className="flex-1 rounded-lg border border-dark-border bg-dark-bg px-3 py-1.5 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
                      />
                      {form.models.length > 1 && (
                        <button onClick={() => removeModelRow(i)} className="text-dark-text-secondary hover:text-accent-red">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-dark-border shrink-0">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-dark-border px-4 py-1.5 text-sm text-dark-text-secondary hover:text-dark-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
