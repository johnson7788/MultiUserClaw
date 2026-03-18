import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { getMe, listAgents, changePassword, logout } from '../lib/api'
import type { AuthUser } from '../lib/api'
import Brand from './Brand'
import {
  LayoutDashboard,
  Bot,
  Zap,
  Radio,
  Brain,
  FolderOpen,
  BookOpen,
  MessageSquare,
  Clock,
  Monitor,
  Code2,
  Settings,
  User,
  Puzzle,
  KeyRound,
  LogOut,
  X,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'

const navSections = [
  {
    label: '概览',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { to: '/agents', icon: Bot, label: 'Agents', badgeKey: 'agents' },
      { to: '/chat', icon: MessageSquare, label: '会话' },
    ],
  },
  {
    label: '技能中心',
    items: [
      { to: '/skills', icon: Zap, label: '技能商店' },
      { to: '/channels', icon: Radio, label: '渠道管理' },
      { to: '/plugins', icon: Puzzle, label: '插件管理' },
      { to: '/models', icon: Brain, label: 'AI 模型' },
      { to: '/files', icon: FolderOpen, label: '文件管理' },
      { to: '/knowledge', icon: BookOpen, label: '知识库' },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/terminal', icon: Monitor, label: '实时终端' },
      { to: '/sessions', icon: MessageSquare, label: '会话历史' },
      { to: '/cron', icon: Clock, label: '定时任务' },
      { to: '/nodes', icon: Monitor, label: 'Node 管理' },
      { to: '/api', icon: Code2, label: 'API设定' },
      { to: '/settings', icon: Settings, label: '系统设置' },
    ],
  },
]

export default function Sidebar() {
  const location = useLocation()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [agentCount, setAgentCount] = useState<number>(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwdModalOpen, setPwdModalOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [pwdSuccess, setPwdSuccess] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getMe().then(setUser).catch(() => {})
    listAgents().then(r => setAgentCount(r.agents?.length ?? 0)).catch(() => {})
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const openPwdModal = () => {
    setMenuOpen(false)
    setOldPwd('')
    setNewPwd('')
    setConfirmPwd('')
    setPwdError('')
    setPwdSuccess('')
    setShowOld(false)
    setShowNew(false)
    setPwdModalOpen(true)
  }

  const handleChangePwd = async () => {
    setPwdError('')
    setPwdSuccess('')
    if (!oldPwd) { setPwdError('请输入旧密码'); return }
    if (newPwd.length < 6) { setPwdError('新密码至少需要6个字符'); return }
    if (newPwd !== confirmPwd) { setPwdError('两次输入的新密码不一致'); return }
    setPwdLoading(true)
    try {
      await changePassword(oldPwd, newPwd)
      setPwdSuccess('密码修改成功')
      setTimeout(() => setPwdModalOpen(false), 1500)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '修改失败'
      setPwdError(msg.includes('旧密码不正确') ? '旧密码不正确' : msg)
    } finally {
      setPwdLoading(false)
    }
  }

  return (
    <aside className="flex w-56 flex-col bg-dark-sidebar border-r border-dark-border">
      {/* Logo */}
      <Brand />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {navSections.map(section => (
          <div key={section.label} className="mb-4">
            <div className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wider text-dark-text-secondary">
              {section.label}
            </div>
            {section.items.map(item => {
              const Icon = item.icon
              const isActive = location.pathname === item.to ||
                (item.to !== '/dashboard' && location.pathname.startsWith(item.to))
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'text-dark-text-secondary hover:bg-dark-card hover:text-dark-text'
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {'badgeKey' in item && item.badgeKey === 'agents' && agentCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-blue/20 px-1 text-xs text-accent-blue">
                      {agentCount}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="relative border-t border-dark-border px-4 py-3" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex w-full items-center gap-3 rounded-lg p-1 hover:bg-dark-card transition-colors"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-purple text-sm font-medium text-white">
            <User size={16} />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-dark-text">{user?.username ?? 'Admin'}</div>
            <div className="text-xs text-dark-text-secondary">{user?.email ?? ''}</div>
          </div>
        </button>

        {/* Popup menu */}
        {menuOpen && (
          <div className="absolute bottom-full left-4 mb-2 w-48 rounded-lg border border-dark-border bg-dark-sidebar shadow-lg py-1 z-50">
            <button
              onClick={openPwdModal}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-dark-text hover:bg-dark-card transition-colors"
            >
              <KeyRound size={15} />
              修改密码
            </button>
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-accent-red hover:bg-dark-card transition-colors"
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        )}
      </div>

      {/* Password Change Modal */}
      {pwdModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-xl border border-dark-border bg-dark-sidebar p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-dark-text">修改密码</h3>
              <button onClick={() => setPwdModalOpen(false)} className="text-dark-text-secondary hover:text-dark-text">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Old password */}
              <div>
                <label className="block text-xs text-dark-text-secondary mb-1">旧密码</label>
                <div className="relative">
                  <input
                    type={showOld ? 'text' : 'password'}
                    value={oldPwd}
                    onChange={e => setOldPwd(e.target.value)}
                    className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 pr-9 text-sm text-dark-text focus:border-accent-blue focus:outline-none"
                    placeholder="请输入旧密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOld(!showOld)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-text-secondary hover:text-dark-text"
                  >
                    {showOld ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs text-dark-text-secondary mb-1">新密码</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPwd}
                    onChange={e => setNewPwd(e.target.value)}
                    className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 pr-9 text-sm text-dark-text focus:border-accent-blue focus:outline-none"
                    placeholder="至少6个字符"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-text-secondary hover:text-dark-text"
                  >
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs text-dark-text-secondary mb-1">确认新密码</label>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleChangePwd()}
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text focus:border-accent-blue focus:outline-none"
                  placeholder="再次输入新密码"
                />
              </div>

              {/* Error / Success */}
              {pwdError && <div className="rounded-lg bg-accent-red/10 px-3 py-2 text-xs text-accent-red">{pwdError}</div>}
              {pwdSuccess && <div className="rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">{pwdSuccess}</div>}

              {/* Submit */}
              <button
                onClick={handleChangePwd}
                disabled={pwdLoading}
                className="w-full rounded-lg bg-accent-blue py-2 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {pwdLoading && <Loader2 size={14} className="animate-spin" />}
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
