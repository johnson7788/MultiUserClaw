// Nanobot API client — multi-tenant edition
//
// In multi-tenant mode the frontend talks to the Platform Gateway.
// Auth requests go to /api/auth/*, nanobot requests are proxied via
// /api/nanobot/* to the user's container.

import type { ChatMessage, Session, SessionDetail, SystemStatus, CronJob, Skill, SlashCommand, PluginInfo, TokenResponse, AuthUser, FileAttachment } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'nanobot_access_token';
const REFRESH_KEY = 'nanobot_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAccessToken();
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: authHeaders(),
    ...options,
  });

  if (res.status === 401) {
    // Try refresh
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // Retry with new token
      const retry = await fetch(`${API_URL}${path}`, {
        headers: authHeaders(),
        ...options,
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`API error ${retry.status}: ${text}`);
      }
      return retry.json();
    }
    // Refresh failed — force logout
    clearTokens();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function tryRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data: TokenResponse = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export async function register(username: string, email: string, password: string): Promise<TokenResponse> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: 'Registration failed' }));
    throw new Error(data.detail || 'Registration failed');
  }
  const data: TokenResponse = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(username: string, password: string): Promise<TokenResponse> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: 'Login failed' }));
    throw new Error(data.detail || 'Invalid credentials');
  }
  const data: TokenResponse = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export function logout(): void {
  clearTokens();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export async function getMe(): Promise<AuthUser> {
  return fetchJSON('/api/auth/me');
}

// ---------------------------------------------------------------------------
// Chat (proxied via /api/nanobot/)
// ---------------------------------------------------------------------------

export async function sendMessage(
  message: string,
  sessionId: string = 'web:default',
  attachments?: FileAttachment[]
): Promise<{ response?: string; status?: string; session_id: string }> {
  const body: Record<string, unknown> = { message, session_id: sessionId };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  return fetchJSON('/api/nanobot/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function streamMessage(
  message: string,
  sessionId: string,
  onChunk: (content: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_URL}/api/nanobot/chat/stream`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message, session_id: sessionId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content') {
              onChunk(parsed.content);
            } else if (parsed.type === 'done') {
              onDone();
            } else if (parsed.type === 'error') {
              onError(parsed.error);
            }
          } catch {
            // skip parse errors
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Stream error');
      }
    }
  })();

  return () => controller.abort();
}

// ---------------------------------------------------------------------------
// WebSocket Manager
// ---------------------------------------------------------------------------

export type WsStatus = 'disconnected' | 'connecting' | 'connected';

export type WsMessageHandler = (data: {
  type: string;
  role?: string;
  content?: string;
  status?: string;
  attachments?: FileAttachment[];
}) => void;

export type WsStatusListener = (status: WsStatus) => void;

function getWsUrl(): string {
  const url = new URL(API_URL);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}`;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private messageHandlers: WsMessageHandler[] = [];
  private statusListeners: WsStatusListener[] = [];
  private status: WsStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private intentionalClose = false;

  connect(sessionId: string): void {
    if (this.sessionId === sessionId && this.ws?.readyState === globalThis.WebSocket?.OPEN) {
      return;
    }

    this.intentionalClose = false;
    this.sessionId = sessionId;
    this.reconnectDelay = 1000;
    this._connect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._cleanup();
    this._setStatus('disconnected');
  }

  sendMessage(content: string): void {
    if (this.ws?.readyState === globalThis.WebSocket?.OPEN) {
      this.ws.send(JSON.stringify({ type: 'message', content }));
    }
  }

  sendRaw(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === globalThis.WebSocket?.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  onMessage(handler: WsMessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(listener: WsStatusListener): () => void {
    this.statusListeners.push(listener);
    listener(this.status);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private _connect(): void {
    this._cleanup();

    if (!this.sessionId) return;

    this._setStatus('connecting');

    // In multi-tenant mode, connect through the gateway with auth token
    const wsUrl = getWsUrl();
    const token = getAccessToken() || '';
    const ws = new globalThis.WebSocket(
      `${wsUrl}/api/nanobot/ws/${this.sessionId}?token=${encodeURIComponent(token)}`
    );

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this._setStatus('connected');
      this._startPing();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        for (const handler of this.messageHandlers) {
          handler(data);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      this._stopPing();
      if (!this.intentionalClose) {
        this._setStatus('disconnected');
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };

    this.ws = ws;
  }

  private _cleanup(): void {
    this._stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === globalThis.WebSocket?.OPEN ||
          this.ws.readyState === globalThis.WebSocket?.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === globalThis.WebSocket?.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

export const wsManager = new WebSocketManager();

// ---------------------------------------------------------------------------
// Sessions (proxied)
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<Session[]> {
  return fetchJSON('/api/nanobot/sessions');
}

export async function getSession(key: string): Promise<SessionDetail> {
  return fetchJSON(`/api/nanobot/sessions/${encodeURIComponent(key)}`);
}

export async function deleteSession(key: string): Promise<void> {
  await fetchJSON(`/api/nanobot/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Status (proxied)
// ---------------------------------------------------------------------------

export async function getStatus(): Promise<SystemStatus> {
  return fetchJSON('/api/nanobot/status');
}

// ---------------------------------------------------------------------------
// Cron (proxied)
// ---------------------------------------------------------------------------

export async function listCronJobs(includeDisabled: boolean = true): Promise<CronJob[]> {
  return fetchJSON(`/api/nanobot/cron/jobs?include_disabled=${includeDisabled}`);
}

export async function addCronJob(params: {
  name: string;
  message: string;
  every_seconds?: number;
  cron_expr?: string;
  at_iso?: string;
}): Promise<CronJob> {
  return fetchJSON('/api/nanobot/cron/jobs', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function removeCronJob(jobId: string): Promise<void> {
  await fetchJSON(`/api/nanobot/cron/jobs/${jobId}`, { method: 'DELETE' });
}

export async function toggleCronJob(jobId: string, enabled: boolean): Promise<CronJob> {
  return fetchJSON(`/api/nanobot/cron/jobs/${jobId}/toggle`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export async function runCronJob(jobId: string): Promise<void> {
  await fetchJSON(`/api/nanobot/cron/jobs/${jobId}/run`, { method: 'POST' });
}

export async function ping(): Promise<{ message: string }> {
  return fetchJSON('/api/ping');
}

// ---------------------------------------------------------------------------
// Skills (proxied)
// ---------------------------------------------------------------------------

export async function listSkills(): Promise<Skill[]> {
  return fetchJSON('/api/nanobot/skills');
}

export async function listCommands(): Promise<SlashCommand[]> {
  return fetchJSON('/api/nanobot/commands');
}

export async function listPlugins(): Promise<PluginInfo[]> {
  return fetchJSON('/api/nanobot/plugins');
}

export async function downloadSkill(name: string): Promise<void> {
  const url = `${API_URL}/api/nanobot/skills/${encodeURIComponent(name)}/download`;
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download failed: ${text}`);
  }

  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function deleteSkill(name: string): Promise<void> {
  await fetchJSON(`/api/nanobot/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function uploadSkill(file: File): Promise<Skill> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}/api/nanobot/skills/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      const retryHeaders: Record<string, string> = {};
      const newToken = getAccessToken();
      if (newToken) retryHeaders['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${API_URL}/api/nanobot/skills/upload`, {
        method: 'POST',
        headers: retryHeaders,
        body: formData,
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`API error ${retry.status}: ${text}`);
      }
      return retry.json();
    }
    clearTokens();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Files (proxied)
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function uploadFile(
  file: File,
  sessionId: string = 'web:default',
  onProgress?: (percent: number) => void
): Promise<FileAttachment> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 50MB)');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);

  const token = getAccessToken();

  const result = await new Promise<FileAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/nanobot/files/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve(data);
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });

  return result;
}

export async function listFiles(sessionId?: string): Promise<FileAttachment[]> {
  const params = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  return fetchJSON(`/api/nanobot/files${params}`);
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetchJSON(`/api/nanobot/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

export function getFileUrl(fileId: string): string {
  return `${API_URL}/api/nanobot/files/${encodeURIComponent(fileId)}`;
}

// ---------------------------------------------------------------------------
// Workspace Browser
// ---------------------------------------------------------------------------

export interface WorkspaceItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  content_type?: string;
  modified: string;
}

export interface BrowseResult {
  path: string;
  items: WorkspaceItem[];
}

export async function browseWorkspace(path: string = ''): Promise<BrowseResult> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetchJSON(`/api/nanobot/workspace/browse${params}`);
}

export function getWorkspaceDownloadUrl(path: string): string {
  return `${API_URL}/api/nanobot/workspace/download?path=${encodeURIComponent(path)}`;
}

export async function uploadToWorkspace(
  file: File,
  dirPath: string = '',
  onProgress?: (percent: number) => void
): Promise<WorkspaceItem> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 50MB)');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', dirPath);

  const token = getAccessToken();

  return new Promise<WorkspaceItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/nanobot/workspace/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });
}

export async function deleteWorkspacePath(path: string): Promise<void> {
  await fetchJSON(`/api/nanobot/workspace/delete?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}

export async function createWorkspaceDir(path: string): Promise<WorkspaceItem> {
  return fetchJSON(`/api/nanobot/workspace/mkdir?path=${encodeURIComponent(path)}`, {
    method: 'POST',
  });
}
