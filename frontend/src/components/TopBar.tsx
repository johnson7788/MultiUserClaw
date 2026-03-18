import { Settings, LogOut } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ping, logout } from '../lib/api'
import NotificationBell from './NotificationBell'

export default function TopBar() {
  const navigate = useNavigate()
  const [online, setOnline] = useState(false)

  useEffect(() => {
    const check = () =>
      ping().then(() => setOnline(true)).catch(() => setOnline(false))
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <header className="flex h-14 items-center justify-between border-b border-dark-border bg-dark-sidebar px-6">
      <div />

      {/* Right side */}
      <div className="flex items-center gap-4">
        <div
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            online
              ? 'border border-accent-green/30 text-accent-green'
              : 'border border-accent-red/30 text-accent-red'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              online ? 'bg-accent-green' : 'bg-accent-red'
            }`}
          />
          {online ? '服务运行中' : '服务离线'}
        </div>

        {/* ✅ 使用组件 */}
        <NotificationBell />

        {/* 设置 */}
        <button
          onClick={() => navigate('/settings')}
          className="text-dark-text-secondary hover:text-dark-text transition-colors"
          title="系统设置"
        >
          <Settings size={20} />
        </button>

        {/* 退出 */}
        <button
          onClick={() => logout()}
          className="text-dark-text-secondary hover:text-accent-red transition-colors"
          title="退出登录"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  )
}