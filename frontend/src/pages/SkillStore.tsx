import { useState, useEffect } from 'react'
import { listSkills, searchSkills, installSkill, toggleSkill } from '../lib/api'
import type { Skill, SkillSearchResult } from '../lib/api'
import { Zap, Loader2, Search, Download, ExternalLink, Check } from 'lucide-react'

export default function SkillStore() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  // Search state
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SkillSearchResult[]>([])
  const [searched, setSearched] = useState(false)

  // Install state
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [installError, setInstallError] = useState('')

  // Toggle state
  const [toggling, setToggling] = useState<string | null>(null)

  const refreshSkills = () => {
    listSkills().then(setSkills).catch(() => setSkills([]))
  }

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [])

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim() || searching) return
    setSearching(true)
    setSearched(true)
    setInstallError('')
    try {
      const data = await searchSkills(query.trim(), 10)
      setResults(data.results || [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleInstall = async (slug: string) => {
    if (installing) return
    setInstalling(slug)
    setInstallError('')
    try {
      await installSkill(slug)
      setInstalled(prev => new Set(prev).add(slug))
      refreshSkills()
    } catch (err: any) {
      setInstallError(err?.message || '安装失败')
    } finally {
      setInstalling(null)
    }
  }

  const handleToggle = async (skill: Skill) => {
    if (toggling) return
    const newEnabled = skill.disabled !== false // if disabled or undefined, enable it
    setToggling(skill.name)
    try {
      await toggleSkill(skill.name, newEnabled)
      // Update local state immediately
      setSkills(prev =>
        prev.map(s =>
          s.name === skill.name ? { ...s, disabled: !newEnabled } : s
        )
      )
    } catch {
      // Revert on error — refresh from server
      refreshSkills()
    } finally {
      setToggling(null)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-text">技能商店</h1>
        <p className="mt-1 text-sm text-dark-text-secondary">
          搜索并安装来自 <a href="https://skills.sh/" target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">skills.sh</a> 的 AI 技能扩展
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6 flex gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-dark-border bg-dark-card px-4 py-2.5">
          <Search size={16} className="text-dark-text-secondary" />
          <input
            type="text"
            placeholder="搜索技能，例如：web scraping, react, testing..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-dark-text outline-none placeholder:text-dark-text-secondary"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="flex items-center gap-2 rounded-lg bg-accent-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-blue/90 disabled:opacity-50 transition-colors"
        >
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          搜索
        </button>
      </form>

      {installError && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red">
          {installError}
        </div>
      )}

      {/* Search results */}
      {searched && (
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-dark-text">
            搜索结果
            {results.length > 0 && <span className="ml-2 text-sm font-normal text-dark-text-secondary">({results.length} 个技能)</span>}
          </h2>
          {searching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-accent-blue" />
              <span className="ml-3 text-sm text-dark-text-secondary">正在搜索...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center text-sm text-dark-text-secondary">
              未找到相关技能，请尝试其他关键词
            </div>
          ) : (
            <div className="space-y-2">
              {results.map(r => {
                const isInstalled = installed.has(r.slug)
                const isInstalling = installing === r.slug
                return (
                  <div key={r.slug} className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-card px-5 py-3.5 hover:border-accent-blue/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-dark-text truncate">{r.slug}</span>
                        <span className="shrink-0 rounded bg-dark-bg px-2 py-0.5 text-xs text-dark-text-secondary">{r.installs}</span>
                      </div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-xs text-accent-blue/70 hover:text-accent-blue truncate"
                      >
                        <ExternalLink size={11} />
                        {r.url}
                      </a>
                    </div>
                    <button
                      onClick={() => handleInstall(r.slug)}
                      disabled={isInstalling || isInstalled}
                      className={`ml-4 flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                        isInstalled
                          ? 'bg-accent-green/10 text-accent-green'
                          : 'bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 disabled:opacity-50'
                      }`}
                    >
                      {isInstalling ? (
                        <><Loader2 size={13} className="animate-spin" /> 安装中...</>
                      ) : isInstalled ? (
                        <><Check size={13} /> 已安装</>
                      ) : (
                        <><Download size={13} /> 安装</>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Installed skills */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-dark-text">
          已安装技能
          {skills.length > 0 && <span className="ml-2 text-sm font-normal text-dark-text-secondary">({skills.length})</span>}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent-blue" />
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center text-sm text-dark-text-secondary">
            暂无已安装技能，使用上方搜索栏查找并安装
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {skills.map(skill => {
              const isDisabled = skill.disabled === true
              const isToggling = toggling === skill.name
              return (
                <div
                  key={skill.name}
                  className={`rounded-xl border bg-dark-card p-5 transition-colors ${
                    isDisabled
                      ? 'border-dark-border/50 opacity-60'
                      : 'border-dark-border hover:border-accent-blue/30'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-yellow/10">
                      <Zap size={20} className={isDisabled ? 'text-dark-text-secondary' : 'text-accent-yellow'} />
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggle(skill)}
                      disabled={isToggling}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        isDisabled ? 'bg-dark-border' : 'bg-accent-green'
                      } ${isToggling ? 'opacity-50' : 'cursor-pointer'}`}
                      title={isDisabled ? '点击启用' : '点击禁用'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                          isDisabled ? 'translate-x-0.5' : 'translate-x-[18px]'
                        }`}
                      />
                    </button>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-dark-text">{skill.name}</h3>
                  <p className="mt-1 text-xs text-dark-text-secondary leading-relaxed line-clamp-2">{skill.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    {skill.source && (
                      <span className="text-xs text-dark-text-secondary">
                        来源: {skill.source}
                      </span>
                    )}
                    {isDisabled && (
                      <span className="text-xs text-accent-yellow">已禁用</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
