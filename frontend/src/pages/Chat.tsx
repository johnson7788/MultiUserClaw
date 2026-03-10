import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  Send,
  Loader2,
  Trash2,
  MessageSquare,
  Bot,
  User,
  RefreshCw,
  ChevronRight,
  Paperclip,
  X,
  FileText,
} from 'lucide-react'
import {
  listSessions,
  getSession,
  deleteSession,
  sendChatMessage,
  listAgents,
  uploadFileToWorkspace,
} from '../lib/api'
import type { Session, SessionDetail, AgentInfo } from '../lib/api'

interface PendingFile {
  id: string
  file: File
  name: string
  isImage: boolean
  previewUrl?: string
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Extract agentId from session key.
 * Format: agent:<agentId>:session-<timestamp>
 */
function getAgentIdFromKey(key: string): string {
  const parts = key.split(':')
  if (parts.length >= 2 && parts[0] === 'agent') return parts[1]
  return 'main'
}

/**
 * Get the workspace upload dir for an agent.
 * main agent → workspace/uploads
 * other agents → workspace-<agentId>/uploads
 */
function getUploadDir(agentId: string): string {
  if (agentId === 'main') return 'workspace/uploads'
  return `workspace-${agentId}/uploads`
}

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)

  // Chat
  const [messages, setMessages] = useState<SessionDetail['messages']>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Files
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // New session
  const [showNewSession, setShowNewSession] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [defaultAgentId, setDefaultAgentId] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load sessions
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const result = await listSessions()
      setSessions(result)
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Restore session from URL param
  useEffect(() => {
    const sessionKey = searchParams.get('session')
    if (sessionKey && sessionKey !== activeSessionKey) {
      loadSession(sessionKey)
    }
  }, [searchParams])

  const loadSession = async (key: string) => {
    setActiveSessionKey(key)
    setChatLoading(true)
    setError('')
    setPendingFiles([])
    setSearchParams({ session: key })
    try {
      const detail = await getSession(key)
      setMessages(detail.messages || [])
    } catch (err: any) {
      setError(err?.message || '加载会话失败')
      setMessages([])
    } finally {
      setChatLoading(false)
    }
  }

  const handleDeleteSession = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除这个会话？')) return
    try {
      await deleteSession(key)
      setSessions(prev => prev.filter(s => s.key !== key))
      if (activeSessionKey === key) {
        setActiveSessionKey(null)
        setMessages([])
        setSearchParams({})
      }
    } catch {
      // ignore
    }
  }

  const handleNewSession = async () => {
    setShowNewSession(true)
    setAgentsLoading(true)
    try {
      const result = await listAgents()
      setAgents(result.agents || [])
      setDefaultAgentId(result.defaultId || '')
    } catch {
      setAgents([])
    } finally {
      setAgentsLoading(false)
    }
  }

  const startNewSession = (agentId: string) => {
    const key = `agent:${agentId}:session-${Date.now()}`
    setActiveSessionKey(key)
    setMessages([])
    setPendingFiles([])
    setShowNewSession(false)
    setError('')
    setSearchParams({ session: key })
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // File handling
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    addFiles(Array.from(files))
    e.target.value = ''
  }

  const addFiles = (files: File[]) => {
    const newPending: PendingFile[] = files.map(file => {
      const isImg = isImageFile(file)
      const pf: PendingFile = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        isImage: isImg,
      }
      if (isImg) {
        pf.previewUrl = URL.createObjectURL(file)
      }
      return pf
    })
    setPendingFiles(prev => [...prev, ...newPending])
  }

  const removePendingFile = (id: string) => {
    setPendingFiles(prev => {
      const removed = prev.find(f => f.id === id)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter(f => f.id !== id)
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      addFiles(imageFiles)
    }
  }

  // Send message — upload all files to agent workspace first
  const handleSend = async () => {
    const text = input.trim()
    if ((!text && pendingFiles.length === 0) || !activeSessionKey || sending) return

    setSending(true)
    setError('')

    try {
      const agentId = getAgentIdFromKey(activeSessionKey)
      const uploadDir = getUploadDir(agentId)

      // Upload all files to agent workspace
      const uploadedPaths: string[] = []
      for (const pf of pendingFiles) {
        const result = await uploadFileToWorkspace(pf.file, uploadDir)
        uploadedPaths.push(result.path)
      }

      // Build final message with file references
      let finalMessage = text
      if (uploadedPaths.length > 0) {
        const fileRefs = uploadedPaths
          .map(p => `[附件: ~/.openclaw/${p}]`)
          .join('\n')
        finalMessage = finalMessage
          ? `${finalMessage}\n\n${fileRefs}`
          : fileRefs
      }

      // Optimistic UI
      const displayParts: string[] = []
      if (text) displayParts.push(text)
      if (uploadedPaths.length > 0) {
        uploadedPaths.forEach(p => {
          const name = p.split('/').pop() || p
          displayParts.push(`📎 ${name}`)
        })
      }

      const userMsg = {
        role: 'user',
        content: displayParts.join('\n'),
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
      setInput('')
      pendingFiles.forEach(pf => {
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl)
      })
      setPendingFiles([])

      await sendChatMessage(activeSessionKey, finalMessage)

      // Poll for response
      await pollForResponse(activeSessionKey, messages.length + 1)
      fetchSessions()
    } catch (err: any) {
      setError(err?.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  const pollForResponse = async (key: string, minMessages: number) => {
    const maxAttempts = 60
    const interval = 2000

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, interval))
      try {
        const detail = await getSession(key)
        const msgs = detail.messages || []
        if (msgs.length > minMessages) {
          setMessages(msgs)
          return
        }
      } catch {
        // continue polling
      }
    }
    try {
      const detail = await getSession(key)
      setMessages(detail.messages || [])
    } catch {
      // ignore
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleRefresh = () => {
    if (activeSessionKey) {
      loadSession(activeSessionKey)
    }
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (isToday) return time
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`
  }

  const hasContent = input.trim() || pendingFiles.length > 0

  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6">
      {/* Session sidebar */}
      <div className="w-64 border-r border-dark-border bg-dark-sidebar flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-dark-text">会话</h2>
          <button
            onClick={handleNewSession}
            className="flex items-center gap-1 rounded-lg bg-accent-blue px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-blue/90 transition-colors"
          >
            <Plus size={12} />
            新建
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-accent-blue" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-dark-text-secondary">
              暂无会话
            </div>
          ) : (
            <div className="py-1">
              {sessions.map(s => (
                <button
                  key={s.key}
                  onClick={() => loadSession(s.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors group ${
                    activeSessionKey === s.key
                      ? 'bg-accent-blue/10 text-accent-blue'
                      : 'text-dark-text-secondary hover:bg-dark-card hover:text-dark-text'
                  }`}
                >
                  <MessageSquare size={14} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {s.title || s.key}
                    </div>
                    <div className="text-[10px] text-dark-text-secondary mt-0.5">
                      {formatTime(s.updated_at)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(s.key, e)}
                    className="opacity-0 group-hover:opacity-100 text-dark-text-secondary hover:text-accent-red transition-all shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionKey ? (
          <>
            {/* Chat header */}
            <div className="px-5 py-3 border-b border-dark-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Bot size={16} className="text-accent-blue shrink-0" />
                <span className="text-sm font-medium text-dark-text truncate">
                  {getAgentIdFromKey(activeSessionKey)}
                </span>
                <ChevronRight size={12} className="text-dark-text-secondary shrink-0" />
                <span className="text-xs text-dark-text-secondary truncate">
                  {activeSessionKey.split(':').pop()}
                </span>
              </div>
              <button
                onClick={handleRefresh}
                className="text-dark-text-secondary hover:text-dark-text transition-colors"
                title="刷新"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {chatLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-accent-blue" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-dark-text-secondary">
                  <MessageSquare size={40} className="mb-3 opacity-30" />
                  <p className="text-sm">发送消息开始对话</p>
                  <p className="text-xs mt-1 opacity-60">支持上传图片和文件附件</p>
                </div>
              ) : (
                <div className="space-y-4 max-w-3xl mx-auto">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                    >
                      {msg.role !== 'user' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue mt-0.5">
                          <Bot size={14} />
                        </div>
                      )}
                      <div
                        className={`rounded-xl px-4 py-2.5 max-w-[80%] ${
                          msg.role === 'user'
                            ? 'bg-accent-blue text-white'
                            : 'bg-dark-card border border-dark-border text-dark-text'
                        }`}
                      >
                        <div className="text-sm whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                        {msg.timestamp && (
                          <div className={`text-[10px] mt-1 ${
                            msg.role === 'user' ? 'text-white/60' : 'text-dark-text-secondary'
                          }`}>
                            {formatTime(msg.timestamp)}
                          </div>
                        )}
                      </div>
                      {msg.role === 'user' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-purple/10 text-accent-purple mt-0.5">
                          <User size={14} />
                        </div>
                      )}
                    </div>
                  ))}
                  {sending && (
                    <div className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue mt-0.5">
                        <Bot size={14} />
                      </div>
                      <div className="rounded-xl px-4 py-2.5 bg-dark-card border border-dark-border">
                        <div className="flex items-center gap-2 text-sm text-dark-text-secondary">
                          <Loader2 size={14} className="animate-spin" />
                          思考中...
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="px-5 py-2">
                <div className="rounded-lg bg-accent-red/10 px-3 py-2 text-xs text-accent-red max-w-3xl mx-auto">
                  {error}
                </div>
              </div>
            )}

            {/* Pending files preview */}
            {pendingFiles.length > 0 && (
              <div className="px-5 pt-2 shrink-0">
                <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
                  {pendingFiles.map(pf => (
                    <div
                      key={pf.id}
                      className="relative group rounded-lg border border-dark-border bg-dark-card overflow-hidden"
                    >
                      {pf.isImage && pf.previewUrl ? (
                        <div className="relative">
                          <img
                            src={pf.previewUrl}
                            alt={pf.name}
                            className="h-16 w-16 object-cover"
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                            <div className="text-[9px] text-white truncate">{pf.name}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="h-16 w-auto flex items-center gap-2 px-3">
                          <FileText size={16} className="text-accent-blue shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs text-dark-text truncate max-w-[120px]">{pf.name}</div>
                            <div className="text-[10px] text-dark-text-secondary">{formatFileSize(pf.file.size)}</div>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => removePendingFile(pf.id)}
                        className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-5 py-3 border-t border-dark-border shrink-0">
              <div className="max-w-3xl mx-auto flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dark-border text-dark-text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors disabled:opacity-50"
                  title="上传附件（图片/文件）"
                >
                  <Paperclip size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={pendingFiles.length > 0 ? '添加说明（可选）...' : '输入消息，可粘贴图片...'}
                  rows={1}
                  className="flex-1 rounded-xl border border-dark-border bg-dark-card px-4 py-2.5 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary resize-none max-h-32"
                  style={{ minHeight: '40px' }}
                  disabled={sending}
                />
                <button
                  onClick={handleSend}
                  disabled={!hasContent || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-dark-text-secondary">
            <MessageSquare size={48} className="mb-4 opacity-20" />
            <p className="text-sm mb-4">选择一个会话或创建新会话</p>
            <button
              onClick={handleNewSession}
              className="flex items-center gap-2 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors"
            >
              <Plus size={16} />
              新建会话
            </button>
          </div>
        )}
      </div>

      {/* New session modal */}
      {showNewSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-dark-card border border-dark-border max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
              <h3 className="text-base font-semibold text-dark-text">选择 Agent</h3>
              <button
                onClick={() => setShowNewSession(false)}
                className="text-dark-text-secondary hover:text-dark-text transition-colors text-lg"
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4">
              {agentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-accent-blue" />
                </div>
              ) : agents.length === 0 ? (
                <div className="text-center py-8 text-sm text-dark-text-secondary">
                  暂无可用 Agent
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => startNewSession(agent.id)}
                      className="w-full flex items-center gap-3 rounded-xl border border-dark-border p-3 text-left hover:bg-dark-bg/50 hover:border-accent-blue/30 transition-colors group"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-lg">
                        {agent.identity?.emoji || '🤖'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-dark-text truncate">
                            {agent.identity?.name || agent.name || agent.id}
                          </span>
                          {agent.id === defaultAgentId && (
                            <span className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] text-accent-blue font-medium shrink-0">
                              默认
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-dark-text-secondary truncate mt-0.5">
                          {agent.id}
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-dark-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
