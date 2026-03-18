import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { getMe, listAgents } from '../lib/api'
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

  useEffect(() => {
    getMe().then(setUser).catch(() => {})
    listAgents().then(r => setAgentCount(r.agents?.length ?? 0)).catch(() => {})
  }, [])

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
      <div className="border-t border-dark-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-purple text-sm font-medium text-white">
            <User size={16} />
          </div>
          <div>
            <div className="text-sm font-medium text-dark-text">{user?.username ?? 'Admin'}</div>
            <div className="text-xs text-dark-text-secondary">{user?.email ?? ''}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
