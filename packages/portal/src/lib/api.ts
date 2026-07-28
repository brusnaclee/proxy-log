// API client for portal - uses relative paths (same origin in production)

const BASE = "/portal/api";

async function request<T>(
  path: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const raw = err?.error;
    const message =
      typeof raw === "string"
        ? raw
        : typeof raw?.message === "string"
          ? raw.message
          : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type LimitSource = "override" | "global" | "none" | "addon";

export interface MeResponse {
  discordUserId: string;
  discordUsername: string | null;
  accountType: "trial" | "phantom" | "pro" | "premium" | "staff" | string;
  accountBadges?: string[];
  trialExpiresAt: string | null;
  hasPassword: boolean;
  preferredLang?: "en" | "id";
  webhookUrl: string | null;
  hasWebhook: boolean;
  keyCount: number;
  primaryKeyName: string | null;
  lastLoginAt?: string | null;
  keys: Array<{
    id: number;
    name: string;
    keyPrefix: string;
    isActive: boolean;
    isTrial: boolean;
    createdAt: string;
  }>;
  limits: {
    dailyTokenLimit: number;
    dailyTokenLimitSource?: LimitSource;
    monthlyTokenLimit: number;
    monthlyTokenLimitSource?: LimitSource;
    dailyInputTokenLimit: number;
    dailyInputTokenLimitSource?: LimitSource;
    dailyOutputTokenLimit: number;
    dailyOutputTokenLimitSource?: LimitSource;
    rateLimit: number;
    rateLimitWindow: string;
    rateLimitSource?: LimitSource;
    promptLimit: number;
    promptLimitWindow: string;
    promptLimitSource?: LimitSource;
    perModelPromptLimit?: number;
    perModelPromptLimitWindow?: string;
    maxDevices?: number;
  };
  usageToday: {
    requests: number;
    promptTokens: number;
    billablePromptTokens?: number;
    cachedTokens?: number;
    completionTokens: number;
    promptCount?: number;
    apiCallCount?: number;
    totalTokens?: number;
  };
  usageMonth?: {
    totalTokens: number;
  };
  promptResetAt?: string | null;
  promptResetMins?: number;
  apiCallResetAt?: string | null;
  apiCallResetMins?: number;
  dailyResetAt?: string | null;
  monthlyResetAt?: string | null;
  inputBreakdown?: {
    promptCount: number;
    apiCallCount: number;
    followUpCount: number;
    avgInPerPrompt: number;
    avgInPerFollowUp: number;
    creditPrompts: number;
    creditFollowUps: number;
    inputTowardLimit: number;
    weightPercent: number;
    peakBillable: number;
    peakCached: number;
    peakFullIn: number;
  };
  modelUsageLimits?: Array<{
    model: string;
    used: number;
    limit: number;
    window: string;
    resetAt: string | null;
  }>;
  dailyTokenBreakdown?: {
    base: number;
    addonBonus: number;
    effective: number;
    bypassIo?: boolean;
    inputBase?: number;
    outputBase?: number;
  };
  activeAddons?: Array<{
    name: string;
    expiresAt: string | null;
    dailyTokenLimit: number;
  }>;
  addonHistory?: Array<{
    id: number;
    addonId: number;
    addonName: string;
    startsAt: string;
    expiresAt?: string | null;
    endedAt?: string | null;
    isActive: boolean;
    status: "active" | "expired" | "revoked";
    assignedBy: string;
    dailyTokenLimit: number;
  }>;
  addonModelTokenCaps?: Array<{ pattern: string; dailyLimit: number }>;
  perModelPromptsBypassedByAddon?: boolean;
  blockedWithoutAddon?: boolean;
  roleLimitMode?: string | null;
  dedicatedPools?: Array<{
    model: string;
    isPattern: boolean;
    scope: string;
    limit: number;
    used: number;
    remaining: number;
    resetAt: string;
    inputLimit?: number;
    outputLimit?: number;
    inputUsed?: number;
    outputUsed?: number;
  }>;
  multipliers?: {
    input: number;
    output: number;
  };
  deviceUsage?: {
    used: number;
    max: number;
  };
  pendingNotifications: any[];
  tokenSaver?: {
    global: {
      rtk: boolean;
      rtkMaxChars: number;
      headroom: boolean;
      caveman: boolean;
      cavemanLevel: number;
      ponytail: boolean;
      ponytailLevel: string;
      groupyCompact: boolean;
      groupyCompactLevel: string;
      batch: boolean;
    };
    overrides: {
      rtk: boolean | null;
      headroom: boolean | null;
      caveman: boolean | null;
      ponytail: boolean | null;
      groupyCompact: boolean | null;
      batch: boolean | null;
    };
  };
}

export interface OverviewStats {
  requests: number;
  tokens: number;
  promptTokens: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
  completionTokens: number;
  sessions: number;
  toolCalls: number;
  cost: { prompt: number; completion: number; total: number };
}

export interface TimeseriesItem {
  period: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ModelUsage {
  model: string;
  requests: number;
  promptTokens: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
  completionTokens: number;
  tokens: number;
}

export interface IdeUsage {
  ide: string;
  requests: number;
  devices: number;
}

export interface TopError {
  statusCode: number;
  errorSnippet: string;
  count: number;
  model?: string | null;
  ideDetected?: string | null;
  endpointPath?: string | null;
  requestPreview?: string;
  responsePreview?: string;
  errorMessage?: string;
  sampleAt?: string | null;
}

export interface CompareStats {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: { prompt: number; completion: number; total: number };
}

export interface ForecastItem {
  status: "ok" | "exceeded" | "no_usage";
  tokensUsed?: number;
  limit?: number;
  ratePerHour?: number;
  ratePerDay?: number;
  etaUtc?: string;
  hoursRemaining?: number;
  daysRemaining?: number;
}

export interface ForecastResponse {
  forecast: { daily: ForecastItem | null; monthly: ForecastItem | null } | null;
}

export interface KeyInfo {
  id: number;
  name: string;
  key?: string;
  keyPrefix: string;
  keyMasked: string;
  isActive: boolean;
  isTrial: boolean;
  isPrimary?: boolean;
  canDelete?: boolean;
  provisionedBy?: string | null;
  createdAt: string;
  requestsToday: number;
  apiCallsToday?: number;
  tokensToday?: number;
  inputToday?: number;
  outputToday?: number;
}

export interface DeviceInfo {
  fingerprint: string;
  fingerprintShort: string;
  deviceName: string;
  ideDetected: string;
  osDetected: string;
  ipAddress: string | null;
  userAgentRaw: string | null;
  requestCount: number;
  lastSeen: string;
  firstSeen: string | null;
  isBlocked: boolean;
}

export interface LogItem {
  id?: number;
  model: string;
  promptTokens: number;
  billablePromptTokens?: number;
  cachedTokens?: number;
  inputTokens?: number;
  completionTokens: number;
  totalTokens: number;
  ideDetected: string;
  provider: string;
  endpointPath?: string | null;
  errorMessage?: string | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
  latencyMs: number;
  statusCode: number;
  createdAt: string;
}

export interface ModelEntry {
  id: string;
  allowed: boolean;
  online: boolean | null;
  checkedAt?: string | null;
  lastCheckedMinutes?: number | null;
  latencyMs?: number | null;
}

export interface RecapStatus {
  isOpen: boolean;
  panelVisible?: boolean;
  yearMonth?: string;
  monthLabel?: string;
  openDay?: number;
  openMonthLabel?: string;
  closeMonthLabel?: string;
  message?: string;
  todayDay?: number;
  phase?: "hidden" | "countdown" | "open";
  daysUntilOpen?: number | null;
  daysUntilClose?: number | null;
  openDate?: string | null;
  closeHint?: string | null;
  recapUrl: string | null;
}

export interface RecapOpenResponse {
  success: boolean;
  recapUrl: string;
  yearMonth?: string;
  monthLabel?: string;
  degraded?: boolean;
  error?: string;
}

export interface NotificationsResponse {
  notifications: Array<{
    type: string;
    keyName?: string;
    keyId?: number;
    rotatedAt?: string;
    [key: string]: any;
  }>;
  count: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function clientHintPayload() {
  try {
    const ua = (navigator as any).userAgentData as
      | { platform?: string; mobile?: boolean }
      | undefined;
    return {
      platform: ua?.platform || navigator.platform || undefined,
      mobile: ua?.mobile,
      label: ua?.platform || undefined,
    };
  } catch {
    return { platform: navigator.platform || undefined };
  }
}

export const auth = {
  login: (apiKey: string) =>
    request<{ requiresPassword: boolean; discordUserId?: string; success?: boolean; autoLogin?: boolean }>(
      "/auth/login", "POST", { apiKey, clientHint: clientHintPayload() }
    ),
  verifyPassword: (discordUserId: string, password: string) =>
    request<{ success: boolean }>("/auth/verify-password", "POST", {
      discordUserId,
      password,
      clientHint: clientHintPayload(),
    }),
  logout: () => request<{ success: boolean }>("/auth/logout", "POST"),
};

export type PortalSessionRow = {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  deviceClass?: string | null;
  osName?: string | null;
  clientName?: string | null;
  clientLabel?: string | null;
  isCurrent?: boolean;
};

export const sessions = {
  list: () => request<{ sessions: PortalSessionRow[] }>("/sessions", "GET"),
  revoke: (id: number) => request<{ success: boolean }>(`/sessions/${id}`, "DELETE"),
  revokeOthers: () =>
    request<{ success: boolean; revoked: number }>("/sessions/revoke-others", "POST", {}),
};

// ─── Me ───────────────────────────────────────────────────────────────────────

export function me() {
  return request<MeResponse>("/me", "GET");
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export const stats = {
  overview: (period: string) =>
    request<OverviewStats>(`/stats/overview?period=${period}`, "GET"),

  timeseries: (period: string) =>
    request<TimeseriesItem[]>(`/stats/timeseries?period=${period}`, "GET"),

  byModel: (period: string) =>
    request<ModelUsage[]>(`/stats/by-model?period=${period}`, "GET"),

  byIde: (period: string) =>
    request<IdeUsage[]>(`/stats/by-ide?period=${period}`, "GET"),

  topErrors: (period: string = "7d") =>
    request<TopError[]>(`/stats/top-errors?period=${period}`, "GET"),

  compare: () =>
    request<{ today: CompareStats; yesterday: CompareStats }>("/stats/compare", "GET"),

  forecast: () =>
    request<ForecastResponse>("/stats/forecast", "GET"),
};

// ─── Keys ─────────────────────────────────────────────────────────────────────

export const keys = {
  list: () => request<KeyInfo[]>("/keys", "GET"),

  create: (name: string) =>
    request<{ id: number; name: string; key: string; keyPrefix: string }>("/keys", "POST", { name }),

  rotate: (id: number) =>
    request<{ success: boolean; key: string; keyPrefix: string }>(`/keys/${id}/rotate`, "POST"),

  delete: (id: number) =>
    request<{ success: boolean }>(`/keys/${id}`, "DELETE"),

  devices: (keyId: number) =>
    request<DeviceInfo[]>(`/keys/${keyId}/devices`, "GET"),

  deleteDevice: (keyId: number, fingerprint: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/devices/${fingerprint}`, "DELETE"),

  updatePolicies: (keyId: number, data: { devicePolicy?: string; idePolicy?: string }) =>
    request<{ success: boolean }>(`/keys/${keyId}/policies`, "PUT", data),
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const logs = {
  list: (period: string, limit = 50, page = 1) =>
    request<{
      data: LogItem[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/logs?period=${period}&limit=${limit}&page=${page}`, "GET"),
};

// ─── Models ───────────────────────────────────────────────────────────────────

export const models = {
  list: () => request<ModelEntry[]>("/models", "GET"),
};

// ─── Recap ────────────────────────────────────────────────────────────────────

export const recap = {
  status: () => request<RecapStatus>("/recap/status", "GET"),
  open: () => request<RecapOpenResponse>("/recap/open", "POST"),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = {
  list: () => request<NotificationsResponse>("/notifications", "GET"),
  dismiss: () => request<{ success: boolean; cleared: number }>("/notifications/dismiss", "POST"),
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settings = {
  setPassword: (newPassword: string, currentPassword?: string) =>
    request<{ success: boolean }>("/settings/password", "PUT", { newPassword, currentPassword }),

  removePassword: () =>
    request<{ success: boolean }>("/settings/password", "DELETE"),

  setWebhook: (url: string) =>
    request<{ success: boolean; webhookUrl?: string; webhookSecret?: string; hasWebhook: boolean; removed?: boolean }>(
      "/settings/webhook", "PUT", { url }
    ),

  removeWebhook: () =>
    request<{ success: boolean; removed: boolean; hasWebhook: boolean }>(
      "/settings/webhook", "PUT", { url: "" }
    ),

  getTokenSaver: () =>
    request<{
      global: {
        rtk: boolean;
        rtkMaxChars: number;
        headroom: boolean;
        caveman: boolean;
        cavemanLevel: number;
        ponytail: boolean;
        ponytailLevel: string;
        groupyCompact: boolean;
        groupyCompactLevel: string;
        batch: boolean;
      };
      overrides: {
        rtk: boolean | null;
        headroom: boolean | null;
        caveman: boolean | null;
        ponytail: boolean | null;
        groupyCompact: boolean | null;
        batch: boolean | null;
      };
    }>("/settings/token-saver", "GET"),

  setTokenSaver: (overrides: {
    rtk?: boolean | null;
    headroom?: boolean | null;
    caveman?: boolean | null;
    ponytail?: boolean | null;
    groupyCompact?: boolean | null;
    batch?: boolean | null;
  }) =>
    request<{
      success: boolean;
      overrides: {
        rtk: boolean | null;
        headroom: boolean | null;
        caveman: boolean | null;
        ponytail: boolean | null;
        groupyCompact: boolean | null;
        batch: boolean | null;
      };
    }>("/settings/token-saver", "PUT", overrides),
};

// ─── Root export ──────────────────────────────────────────────────────────────

export const api = { me, auth, stats, keys, logs, models, recap, notifications, settings, sessions };
