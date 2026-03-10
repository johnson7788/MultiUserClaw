// API client for OpenClaw Platform Gateway (multi-tenant mode)

const API_URL = import.meta.env.VITE_API_URL || ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface AuthUser {
  id: string
  username: string
  email: string
  created_at: string
}

export interface AgentInfo {
  id: string
  name: string
  identity?: {
    name?: string
    emoji?: string
    avatar?: string
    theme?: string
    avatarUrl?: string
  }
}

export interface AgentListResult {
  defaultId: string
  mainKey: string
  scope: string
  agents: AgentInfo[]
}

export interface AgentFileEntry {
  name: string
  path: string
  missing: boolean
  size: number
  updatedAtMs: number
}

export interface AgentFilesResult {
  agentId: string
  workspace: string
  files: AgentFileEntry[]
}

export interface AgentFileContent {
  agentId: string
  workspace: string
  file: { name: string; content: string }
}

export interface Session {
  key: string
  title?: string
  created_at: string | null
  updated_at: string | null
}

export interface SessionDetail {
  key: string
  messages: Array<{
    role: string
    content: string
    timestamp: string | null
  }>
  created_at: string | null
  updated_at: string | null
}

export interface Skill {
  name: string
  description: string
  source?: string
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'openclaw_access_token'
const REFRESH_TOKEN_KEY = 'openclaw_refresh_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null
}

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken()
  if (!refresh) return false

  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) return false
      const data: TokenResponse = await res.json()
      setTokens(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function fetchJSON<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res = await fetch(`${API_URL}${path}`, { ...options, headers })

  // On 401 attempt a silent token refresh and retry once
  if (res.status === 401 && token) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`
      res = await fetch(`${API_URL}${path}`, { ...options, headers })
    } else {
      clearTokens()
      window.location.href = '/login'
      throw new Error('Session expired')
    }
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Auth functions
// ---------------------------------------------------------------------------

export async function register(
  username: string,
  email: string,
  password: string,
): Promise<TokenResponse> {
  const data = await fetchJSON<TokenResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  })
  setTokens(data.access_token, data.refresh_token)
  return data
}

export async function login(
  username: string,
  password: string,
): Promise<TokenResponse> {
  const data = await fetchJSON<TokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setTokens(data.access_token, data.refresh_token)
  return data
}

export function logout(): void {
  clearTokens()
  window.location.href = '/login'
}

export async function getMe(): Promise<AuthUser> {
  return fetchJSON<AuthUser>('/api/auth/me')
}

// ---------------------------------------------------------------------------
// Agent functions
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<AgentListResult> {
  return fetchJSON<AgentListResult>('/api/openclaw/agents')
}

export async function createAgent(
  name: string,
  workspace?: string,
): Promise<AgentInfo> {
  return fetchJSON<AgentInfo>('/api/openclaw/agents', {
    method: 'POST',
    body: JSON.stringify({ name, workspace }),
  })
}

export async function updateAgent(
  agentId: string,
  updates: { name?: string; workspace?: string; model?: string; avatar?: string },
): Promise<Record<string, unknown>> {
  return fetchJSON<Record<string, unknown>>(`/api/openclaw/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteAgent(
  agentId: string,
  deleteFiles?: boolean,
): Promise<void> {
  const params = deleteFiles ? '?delete_files=true' : ''
  await fetchJSON<unknown>(`/api/openclaw/agents/${encodeURIComponent(agentId)}${params}`, {
    method: 'DELETE',
  })
}

export async function listAgentFiles(
  agentId: string,
): Promise<AgentFilesResult> {
  return fetchJSON<AgentFilesResult>(`/api/openclaw/agents/${encodeURIComponent(agentId)}/files`)
}

export async function getAgentFile(
  agentId: string,
  name: string,
): Promise<AgentFileContent> {
  return fetchJSON<AgentFileContent>(`/api/openclaw/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`)
}

export async function setAgentFile(
  agentId: string,
  name: string,
  content: string,
): Promise<void> {
  await fetchJSON<unknown>(
    `/api/openclaw/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    },
  )
}

// ---------------------------------------------------------------------------
// Session functions
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<Session[]> {
  return fetchJSON<Session[]>('/api/openclaw/sessions')
}

export async function getSession(key: string): Promise<SessionDetail> {
  return fetchJSON<SessionDetail>(`/api/openclaw/sessions/${encodeURIComponent(key)}`)
}

export async function deleteSession(key: string): Promise<void> {
  await fetchJSON<unknown>(`/api/openclaw/sessions/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Chat functions
// ---------------------------------------------------------------------------

export async function sendChatMessage(
  sessionKey: string,
  message: string,
): Promise<{ ok: boolean; runId: string | null }> {
  return fetchJSON<{ ok: boolean; runId: string | null }>(
    `/api/openclaw/sessions/${encodeURIComponent(sessionKey)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ message }),
    },
  )
}

export async function uploadFileToWorkspace(
  file: File,
  targetDir = 'workspace/uploads',
): Promise<{ name: string; path: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('path', targetDir)

  const token = getAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/openclaw/filemanager/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Other
// ---------------------------------------------------------------------------

export async function listSkills(): Promise<Skill[]> {
  return fetchJSON<Skill[]>('/api/openclaw/skills')
}

export async function toggleSkill(name: string, enabled: boolean): Promise<void> {
  await fetchJSON(`/api/openclaw/skills/${encodeURIComponent(name)}/toggle`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

export async function getStatus(): Promise<Record<string, unknown>> {
  return fetchJSON<Record<string, unknown>>('/api/openclaw/status')
}

export async function ping(): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/api/ping`)
  if (!res.ok) throw new Error(`Ping failed: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule_kind: string
  schedule_display: string
  schedule_expr: string | null
  schedule_every_ms: number | null
  message: string
  deliver: boolean
  channel: string | null
  to: string | null
  next_run_at_ms: number | null
  last_run_at_ms: number | null
  last_status: string | null
  last_error: string | null
  created_at_ms: number
}

export async function listCronJobs(includeDisabled = true): Promise<CronJob[]> {
  const params = includeDisabled ? '?include_disabled=true' : ''
  return fetchJSON<CronJob[]>(`/api/openclaw/cron/jobs${params}`)
}

export async function createCronJob(params: {
  name: string
  message: string
  every_seconds?: number
  cron_expr?: string
  at_iso?: string
  deliver?: boolean
  channel?: string
  to?: string
}): Promise<CronJob> {
  return fetchJSON<CronJob>('/api/openclaw/cron/jobs', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function deleteCronJob(jobId: string): Promise<void> {
  await fetchJSON<unknown>(`/api/openclaw/cron/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export async function toggleCronJob(jobId: string, enabled: boolean): Promise<CronJob> {
  return fetchJSON<CronJob>(
    `/api/openclaw/cron/jobs/${encodeURIComponent(jobId)}/toggle`,
    {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    },
  )
}

export async function runCronJob(jobId: string): Promise<void> {
  await fetchJSON<unknown>(
    `/api/openclaw/cron/jobs/${encodeURIComponent(jobId)}/run`,
    { method: 'POST' },
  )
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelChoice {
  id: string
  name: string
  provider: string
  contextWindow?: number
  reasoning?: boolean
}

export interface ModelsResult {
  models: ModelChoice[]
  configuredModel: string
  configuredProviders: Record<string, unknown>
}

export async function listModels(): Promise<ModelsResult> {
  return fetchJSON<ModelsResult>('/api/openclaw/models')
}

export async function updateModelsConfig(params: {
  providers?: Record<string, unknown>
  defaultModel?: string
}): Promise<void> {
  await fetchJSON<unknown>('/api/openclaw/models/config', {
    method: 'PUT',
    body: JSON.stringify(params),
  })
}

// ---------------------------------------------------------------------------
// File manager (~/.openclaw)
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number | null
  content_type?: string | null
  modified: string
}

export interface BrowseResult {
  type: 'directory'
  path: string
  root: string
  items: FileEntry[]
}

export interface FileContentResult {
  type: 'file'
  path: string
  name: string
  size: number
  content_type: string
  modified: string
  content?: string
}

export async function browseFiles(dirPath = ''): Promise<BrowseResult> {
  const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
  return fetchJSON<BrowseResult>(`/api/openclaw/filemanager/browse${params}`)
}

export async function downloadFileUrl(filePath: string): Promise<string> {
  const token = getAccessToken()
  const params = `?path=${encodeURIComponent(filePath)}`
  return `${API_URL}/api/openclaw/filemanager/download${params}${token ? `&token=${token}` : ''}`
}

export async function uploadFile(file: File, dirPath = ''): Promise<FileEntry> {
  const formData = new FormData()
  formData.append('file', file)
  if (dirPath) formData.append('path', dirPath)

  const token = getAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/openclaw/filemanager/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Upload failed: ${body}`)
  }
  return res.json()
}

export async function deleteFile(filePath: string): Promise<void> {
  await fetchJSON<unknown>(
    `/api/openclaw/filemanager/delete?path=${encodeURIComponent(filePath)}`,
    { method: 'DELETE' },
  )
}

export async function createDirectory(dirPath: string): Promise<void> {
  await fetchJSON<unknown>(
    `/api/openclaw/filemanager/mkdir?path=${encodeURIComponent(dirPath)}`,
    { method: 'POST' },
  )
}

// ---------------------------------------------------------------------------
// Skills marketplace (skills.sh)
// ---------------------------------------------------------------------------

export interface SkillSearchResult {
  slug: string
  url: string
  installs: string
}

export async function searchSkills(
  query: string,
  limit = 10,
): Promise<{ results: SkillSearchResult[] }> {
  return fetchJSON<{ results: SkillSearchResult[] }>(
    '/api/openclaw/marketplaces/skills/search',
    {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    },
  )
}

export async function installSkill(
  slug: string,
): Promise<{ ok: boolean; output: string }> {
  return fetchJSON<{ ok: boolean; output: string }>(
    '/api/openclaw/marketplaces/skills/install',
    {
      method: 'POST',
      body: JSON.stringify({ slug }),
    },
  )
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelAccountSnapshot {
  accountId: string
  name?: string | null
  enabled?: boolean | null
  configured?: boolean | null
  linked?: boolean | null
  running?: boolean | null
  connected?: boolean | null
  reconnectAttempts?: number | null
  lastConnectedAt?: number | null
  lastError?: string | null
  mode?: string
  webhookUrl?: string
  [key: string]: unknown
}

export interface ChannelMetaEntry {
  id: string
  label: string
  detailLabel: string
  systemImage?: string
}

export interface ChannelsStatusResult {
  ts: number
  channelOrder: string[]
  channelLabels: Record<string, string>
  channelDetailLabels?: Record<string, string>
  channelSystemImages?: Record<string, string>
  channelMeta?: ChannelMetaEntry[]
  channels: Record<string, unknown>
  channelAccounts: Record<string, ChannelAccountSnapshot[]>
  channelDefaultAccountId: Record<string, string>
}

export async function getChannelsStatus(probe = false): Promise<ChannelsStatusResult> {
  const params = probe ? '?probe=true' : ''
  return fetchJSON<ChannelsStatusResult>(`/api/openclaw/channels/status${params}`)
}

export async function getConfiguredChannels(): Promise<{ success: boolean; channels: string[] }> {
  return fetchJSON<{ success: boolean; channels: string[] }>('/api/openclaw/channels/configured')
}

export async function getChannelConfig(channelType: string): Promise<{ config: Record<string, unknown> | null }> {
  return fetchJSON<{ config: Record<string, unknown> | null }>(
    `/api/openclaw/channels/${encodeURIComponent(channelType)}/config`,
  )
}

export async function saveChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(
    `/api/openclaw/channels/${encodeURIComponent(channelType)}/config`,
    {
      method: 'PUT',
      body: JSON.stringify(config),
    },
  )
}

export async function deleteChannelConfig(channelType: string): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(
    `/api/openclaw/channels/${encodeURIComponent(channelType)}/config`,
    { method: 'DELETE' },
  )
}

export async function logoutChannel(
  channelType: string,
  accountId?: string,
): Promise<Record<string, unknown>> {
  return fetchJSON<Record<string, unknown>>(
    `/api/openclaw/channels/${encodeURIComponent(channelType)}/logout`,
    {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    },
  )
}
