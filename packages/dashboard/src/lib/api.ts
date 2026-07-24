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
export interface LiveUsagePayload {
  scope: "account" | "key";
  accountKeyCount: number;
  usageToday: {
    /** Distinct turns (not log hops). */
    requests: number;
    /** Every upstream API call (matches Logs rows). */
    hopCount?: number;
    promptTokens: number;
    billablePromptTokens?: number;
    cachedTokens?: number;
    /** SUM(prompt+cache) every hop — amanai / provider In. */
    fullInputTokens?: number;
    completionTokens: number;
    totalTokens: number;
    /** Distinct turns in prompt window. */
    promptCount: number;
    /** Hops in API-call window. */
    apiCallCount?: number;
  };
  usageMonth: {
    totalTokens: number;
  };
  limits: {
    dailyTokenLimit: number;
    dailyTokenLimitSource: "override" | "global" | "none";
    dailyInputTokenLimit: number;
    dailyInputTokenLimitSource: "override" | "global" | "none";
    dailyOutputTokenLimit: number;
    dailyOutputTokenLimitSource: "override" | "global" | "none";
    monthlyTokenLimit: number;
    monthlyTokenLimitSource: "override" | "global" | "none";
    promptLimit: number;
    promptLimitWindow: string;
    promptLimitSource: "override" | "global" | "none";
    apiCallLimit?: number;
    apiCallLimitWindow?: string;
    apiCallLimitSource?: "override" | "global" | "none";
    perModelPromptLimit: number;
    perModelPromptLimitWindow: string;
    perModelPromptLimitSource: "override" | "global" | "none";
  };
  remaining: {
    input: number | null;
    output: number | null;
    daily: number | null;
    monthly: number | null;
    prompt: number | null;
    apiCalls?: number | null;
  };
  dailyResetAt: string;
  monthlyResetAt: string;
  promptResetAt: string | null;
  promptResetMins?: number;
  apiCallResetAt?: string | null;
  apiCallResetMins?: number;
  promptResetMins: number;
  modelUsageLimits: Array<{
    model: string;
    used: number;
    limit: number;
    window: string;
    remaining: number | null;
    resetAt: string | null;
    source: "override" | "global" | "none";
  }>;
}

export interface ApiKeyListItem {
  id: number;
  name: string;
  keyPrefix: string;
  keyMasked: string;
  idePolicy: string;
  isActive: boolean;
  isTrial?: boolean;
  maxDevices: number;
  devicePolicy: string;
  ipPolicy: string;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyInputTokenLimit: number;
  dailyOutputTokenLimit: number;
  deviceCount: number;
  requestsToday: number;
  tokensToday: number;
  estimatedCostToday?: number;
  totalRequests: number;
  totalTokens: number;
  estimatedCost?: number;
  createdAt: string;
  discordUserId?: string | null;
  discordUsername?: string | null;
  provisionedBy?: string | null;
  isPrimary?: boolean;
  canDelete?: boolean;
  liveUsage?: LiveUsagePayload | null;
}

export interface KeyPeriodStats {
  requests: number;
  hopCount?: number;
  tokens: number;
  promptTokens: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
  fullInputTokens?: number;
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
  liveUsage?: LiveUsagePayload | null;
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
  adminOverrideDiscord: (discordUserId: string, discordUsername?: string, note?: string) =>
    request<{
      success: boolean;
      alreadyExists: boolean;
      apiKey: string;
      keyId: number;
      keyName: string;
      endpoint: string;
      discordUserId: string;
      discordUsername: string;
      message?: string;
    }>("/keys/override-discord", {
      method: "POST",
      body: JSON.stringify({ discordUserId, discordUsername, note }),
    }),
  update: (id: number, data: Partial<{
    name: string; isActive: boolean; maxDevices: number;
    devicePolicy: string; ipPolicy: string; idePolicy: string;
    dailyTokenLimit: number; monthlyTokenLimit: number;
    dailyInputTokenLimit: number; dailyOutputTokenLimit: number;
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
  setModelLimit: (keyId: number, model: string, limits: { promptLimit?: number, dailyTokenLimit?: number, monthlyTokenLimit?: number, dailyInputTokenLimit?: number, dailyOutputTokenLimit?: number, isPattern?: boolean }) =>
    request<{ success: boolean }>(`/keys/${keyId}/model-limits`, { method: "PUT", body: JSON.stringify({ model, ...limits }) }),
  matchModelCatalog: (keyId: number, pattern: string) =>
    request<{ data: string[]; total: number; totalAll: number }>(`/keys/${keyId}/model-catalog/match?pattern=${encodeURIComponent(pattern)}`),
  deleteModelLimit: (keyId: number, model: string, isPattern?: boolean) =>
    request<{ success: boolean }>(
      `/keys/${keyId}/model-limits/${encodeURIComponent(model)}${
        typeof isPattern === "boolean" ? `?isPattern=${isPattern}` : ""
      }`,
      { method: "DELETE" },
    ),
};

// ─── Logs ──────────────────────────────────────────────────────────────────────
export interface LogEntry {
  id: number;
  apiKeyId: number;
  apiKeyName: string;
  isTrial?: boolean;
  discordUserId?: string | null;
  discordUsername?: string | null;
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
  /** Full input (billable + cache) when token_input_mode=full */
  promptTokens: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
  inputTokens?: number;
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
  probeOk?: boolean;
  forceDeactivated?: boolean;
}

export interface ModelMonitorResponse {
  data: ModelMonitorEntry[];
  summary: {
    total: number;
    online: number;
    offline: number;
    timeout: number;
    probeOk?: number;
    monitorAutoMode?: string;
  };
  monitorAutoMode?: string;
  /** All active upstream names (even if no monitor rows yet). */
  activeProviders?: string[];
}

export const monitor = {
  getModels: () => request<ModelMonitorResponse>("/monitor/models"),
  getModelHistory: (modelId: string) => request<ModelMonitorEntry[]>(`/monitor/models/${encodeURIComponent(modelId)}/history`),
  getModelDetails: () => request<{ object: string; data: any[] }>("/monitor/models/details"),
  triggerSweep: () => request<{ started: boolean; message: string }>("/monitor/sweep", { method: "POST" }),
  syncCatalog: () =>
    request<{
      success: boolean;
      providers: number;
      listed: number;
      seeded: number;
      skipped?: string[];
      purged?: string[];
    }>("/monitor/sync-catalog", {
      method: "POST",
    }),
  getSweepProgress: () => request<{ total: number; tested: number; online: number; offline: number; rateLimited: number; startedAt: string; status: string }>("/monitor/sweep/progress"),
  activate: (modelId: string, provider: string) =>
    request<{ success: boolean; message?: string }>("/monitor/models/activate", {
      method: "POST",
      body: JSON.stringify({ modelId, provider }),
    }),
  deactivate: (modelId: string, provider: string) =>
    request<{ success: boolean; message?: string }>("/monitor/models/deactivate", {
      method: "POST",
      body: JSON.stringify({ modelId, provider }),
    }),
  bulkOverride: (params: {
    action: "on" | "off";
    provider?: string;
    vendor?: string;
    probe?: "ok" | "fail" | "all";
  }) =>
    request<{ success: boolean; updated: number; message?: string }>("/monitor/models/bulk-override", {
      method: "POST",
      body: JSON.stringify(params),
    }),
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
  /** per_turn_peak | full | billable */
  tokenInputMode?: "per_turn_peak" | "full" | "billable";
  /** 1–100: percent of each hop In+Out charged to daily/monthly token limits */
  tokenLimitWeightPercent?: number;
  /** Substring patterns that hard-require an add-on. Empty = Phantom open access. */
  addonRequiredModels?: string[];
  tokenSaverRtkEnabled?: boolean;
  tokenSaverRtkMaxChars?: number;
  tokenSaverHeadroomEnabled?: boolean;
  tokenSaverHeadroomUrl?: string;
  tokenSaverCavemanEnabled?: boolean;
  tokenSaverCavemanLevel?: number;
  tokenSaverPonytailEnabled?: boolean;
  tokenSaverPonytailLevel?: string;
}

export interface ModelLimitEntry {
  id: number;
  scope: string;
  scopeId: number;
  model: string;
  promptLimit: number;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyInputTokenLimit: number;
  dailyOutputTokenLimit: number;
  isPattern?: boolean;
  matchCount?: number;
  matchedIds?: string[];
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
  setModelLimit: (model: string, limits: { promptLimit?: number, dailyTokenLimit?: number, monthlyTokenLimit?: number, dailyInputTokenLimit?: number, dailyOutputTokenLimit?: number, isPattern?: boolean }) =>
    request<{ success: boolean }>("/settings/model-limits", { method: "PUT", body: JSON.stringify({ model, ...limits }) }),
  matchModelCatalog: (pattern: string) =>
    request<{ data: string[]; total: number; totalAll: number }>(`/settings/model-catalog/match?pattern=${encodeURIComponent(pattern)}`),
  deleteModelLimit: (model: string, isPattern?: boolean) =>
    request<{ success: boolean }>(
      `/settings/model-limits/${encodeURIComponent(model)}${
        typeof isPattern === "boolean" ? `?isPattern=${isPattern}` : ""
      }`,
      { method: "DELETE" },
    ),
};

// ─── Stats ─────────────────────────────────────────────────────────────────────
export interface OverviewPeriodStats {
  requests: number;
  tokens: number;
  promptTokens?: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
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

// ─── Bug Log ──────────────────────────────────────────────────────────────
export interface BugLogEntry {
  id: number;
  statusCode: number;
  errorMessage: string;
  model: string;
  endpointPath: string;
  count: number;
  sampleId: number;
  firstSeen: string;
  lastSeen: string;
  affectedUsers: number;
  ideDetections: string[];
  providers: string[];
  signature: string;
}

export const buglog = {
  list: (params: { days?: number; status?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.days) query.set("days", String(params.days));
    if (params.status !== undefined) query.set("status", String(params.status));
    return request<{ data: BugLogEntry[]; total: number; days: number; limit: number }>(
      `/buglog?${query.toString()}`
    );
  },
  deleteSignature: (sig: { statusCode: number; errorMessage: string; model: string; endpointPath: string }) =>
    request<{ success: boolean; deletedCount: number }>("/buglog/signature", {
      method: "DELETE",
      body: JSON.stringify(sig),
    }),
  clearOld: (days: number = 30) =>
    request<{ success: boolean; deletedCount: number }>(`/buglog/clear?days=${days}`, { method: "DELETE" }),
  clearAll: () =>
    request<{ success: boolean; deletedCount: number }>("/buglog/all", { method: "DELETE" }),
};

// ─── Quota Guard ────────────────────────────────────────────────────────────

export interface QuotaGuardSnapshot {
  scheduler: {
    enabled: boolean;
    pollIntervalMs: number;
    threshold: number;
    isRunning: boolean;
    lastCycleAt: string | null;
    excludedProviders: string[];
  };
  providers: ProviderSnapshot[];
}

export interface ProviderSnapshot {
  name: string;
  alias: string;
  connections: ConnectionSnapshot[];
}

export interface ConnectionSnapshot {
  id: string;
  name: string;
  isActive: boolean;
  quotaType: string;
  quotas: Record<string, {
    used: number;
    total: number;
    remainingPercentage: number;
    resetAt?: string;
    unlimited?: boolean;
    displayName?: string;
  }>;
  guardState: {
    phase: string;
    retryCount: number;
    lockoutCount: number;
    disabledByGuard: boolean;
    excluded: boolean;
    lastResetAt?: string;
  };
}

export const quotaGuard = {
  getStatus: () => request<QuotaGuardSnapshot>("/quota-guard/status"),
  disable: (data: { providerAlias: string; type: string; id: string }) =>
    request<{ success: boolean }>("/quota-guard/disable", { method: "POST", body: JSON.stringify(data) }),
  enable: (data: { providerAlias: string; type: string; id: string }) =>
    request<{ success: boolean }>("/quota-guard/enable", { method: "POST", body: JSON.stringify(data) }),
  updateScheduler: (data: { enabled?: boolean }) =>
    request<{ success: boolean }>("/quota-guard/scheduler", { method: "PUT", body: JSON.stringify(data) }),
  setProviderExcluded: (provider: string, excluded: boolean) =>
    request<{ success: boolean; excludedProviders: string[] }>("/quota-guard/provider", { method: "PUT", body: JSON.stringify({ provider, excluded }) }),
};

// ─── Trial Mode ────────────────────────────────────────────────────────────────
export interface TrialEmbedConfig {
  title?: string;
  description?: string;
  color?: number;
  footer?: string;
  buttonLabel?: string;
}

export interface TrialDmTemplates {
  limitReached?: string;
  expired?: string;
  terminated?: string;
  keyRotated?: string;
  claimed?: string;
  reclaimAvailable?: string;
  upgradePhantom?: string;
  extended?: string;
}

export interface TrialSettings {
  trialEnabled: boolean;
  trialAccessMode: "all_members" | "groupy_members";
  trialRequiredRoleId: string;
  trialDefaultDurationDays: number;
  trialMaxPerAccount: number;
  trialDailyTokenLimit: number;
  trialPromptLimit: number;
  trialPromptLimitWindow: string;
  trialModelSelectionMode: "all_gpy" | "whitelist";
  trialModelWhitelist: string[];
  trialUpstreams: string[];
  trialPanelMessageId: string | null;
  trialEmbedConfig: TrialEmbedConfig;
  trialDmTemplates: TrialDmTemplates;
  gpyModels: string[];
  catalogModelsByUpstream: Record<string, string[]>;
}

export interface TrialUserRow {
  id: number;
  discordUserId: string;
  discordUsername: string | null;
  apiKeyId: number;
  keyPrefix: string;
  keyName: string;
  isActive: boolean;
  claimedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: string | null;
  suspended: boolean;
  status: string;
  overrideDays: number | null;
  overrideMaxTrials: number | null;
  overrideDailyTokenLimit: number | null;
  overridePromptLimit: number | null;
  overridePromptLimitWindow: string | null;
}

export const trialSettings = {
  get: () => request<TrialSettings>("/settings/trial"),
  update: (data: Partial<TrialSettings>) =>
    request<TrialSettings & { success: boolean }>("/settings/trial", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  listUsers: () => request<{ data: TrialUserRow[] }>("/trial/users"),
  getUser: (id: number) => request<TrialUserRow>(`/trial/users/${id}`),
  getUserByKey: (apiKeyId: number) => request<TrialUserRow>(`/trial/users/key/${apiKeyId}`),
  userAction: (data: {
    action: string;
    discordUserId: string;
    days?: number;
    reason?: string;
    overrideDailyTokenLimit?: number;
    overridePromptLimit?: number;
    overridePromptLimitWindow?: string;
    overrideMaxTrials?: number;
  }) =>
    request<{ success: boolean; message?: string; expiresAt?: string; apiKey?: string; endpoint?: string; durationDays?: number }>("/trial/users/action", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getHistory: (discordUserId: string) =>
    request<{
      discordUserId: string;
      count: number;
      history: Array<{
        id: number;
        apiKeyId: number;
        keyName: string;
        keyPrefix: string;
        isActive: boolean;
        claimedAt: string;
        expiresAt: string;
        endedAt: string | null;
        endReason: string | null;
        suspended: boolean;
        overrideMaxTrials: number | null;
        overrideDays: number | null;
      }>;
    }>(`/trial/history/${encodeURIComponent(discordUserId)}`),
};

// ─── Add-ons ───────────────────────────────────────────────────────────────────
export interface AddonEntry {
  id: number;
  name: string;
  description: string;
  modelAllowlist: string;
  modelAllowlistParsed?: string[];
  accessMode?: "allowlist" | "all_except";
  modelDenylist?: string;
  modelDenylistParsed?: string[];
  modelDailyLimits?: string;
  modelDailyLimitsParsed?: Record<string, number>;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyInputTokenLimit: number;
  dailyOutputTokenLimit: number;
  promptLimit: number;
  promptLimitWindow: string;
  maxDevices?: number;
  discordRoleId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddonAssignmentEntry {
  id: number;
  addonId: number;
  discordUserId: string | null;
  apiKeyId: number | null;
  startsAt: string;
  expiresAt: string | null;
  isActive: boolean;
  assignedBy: string;
  createdAt: string;
  addonName?: string;
  modelAllowlistParsed?: string[];
}

export type AddonWritePayload = Partial<AddonEntry> & {
  name?: string;
  modelAllowlist?: string | string[];
  modelDenylist?: string | string[];
  modelDailyLimits?: Record<string, number> | string;
  accessMode?: "allowlist" | "all_except";
  maxDevices?: number;
};

export const addonsApi = {
  list: () => request<{ data: AddonEntry[] }>("/addons"),
  create: (data: AddonWritePayload & { name: string }) =>
    request<{ success: boolean; addon: AddonEntry }>("/addons", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: AddonWritePayload) =>
    request<{ success: boolean; addon: AddonEntry }>(`/addons/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  remove: (id: number) =>
    request<{ success: boolean }>(`/addons/${id}`, { method: "DELETE" }),
  listAssignments: (discordUserId?: string) =>
    request<{ data: AddonAssignmentEntry[] }>(
      `/addon-assignments${discordUserId ? `?discordUserId=${encodeURIComponent(discordUserId)}` : ""}`,
    ),
  assign: (data: {
    addonId: number;
    discordUserId?: string;
    apiKeyId?: number;
    expiresAt?: string | null;
  }) =>
    request<{ success: boolean; assignment: AddonAssignmentEntry }>("/addon-assignments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAssignment: (id: number, data: { isActive?: boolean; expiresAt?: string | null }) =>
    request<{ success: boolean }>(`/addon-assignments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  removeAssignment: (id: number) =>
    request<{ success: boolean }>(`/addon-assignments/${id}`, { method: "DELETE" }),
};
