import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  Trash2,
  AlertCircle,
  Loader2,
  Download,
  CheckCircle,
  Package,
  X,
} from 'lucide-react'
import { listPlugins, installPlugin, uninstallPlugin } from '../lib/api'
import type { PluginInfo } from '../lib/api'

// Well-known OpenClaw channel extensions that can be installed
const EXTENSION_CATALOG = [
  { spec: '@openclaw/feishu', name: 'feishu', label: '飞书 / Lark', description: '飞书和 Lark 消息渠道接入', icon: '📘' },
  { spec: '@openclaw/matrix', name: 'matrix', label: 'Matrix', description: 'Matrix 协议接入（支持 E2EE）', icon: '🔷' },
  { spec: '@openclaw/msteams', name: 'msteams', label: 'Microsoft Teams', description: 'Azure Bot 接入 Teams', icon: '🟦' },
  { spec: '@openclaw/mattermost', name: 'mattermost', label: 'Mattermost', description: 'Mattermost Bot 接入', icon: '🔵' },
  { spec: '@openclaw/bluebubbles', name: 'bluebubbles', label: 'BlueBubbles', description: 'BlueBubbles iMessage 接入', icon: '🫧' },
  { spec: '@openclaw/twitch', name: 'twitch', label: 'Twitch', description: 'Twitch IRC 直播聊天接入', icon: '💜' },
  { spec: '@openclaw/nextcloud-talk', name: 'nextcloud-talk', label: 'Nextcloud Talk', description: 'Nextcloud Talk Bot 接入', icon: '☁️' },
  { spec: '@openclaw/synology-chat', name: 'synology-chat', label: 'Synology Chat', description: 'Synology Chat Bot 接入', icon: '🟢' },
  { spec: '@openclaw/zalo', name: 'zalo', label: 'Zalo', description: 'Zalo OA API 接入', icon: '🔵' },
  { spec: '@openclaw/nostr', name: 'nostr', label: 'Nostr', description: 'Nostr 去中心化协议接入', icon: '🟣' },
  { spec: '@openclaw/voice-call', name: 'voice-call', label: 'Voice Call', description: '语音通话接入', icon: '📞' },
  { spec: '@sliverp/qqbot@latest', name: 'qqbot', label: 'QQ Bot', description: 'QQ 机器人接入', icon: '🐧' },
  { spec: '@wecom/wecom-openclaw-plugin', name: 'wecom-openclaw-plugin', label: '企业微信 / WeCom', description: '企业微信 AI Bot WebSocket 持久连接接入', icon: '💼' },
  { spec: '@dingtalk-real-ai/dingtalk-connector', name: 'dingtalk-connector', label: '钉钉 / DingTalk', description: '钉钉企业机器人接入', icon: '💙' },
]

export default function Plugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // Install state
  const [installing, setInstalling] = useState<string | null>(null)
  const [customSpec, setCustomSpec] = useState('')
  const [customInstalling, setCustomInstalling] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchPlugins = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    setError('')
    try {
      const result = await listPlugins()
      setPlugins(result)
    } catch (err: any) {
      setError(err?.message || '获取插件列表失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchPlugins(true) }, [fetchPlugins])

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 5000)
  }

  const handleInstall = async (spec: string) => {
    setInstalling(spec)
    setError('')
    try {
      const result = await installPlugin(spec)
      if (result.ok) {
        flash(`插件 ${spec} 安装成功，请重启网关生效`)
        await fetchPlugins()
      }
    } catch (err: any) {
      setError(err?.message || `安装 ${spec} 失败`)
    } finally {
      setInstalling(null)
    }
  }

  const handleCustomInstall = async () => {
    if (!customSpec.trim()) return
    setCustomInstalling(true)
    setError('')
    try {
      const result = await installPlugin(customSpec.trim())
      if (result.ok) {
        flash(`插件 ${customSpec.trim()} 安装成功，请重启网关生效`)
        setCustomSpec('')
        await fetchPlugins()
      }
    } catch (err: any) {
      setError(err?.message || `安装 ${customSpec} 失败`)
    } finally {
      setCustomInstalling(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await uninstallPlugin(deleteTarget)
      flash(`插件 ${deleteTarget} 已卸载，请重启网关生效`)
      setDeleteTarget(null)
      await fetchPlugins()
    } catch (err: any) {
      setError(err?.message || '卸载失败')
    } finally {
      setDeleting(false)
    }
  }

  // Installed extension names
  const installedNames = new Set(
    plugins
      .filter(p => p.source === 'openclaw-extension')
      .map(p => p.name)
  )

  // Available extensions from catalog (not yet installed)
  const availableExtensions = EXTENSION_CATALOG.filter(e => !installedNames.has(e.name))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent-blue" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-text">插件管理</h1>
          <p className="mt-1 text-sm text-dark-text-secondary">
            管理 OpenClaw 扩展插件（渠道、工具等）
          </p>
        </div>
        <button
          onClick={() => { setRefreshing(true); fetchPlugins() }}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-dark-text-secondary hover:text-dark-text transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          <AlertCircle size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 rounded-lg bg-accent-green/10 p-3 text-sm text-accent-green flex items-center gap-2">
          <CheckCircle size={16} />
          {successMsg}
        </div>
      )}

      {/* Installed plugins */}
      {plugins.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-3">
            已安装插件
          </h2>
          <div className="space-y-2">
            {plugins.map(p => (
              <div
                key={`${p.source}:${p.name}`}
                className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-dark-bg text-lg">
                    <Package size={18} className="text-dark-text-secondary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-dark-text">
                      {p.name}
                      {p.version && (
                        <span className="ml-2 text-xs text-dark-text-secondary font-mono">v{p.version}</span>
                      )}
                    </div>
                    <div className="text-xs text-dark-text-secondary">
                      {p.description || p.source}
                      {p.source === 'openclaw-extension' && (
                        <span className="ml-2 inline-block rounded bg-accent-blue/15 px-1.5 py-0.5 text-[10px] text-accent-blue">
                          OpenClaw 扩展
                        </span>
                      )}
                      {p.enabled === false && (
                        <span className="ml-2 inline-block rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] text-accent-red">
                          已禁用
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setDeleteTarget(p.name)}
                  className="rounded-lg p-1.5 text-dark-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                  title="卸载"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Install from npm */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-3">
          安装插件
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={customSpec}
            onChange={e => setCustomSpec(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomInstall()}
            placeholder="输入 npm 包名，如 @openclaw/feishu"
            className="flex-1 rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
          />
          <button
            onClick={handleCustomInstall}
            disabled={customInstalling || !customSpec.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
          >
            {customInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            安装
          </button>
        </div>
      </div>

      {/* Available channel extensions */}
      {availableExtensions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-3">
            可用渠道扩展
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {availableExtensions.map(ext => (
              <div
                key={ext.spec}
                className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-dark-bg text-lg">
                    {ext.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-dark-text">{ext.label}</div>
                    <div className="text-xs text-dark-text-secondary">{ext.description}</div>
                  </div>
                </div>
                <button
                  onClick={() => handleInstall(ext.spec)}
                  disabled={installing === ext.spec}
                  className="flex items-center gap-1 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-dark-text-secondary hover:text-accent-blue hover:border-accent-blue transition-colors disabled:opacity-50"
                >
                  {installing === ext.spec ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  安装
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-dark-card border border-dark-border p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-dark-text mb-2">确认卸载</h3>
            <p className="text-sm text-dark-text-secondary mb-4">
              确定要卸载插件 <span className="font-medium text-dark-text">{deleteTarget}</span>？
              卸载后需重启网关生效。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-dark-border px-4 py-1.5 text-sm text-dark-text-secondary hover:text-dark-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-accent-red px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-red/90 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : '卸载'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
