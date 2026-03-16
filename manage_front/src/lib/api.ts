import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "./auth";
import type {
  TokenResponse,
  PaginatedUsers,
  UsageSummary,
  UsageHistory,
  PaginatedAuditLogs,
} from "@/types";

// In development, call Gateway directly. In production (Docker), use relative URL to hit Next.js proxy.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Try refresh on 401
  if (res.status === 401 && token) {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshRes.ok) {
        const data: TokenResponse = await refreshRes.json();
        setTokens(data);
        headers["Authorization"] = `Bearer ${data.access_token}`;
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } else {
        clearTokens();
        window.location.href = "/login";
        throw new Error("Session expired");
      }
    } else {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Auth
export async function login(username: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// Users
export async function getUsers(page = 1, pageSize = 20, search = ""): Promise<PaginatedUsers> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search) params.set("search", search);
  return request<PaginatedUsers>(`/api/admin/users?${params}`);
}

export async function updateUser(userId: string, data: { role?: string; quota_tier?: string; is_active?: boolean }) {
  return request(`/api/admin/users/${userId}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function resetPassword(userId: string, newPassword: string) {
  return request(`/api/admin/users/${userId}/password`, {
    method: "PUT",
    body: JSON.stringify({ new_password: newPassword }),
  });
}

// Containers
export async function pauseContainer(userId: string) {
  return request(`/api/admin/users/${userId}/container/pause`, { method: "POST" });
}

export async function destroyContainer(userId: string) {
  return request(`/api/admin/users/${userId}/container`, { method: "DELETE" });
}

// Usage
export async function getUsageSummary(): Promise<UsageSummary> {
  return request<UsageSummary>("/api/admin/usage/summary");
}

export async function getUsageHistory(days = 30, userId?: string): Promise<UsageHistory> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set("user_id", userId);
  return request<UsageHistory>(`/api/admin/usage/history?${params}`);
}

// Audit
export async function getAuditLogs(
  page = 1,
  pageSize = 20,
  userId?: string,
  action?: string,
): Promise<PaginatedAuditLogs> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (userId) params.set("user_id", userId);
  if (action) params.set("action", action);
  return request<PaginatedAuditLogs>(`/api/admin/audit?${params}`);
}
