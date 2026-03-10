import { useState, useEffect } from 'react'
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  Shield,
  Globe,
  AlertCircle,
  CheckCircle,
  X,
} from 'lucide-react'
import { getStatus, fetchJSON } from '../lib/api'

interface OpenClawConfig {
  gateway?: {
    mode?: string
    port?: number
    bind?: string
    auth?: { mode?: string }
    controlUi?: {
      allowedOrigins?: string[]
    }
  }
  [key: string]: unknown
}

export default function SystemSettings() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState<OpenClawConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Editable fields
  const [gatewayBind, setGatewayBind] = useState('')
  const [gatewayPort, setGatewayPort] = useState('')
  const [allowedOrigins, setAllowedOrigins] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [statusData, configData] = await Promise.all([
        getStatus(),
        fetchJSON<{ config: OpenClawConfig }>('/api/openclaw/settings/config').catch(() => ({ config: null })),
      ])
      setStatus(statusData)
      if (configData.config) {
        const cfg = configData.config
        setConfig(cfg)
        setGatewayBind(cfg.gateway?.bind || 'loopback')
        setGatewayPort(String(cfg.gateway?.port || '18789'))
        setAllowedOrigins(
          (cfg.gateway?.controlUi?.allowedOrigins || []).join('\n')
        )
      }
    } catch (err: any) {
      setError(err?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const updates: OpenClawConfig = {
        gateway: {
          bind: gatewayBind || 'loopback',
          port: parseInt(gatewayPort, 10) || 18789,
          controlUi: {
            allowedOrigins: allowedOrigins
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean),
          },
        },
      }

      await fetchJSON('/api/openclaw/settings/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      })
      flash('设置已保存（部分设置需重启网关生效）')
    } catch (err: any) {
      setError(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent-blue" />
      </div>
    )
  }

  const gatewayConnected = status?.gateway_connected === true

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-text">系统设置</h1>
          <p className="mt-1 text-sm text-dark-text-secondary">
            管理 OpenClaw 网关配置
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-dark-text-secondary hover:text-dark-text transition-colors"
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-lg bg-accent-green/10 p-3 text-sm text-accent-green flex items-center gap-2">
          <CheckCircle size={16} />
          {successMsg}
        </div>
      )}

      <div className="space-y-6 max-w-2xl">
        {/* Gateway Status */}
        <section className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
          <div className="px-5 py-3 border-b border-dark-border flex items-center gap-2">
            <Server size={16} className="text-dark-text-secondary" />
            <h2 className="text-sm font-semibold text-dark-text">网关状态</h2>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-sm">
              <span className="text-dark-text-secondary">连接状态</span>
              <span className="flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${gatewayConnected ? 'bg-accent-green' : 'bg-accent-red'}`} />
                <span className={gatewayConnected ? 'text-accent-green' : 'text-accent-red'}>
                  {gatewayConnected ? '已连接' : '未连接'}
                </span>
              </span>

              <span className="text-dark-text-secondary">配置文件</span>
              <span className="text-dark-text font-mono text-xs">{String(status?.config_path || '-')}</span>

              <span className="text-dark-text-secondary">工作区</span>
              <span className="text-dark-text font-mono text-xs">{String(status?.workspace || '-')}</span>

              <span className="text-dark-text-secondary">当前模型</span>
              <span className="text-dark-text font-mono text-xs">{String(status?.model || '-')}</span>
            </div>
          </div>
        </section>

        {/* Gateway Config */}
        <section className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
          <div className="px-5 py-3 border-b border-dark-border flex items-center gap-2">
            <Globe size={16} className="text-dark-text-secondary" />
            <h2 className="text-sm font-semibold text-dark-text">网关配置</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-dark-text-secondary mb-1">
                  绑定地址
                </label>
                <select
                  value={gatewayBind}
                  onChange={e => setGatewayBind(e.target.value)}
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue"
                >
                  <option value="loopback">loopback (仅本机)</option>
                  <option value="all">all (所有接口)</option>
                  <option value="tailscale">tailscale</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-text-secondary mb-1">
                  端口
                </label>
                <input
                  type="number"
                  value={gatewayPort}
                  onChange={e => setGatewayPort(e.target.value)}
                  placeholder="18789"
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-dark-text-secondary mb-1">
                允许的来源（CORS）
              </label>
              <textarea
                value={allowedOrigins}
                onChange={e => setAllowedOrigins(e.target.value)}
                rows={4}
                placeholder={"http://localhost:3080\nhttp://127.0.0.1:8080"}
                className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary font-mono resize-none"
              />
              <p className="mt-1 text-[11px] text-dark-text-secondary">
                每行一个 URL，用于 Control UI 的跨域访问控制
              </p>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
          <div className="px-5 py-3 border-b border-dark-border flex items-center gap-2">
            <Shield size={16} className="text-dark-text-secondary" />
            <h2 className="text-sm font-semibold text-dark-text">关于</h2>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-sm">
              <span className="text-dark-text-secondary">平台版本</span>
              <span className="text-dark-text">v2026.3</span>

              <span className="text-dark-text-secondary">OpenClaw</span>
              <span className="text-dark-text font-mono text-xs">openclaw gateway</span>

              <span className="text-dark-text-secondary">认证模式</span>
              <span className="text-dark-text">{config?.gateway?.auth?.mode || 'none'}</span>

              <span className="text-dark-text-secondary">数据目录</span>
              <span className="text-dark-text font-mono text-xs">{String(status?.config_path || '').replace('/openclaw.json', '') || '~/.openclaw'}</span>
            </div>
          </div>
        </section>

        {/* Save button */}
        <div className="flex gap-3 pb-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-accent-blue px-5 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存设置
          </button>
          <p className="text-xs text-dark-text-secondary self-center">
            部分设置需重启网关才能生效
          </p>
        </div>
      </div>
    </div>
  )
}
