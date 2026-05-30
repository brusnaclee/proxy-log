const API_BASE = "/admin";

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Cannot connect to proxy API. Ensure proxy server is running on port 3000.");
  }

  if (res.status === 401) {
    // If we get 401 on a non-login route, redirect to login
    if (!path.includes("/login") && !path.includes("/me")) {
      window.location.href = "/login";
    }
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return (data ?? {}) as T;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login: (password: string) =>
    request<{ success: boolean }>("/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request<{ success: boolean }>("/logout", { method: "POST" }),
  me: () =>
    request<{ authenticated: boolean }>("/me"),
};

// ─── Settings ──────────────────────────────────────────────────────────────────
export { request };

export const settings = {
  get: () =>
    request<{ upstreamEndpoint: string; upstreamApiKey: string; hasUpstreamKey: boolean }>("/settings"),
  update: (data: { upstreamEndpoint?: string; upstreamApiKey?: string }) =>
    request<{ success: boolean }>("/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>("/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// ─── API Keys ──────────────────────────────────────────────────────────────────
export interface ApiKeyListItem {
  id: number;
  name: string;
  keyPrefix: string;
  keyMasked: string;
  idePolicy: string;
  isActive: boolean;
  maxDevices: number;
  devicePolicy: string;
  ipPolicy: string;
  monthlyTokenLimit: number;
  deviceCount: number;
  requestsToday: number;
  tokensToday: number;
  estimatedCostToday?: number;
  totalRequests: number;
  totalTokens: number;
  estimatedCost?: number;
  createdAt: string;
}

export interface KeyPeriodStats {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  contextTokens: number;
  estimatedCost: number;
  promptCost: number;
  completionCost: number;
}

export interface ApiKeyDetail extends ApiKeyListItem {
  rateLimit: number;
  rateLimitWindow: string;
  promptLimit: number;
  promptLimitWindow: string;
  perModelPromptLimit: number;
  perModelPromptLimitWindow: string;
  updatedAt: string;
  stats: {
    today:   KeyPeriodStats;
    week:    KeyPeriodStats;
    month:   KeyPeriodStats;
    allTime: KeyPeriodStats;
    deviceCount: number;
    topModels: { model: string; count: number; tokens: number; estimatedCost?: number }[];
  };
  policyStats: {
    deviceAllowCount: number;
    deviceBlockCount: number;
    ipAllowCount: number;
    ipBlockCount: number;
    ideAllowCount: number;
    ideBlockCount: number;
  };
  policyEntries: {
    devices: {
      id: number;
      apiKeyId: number;
      fingerprint: string | null;
      ipAddress: string | null;
      label: string | null;
      listType: string;
      createdAt: string;
    }[];
    ides: {
      id: number;
      apiKeyId: number;
      ideName: string;
      listType: string;
      createdAt: string;
    }[];
  };
  analytics: {
    topModelsByTokens: {
      model: string;
      requests: number;
      tokens: number;
      estimatedCost?: number;
    }[];
    topDevices: {
      deviceFingerprint: string;
      ipAddress: string;
      ideDetected: string;
      osDetected: string;
      clientName: string;
      requests: number;
      sessions: number;
      tokens: number;
      estimatedCost?: number;
      lastSeen: string;
    }[];
    deviceSessions: {
      sessionId: string;
      sessionName?: string | null;
      deviceFingerprint: string;
      ipAddress: string;
      ideDetected: string;
      provider: string;
      model: string;
      requestCount: number;
      totalTokens: number;
      estimatedCost?: number;
      lastContextTokens: number;
      contextFingerprint: string;
      firstSeenAt: string;
      lastSeenAt: string;
    }[];
  };
}

export interface CreateKeyResponse {
  id: number;
  name: string;
  key: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
}

export const keys = {
  list: () => request<ApiKeyListItem[]>("/keys"),
  get: (id: number) => request<ApiKeyDetail>(`/keys/${id}`),
  create: (name: string) =>
    request<CreateKeyResponse>("/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  update: (id: number, data: Partial<{
    name: string; isActive: boolean; maxDevices: number;
    devicePolicy: string; ipPolicy: string; idePolicy: string; monthlyTokenLimit: number;
    rateLimit: number; rateLimitWindow: string;
    promptLimit: number; promptLimitWindow: string;
    perModelPromptLimit: number; perModelPromptLimitWindow: string;
  }>) =>
    request<{ success: boolean }>(`/keys/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    request<{ success: boolean }>(`/keys/${id}`, { method: "DELETE" }),
  rotate: (id: number) =>
    request<{ success: boolean; key: string; keyPrefix: string }>(`/keys/${id}/rotate`, { method: "POST" }),
  reveal: (id: number) =>
    request<{ key: string; name: string }>(`/keys/${id}/reveal`),
  getDevices: (id: number) =>
    request<any[]>(`/keys/${id}/devices`),
  blockDevice: (keyId: number, fingerprint: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/devices/${fingerprint}/block`, { method: "POST" }),
  allowDevice: (keyId: number, fingerprint: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/devices/${fingerprint}/allow`, { method: "POST" }),
  removeDevice: (keyId: number, fingerprint: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/devices/${fingerprint}`, { method: "DELETE" }),
  addDevicePolicyRule: (
    keyId: number,
    data: { targetType: "fingerprint" | "ip"; value: string; listType: "allow" | "block"; label?: string }
  ) =>
    request<{ success: boolean; id?: number; message?: string }>(`/keys/${keyId}/policies/device`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeDevicePolicyRule: (keyId: number, ruleId: number) =>
    request<{ success: boolean; message?: string }>(`/keys/${keyId}/policies/device/${ruleId}`, { method: "DELETE" }),
  addIdePolicyRule: (keyId: number, data: { ideName: string; listType: "allow" | "block" }) =>
    request<{ success: boolean; id?: number; message?: string }>(`/keys/${keyId}/policies/ide`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeIdePolicyRule: (keyId: number, ruleId: number) =>
    request<{ success: boolean; message?: string }>(`/keys/${keyId}/policies/ide/${ruleId}`, { method: "DELETE" }),
  getModelLimits: (keyId: number) =>
    request<{ data: ModelLimitEntry[] }>(`/keys/${keyId}/model-limits`),
  setModelLimit: (keyId: number, model: string, promptLimit: number) =>
    request<{ success: boolean }>(`/keys/${keyId}/model-limits`, { method: "PUT", body: JSON.stringify({ model, promptLimit }) }),
  deleteModelLimit: (keyId: number, model: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/model-limits/${encodeURIComponent(model)}`, { method: "DELETE" }),
};

// ─── Logs ──────────────────────────────────────────────────────────────────────
export interface LogEntry {
  id: number;
  apiKeyId: number;
  apiKeyName: string;
  userAgentRaw?: string | null;
  osDetected?: string | null;
  clientName?: string | null;
  ipAddress: string;
  deviceFingerprint: string;
  ideDetected: string;
  provider?: string | null;
  endpointPath?: string | null;
  sessionId?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  contextFingerprint?: string | null;
  contextTokensBefore?: number;
  contextDeltaTokens?: number;
  contextEvent?: string | null;
  toolsUsed?: string[] | null;
  toolCount?: number;
  hasToolCalls?: boolean;
  requestPreview?: string | null;
  responsePreview?: string | null;
  transcript?: { role: string; content: string }[];
  estimatedContextLength: number;
  latencyMs: number;
  statusCode: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface LogsResponse {
  data: LogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ChatSessionSummary {
  id: number;
  sessionId: string;
  apiKeyId: number;
  apiKeyName: string;
  ipAddress: string;
  deviceFingerprint: string;
  ideDetected: string;
  provider: string;
  model: string;
  sessionName?: string | null;
  contextFingerprint: string;
  lastContextTokens: number;
  requestCount: number;
  promptCount?: number;
  totalTokens: number;
  estimatedCost?: number;
  compactCount: number;
  switchCount: number;
  lastRequestPreview: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SessionsResponse {
  data: ChatSessionSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SessionDetailResponse {
  session: ChatSessionSummary;
  timeline: LogEntry[];
}

export const logs = {
  list: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params).toString();
    return request<LogsResponse>(`/logs?${query}`);
  },
  sessions: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params).toString();
    return request<SessionsResponse>(`/logs/sessions?${query}`);
  },
  sessionDetail: (sessionId: string) =>
    request<SessionDetailResponse>(`/logs/sessions/${encodeURIComponent(sessionId)}`),
  clear: (days: number = 90) =>
    request<{ success: boolean; deletedCount: number }>(`/logs?days=${days}`, { method: "DELETE" }),
  clearAll: () =>
    request<{ success: boolean }>("/logs/clear-all", { method: "POST" }),
  nukeAll: () =>
    request<{ success: boolean; message: string }>("/logs/nuke-all", { method: "POST" }),
};

// ─── Monitor ───────────────────────────────────────────────────────────────────
export interface ModelMonitorEntry {
  id: number;
  modelId: string;
  provider: string | null;
  modelVendor?: string | null;
  isOnline: boolean;
  latencyMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  baseUrl: string | null;
  checkedAt: string;
}

export interface ModelMonitorResponse {
  data: ModelMonitorEntry[];
  summary: { total: number; online: number; offline: number; timeout: number };
}

export const monitor = {
  getModels: () => request<ModelMonitorResponse>("/monitor/models"),
  getModelHistory: (modelId: string) => request<ModelMonitorEntry[]>(`/monitor/models/${encodeURIComponent(modelId)}/history`),
};

// ─── Global Settings ──────────────────────────────────────────────────────────
export interface GlobalSettings {
  globalMaxDevices: number;
  realtimeEnabled: boolean;
  globalRateLimit: number;
  globalRateLimitWindow: string;
  globalPromptLimit: number;
  globalPromptLimitWindow: string;
  globalPerModelPromptLimit: number;
  globalPerModelPromptLimitWindow: string;
  globalDailyTokenLimit: number;
  globalMonthlyTokenLimit: number;
  globalDailyInputTokenLimit: number;
  globalDailyOutputTokenLimit: number;
}

export interface ModelLimitEntry {
  id: number;
  scope: string;
  scopeId: number;
  model: string;
  promptLimit: number;
  createdAt: string;
}

export const globalSettings = {
  get: () => request<GlobalSettings>("/settings/global"),
  update: (data: Partial<GlobalSettings>) =>
    request<{ success: boolean }>("/settings/global", { method: "PUT", body: JSON.stringify(data) }),
  getModels: () =>
    request<{ data: string[] }>("/settings/models"),
  getModelLimits: () =>
    request<{ data: ModelLimitEntry[] }>("/settings/model-limits"),
  setModelLimit: (model: string, promptLimit: number) =>
    request<{ success: boolean }>("/settings/model-limits", { method: "PUT", body: JSON.stringify({ model, promptLimit }) }),
  deleteModelLimit: (model: string) =>
    request<{ success: boolean }>(`/settings/model-limits/${encodeURIComponent(model)}`, { method: "DELETE" }),
};

// ─── Stats ─────────────────────────────────────────────────────────────────────
export interface OverviewPeriodStats {
  requests: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  contextTokens?: number;
  promptCost?: number;
  completionCost?: number;
  totalCost?: number;
  estimatedCost?: number;
  uniqueDevices?: number;
}

export interface OverviewStats {
  today: OverviewPeriodStats;
  week: OverviewPeriodStats;
  month: OverviewPeriodStats;
  allTime: OverviewPeriodStats & { totalSessions?: number; avgRequestsPerSession?: number };
  activeKeys: number;
  totalKeys: number;
  totalDevices: number;
}

export const stats = {
  overview: () => request<OverviewStats>("/stats/overview"),
  byKey: (days = 0) => request<any[]>(`/stats/by-key?days=${days}`),
  byModel: (days = 0, apiKeyId?: number) =>
    request<any[]>(`/stats/by-model?days=${days}${apiKeyId ? `&api_key_id=${apiKeyId}` : ""}`),
  byDevice: (days = 0) => request<any[]>(`/stats/by-device?days=${days}`),
  topUsers: (days = 0) => request<{ byRequests: any[]; byTokens: any[] }>(`/stats/top-users?days=${days}`),
  timeseries: (period: string = "daily", days: number = 7) =>
    request<any[]>(`/stats/timeseries?period=${period}&days=${days}`),
  userDetail: (discordUserId: string) =>
    request<any>(`/internal/stats/user-detail/${encodeURIComponent(discordUserId)}`),
};
