export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user_id: string;
  username: string;
  role: string;
}

export interface UserSummary {
  id: string;
  username: string;
  email: string;
  role: string;
  quota_tier: string;
  is_active: boolean;
  created_at: string;
  container_status: string | null;
  container_docker_id: string | null;
  container_created_at: string | null;
  tokens_used_today: number;
}

export interface PaginatedUsers {
  items: UserSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface UsageSummary {
  total_tokens_today: number;
  total_users: number;
  active_containers: number;
}

export interface DailyUsage {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ModelUsage {
  model: string;
  total_tokens: number;
}

export interface UsageHistory {
  daily: DailyUsage[];
  by_model: ModelUsage[];
}

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource: string | null;
  detail: string | null;
  created_at: string;
}

export interface PaginatedAuditLogs {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}
