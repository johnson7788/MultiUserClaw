import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Monitor, Plug, PlugZap, TerminalSquare, Trash2 } from 'lucide-react'
import { getAccessToken } from '../lib/api'

export default function TerminalPage() {
  const [termConnected, setTermConnected] = useState(false)
  const [termOutput, setTermOutput] = useState('')
  const [termInput, setTermInput] = useState('')
  const [termCommand, setTermCommand] = useState('bash -il')
  const [termWs, setTermWs] = useState<WebSocket | null>(null)
  const [error, setError] = useState('')
  const outputRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!outputRef.current) return
    outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [termOutput])

  useEffect(() => {
    return () => {
      if (termWs) {
        try { termWs.close() } catch { /* ignore */ }
      }
    }
  }, [termWs])

  const connectTerminal = () => {
    if (termWs && termWs.readyState === WebSocket.OPEN) return

    const token = getAccessToken()
    if (!token) {
      setError('未登录或 token 已失效')
      return
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${proto}://${window.location.host}/api/openclaw/terminal/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setTermConnected(true)
      setTermOutput((prev) => `${prev}\n[connected] terminal websocket connected\n`)
      ws.send(JSON.stringify({ type: 'start', command: termCommand }))
    }

    ws.onclose = () => {
      setTermConnected(false)
      setTermOutput((prev) => `${prev}\n[disconnected] terminal websocket closed\n`)
    }

    ws.onerror = () => {
      setTermOutput((prev) => `${prev}\n[error] websocket error\n`)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data))
        if (msg.type === 'output') {
          setTermOutput((prev) => prev + String(msg.data ?? ''))
        } else if (msg.type === 'started') {
          setTermOutput((prev) => `${prev}[started] ${String(msg.command ?? '')}\n`)
        } else if (msg.type === 'exit') {
          setTermOutput((prev) => `${prev}\n[exit] code=${String(msg.code)} signal=${String(msg.signal)}\n`)
        } else if (msg.type === 'error') {
          setTermOutput((prev) => `${prev}\n[error] ${String(msg.message)}\n`)
        }
      } catch {
        setTermOutput((prev) => prev + String(evt.data))
      }
    }

    setTermWs(ws)
  }

  const disconnectTerminal = () => {
    if (!termWs) return
    try { termWs.close() } catch { /* ignore */ }
    setTermWs(null)
    setTermConnected(false)
  }

  const sendTerminalInput = () => {
    if (!termWs || termWs.readyState !== WebSocket.OPEN || !termInput) return
    termWs.send(JSON.stringify({ type: 'input', data: `${termInput}\n` }))
    setTermInput('')
  }

  useEffect(() => {
    if (!termConnected && (!termWs || termWs.readyState === WebSocket.CLOSED)) {
      connectTerminal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-text">实时终端</h1>
        <p className="mt-1 text-sm text-dark-text-secondary">连接用户容器并实时执行交互命令</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        <div className="px-5 py-3 border-b border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-dark-text-secondary" />
            <h2 className="text-sm font-semibold text-dark-text">实时终端（WS + PTY）</h2>
          </div>
          <span className={`text-xs ${termConnected ? 'text-accent-green' : 'text-dark-text-secondary'}`}>
            {termConnected ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <input
              value={termCommand}
              onChange={e => setTermCommand(e.target.value)}
              className="flex-1 rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text focus:border-accent-blue focus:outline-none"
              placeholder="启动命令，例如 bash -il"
            />
            <button
              onClick={connectTerminal}
              disabled={termConnected}
              className="inline-flex items-center gap-1 rounded-lg border border-dark-border px-3 py-2 text-xs text-dark-text-secondary hover:text-dark-text disabled:opacity-50"
            >
              <Plug size={14} /> 连接
            </button>
            <button
              onClick={disconnectTerminal}
              disabled={!termConnected}
              className="inline-flex items-center gap-1 rounded-lg border border-dark-border px-3 py-2 text-xs text-dark-text-secondary hover:text-dark-text disabled:opacity-50"
            >
              <PlugZap size={14} /> 断开
            </button>
          </div>

          <div
            ref={outputRef}
            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-dark-border bg-black p-3 font-mono text-xs text-green-200"
          >
            {termOutput || '等待连接...'}
          </div>

          <div className="flex items-center gap-2">
            <TerminalSquare size={14} className="text-dark-text-secondary" />
            <input
              value={termInput}
              onChange={e => setTermInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendTerminalInput() }}
              className="flex-1 rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text focus:border-accent-blue focus:outline-none"
              placeholder="输入命令并回车发送"
            />
            <button
              onClick={sendTerminalInput}
              className="rounded-lg border border-dark-border px-3 py-2 text-xs text-dark-text-secondary hover:text-dark-text"
            >
              发送
            </button>
            <button
              onClick={() => setTermOutput('')}
              className="inline-flex items-center gap-1 rounded-lg border border-dark-border px-3 py-2 text-xs text-dark-text-secondary hover:text-dark-text"
              title="清空输出"
            >
              <Trash2 size={14} /> 清空
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
