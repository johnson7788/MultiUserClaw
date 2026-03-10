import { useState, useEffect } from 'react'
import { listSessions, deleteSession, getSession } from '../lib/api'
import type { Session, SessionDetail } from '../lib/api'
import {
  Clock,
  Loader2,
  Trash2,
  Eye,
  X,
  RefreshCw,
  MessageSquare,
  User,
  Bot,
} from 'lucide-react'

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const fetchSessionList = () => {
    setLoading(true)
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSessionList()
  }, [])

  const handleDelete = async (key: string) => {
    if (!confirm('确定删除该会话？')) return
    try {
      await deleteSession(key)
      if (selectedKey === key) {
        setSelectedKey(null)
        setDetail(null)
      }
      fetchSessionList()
    } catch {
      // ignore
    }
  }

  const handleView = async (key: string) => {
    if (selectedKey === key) {
      setSelectedKey(null)
      setDetail(null)
      return
    }
    setSelectedKey(key)
    setDetailLoading(true)
    try {
      const d = await getSession(key)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Left: session list */}
      <div className={`flex-1 min-w-0 ${selectedKey ? 'max-w-[55%]' : ''}`}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-dark-text">会话历史</h1>
            <p className="mt-1 text-sm text-dark-text-secondary">查看所有 Agent 的对话记录</p>
          </div>
          <button
            onClick={fetchSessionList}
            className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-dark-text-secondary hover:text-dark-text transition-colors"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-accent-blue" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-dark-text-secondary">
            <MessageSquare size={32} className="mb-3 opacity-40" />
            暂无会话记录
          </div>
        ) : (
          <div className="rounded-xl border border-dark-border bg-dark-card">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-dark-text-secondary border-b border-dark-border">
                  <th className="px-5 py-3 font-medium">会话</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium">最近更新</th>
                  <th className="px-4 py-3 font-medium text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr
                    key={s.key}
                    className={`border-t border-dark-border/50 transition-colors cursor-pointer ${
                      selectedKey === s.key
                        ? 'bg-accent-blue/5'
                        : 'hover:bg-dark-card-hover'
                    }`}
                    onClick={() => handleView(s.key)}
                  >
                    <td className="px-5 py-3 text-sm text-dark-text max-w-[240px] truncate">
                      {s.title || s.key}
                    </td>
                    <td className="px-4 py-3 text-sm text-dark-text-secondary whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Clock size={14} />
                        {formatTime(s.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-dark-text-secondary whitespace-nowrap">
                      {formatTime(s.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); handleView(s.key) }}
                          className={`transition-colors ${
                            selectedKey === s.key
                              ? 'text-accent-blue'
                              : 'text-dark-text-secondary hover:text-accent-blue'
                          }`}
                          title="查看会话"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(s.key) }}
                          className="text-dark-text-secondary hover:text-accent-red transition-colors"
                          title="删除会话"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      {selectedKey && (
        <div className="w-[45%] min-w-[360px] flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 border-b border-dark-border flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-dark-text truncate">
                {sessions.find(s => s.key === selectedKey)?.title || selectedKey}
              </h2>
              {detail && (
                <p className="text-xs text-dark-text-secondary mt-0.5">
                  {detail.messages.length} 条消息
                  {detail.created_at && ` · 创建于 ${formatTime(detail.created_at)}`}
                </p>
              )}
            </div>
            <button
              onClick={() => { setSelectedKey(null); setDetail(null) }}
              className="text-dark-text-secondary hover:text-dark-text transition-colors shrink-0 ml-3"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-accent-blue" />
              </div>
            ) : !detail || detail.messages.length === 0 ? (
              <div className="text-center text-sm text-dark-text-secondary py-12">
                暂无消息记录
              </div>
            ) : (
              detail.messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? '' : ''}`}>
                  <div className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-white ${
                    msg.role === 'user' ? 'bg-accent-blue' : 'bg-accent-purple'
                  }`}>
                    {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-dark-text">
                        {msg.role === 'user' ? '用户' : 'Agent'}
                      </span>
                      {msg.timestamp && (
                        <span className="text-xs text-dark-text-secondary">
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-dark-text whitespace-pre-wrap break-words leading-relaxed bg-dark-bg rounded-lg px-3 py-2">
                      {msg.content || '(空消息)'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '-'
  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return t
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return t
  }
}
