import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Loader2 } from 'lucide-react'
import { login, register } from '../lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await login(username, password)
      } else {
        await register(username, email, password)
      }
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-bg">
      <div className="w-full max-w-md rounded-xl border border-dark-border bg-dark-card p-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-blue">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-dark-text">OpenClaw AI</h1>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder={mode === 'login' ? '用户名或邮箱' : '用户名'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-lg border border-dark-border bg-dark-bg px-4 py-2.5 text-sm text-dark-text outline-none focus:border-accent-blue"
            />
          </div>

          {mode === 'register' && (
            <div>
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-dark-border bg-dark-bg px-4 py-2.5 text-sm text-dark-text outline-none focus:border-accent-blue"
              />
            </div>
          )}

          <div>
            <input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-dark-border bg-dark-bg px-4 py-2.5 text-sm text-dark-text outline-none focus:border-accent-blue"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent-blue py-2.5 text-sm font-medium text-white hover:bg-accent-blue/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            ) : mode === 'login' ? (
              '登录'
            ) : (
              '注册'
            )}
          </button>
        </form>

        {/* Toggle */}
        <p className="mt-6 text-center text-sm text-dark-muted">
          {mode === 'login' ? (
            <>
              还没有账号？{' '}
              <button
                type="button"
                onClick={() => { setMode('register'); setError('') }}
                className="text-accent-blue hover:underline"
              >
                注册
              </button>
            </>
          ) : (
            <>
              已有账号？{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError('') }}
                className="text-accent-blue hover:underline"
              >
                登录
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
