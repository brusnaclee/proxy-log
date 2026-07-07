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
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const auth = {
  login: (apiKey: string) =>
    request<{ requiresPassword: boolean; discordUserId?: string; success?: boolean; autoLogin?: boolean }>("/auth/login", "POST", { apiKey }),
  verifyPassword: (discordUserId: string, password: string) =>
    request<{ success: boolean }>("/auth/verify-password", "POST", { discordUserId, password }),
  logout: () => request<{ success: boolean }>("/auth/logout", "POST"),
};

// Me
export function me() {
  return request<{
    discordUserId: string;
    discordUsername: string | null;
    hasPassword: boolean;
    keyCount: number;
    keys: Array<{ id: number; name: string; keyPrefix: string; isActive: boolean; isTrial: boolean; createdAt: string }>;
    limits: {
      maxDevices: number;
      dailyTokenLimit: number;
      monthlyTokenLimit: number;
      dailyInputTokenLimit: number;
      dailyOutputTokenLimit: number;
      rateLimit: number;
      rateLimitWindow: string;
      promptLimit: number;
      promptLimitWindow: string;
    };
  }>("/me", "GET");
}

// Stats
export const stats = {
  overview: (period: string) =>
    request<{
      requests: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
      sessions: number;
      toolCalls: number;
      cost: { prompt: number; completion: number; total: number };
    }>(`/stats/overview?period=${period}`, "GET"),

  timeseries: (period: string) =>
    request<Array<{ period: string; requests: number; tokens: number; promptTokens: number; completionTokens: number }>>(
      `/stats/timeseries?period=${period}`, "GET"
    ),

  byModel: (period: string) =>
    request<Array<{ model: string; requests: number; promptTokens: number; completionTokens: number; tokens: number }>>(
      `/stats/by-model?period=${period}`, "GET"
    ),

  byIde: (period: string) =>
    request<Array<{ ide: string; requests: number; devices: number }>>(
      `/stats/by-ide?period=${period}`, "GET"
    ),
};

// Keys
export const keys = {
  list: () =>
    request<Array<{
      id: number; name: string; keyPrefix: string; keyMasked: string;
      isActive: boolean; isTrial: boolean; createdAt: string; requestsToday: number;
    }>>("/keys", "GET"),

  create: (name: string) =>
    request<{ id: number; name: string; key: string; keyPrefix: string }>("/keys", "POST", { name }),

  rotate: (id: number) =>
    request<{ success: boolean; key: string; keyPrefix: string }>(`/keys/${id}/rotate`, "POST"),

  devices: (keyId: number) =>
    request<Array<{
      fingerprint: string; deviceName: string; ideDetected: string;
      osDetected: string; requestCount: number; lastSeen: string; isBlocked: boolean;
    }>>(`/keys/${keyId}/devices`, "GET"),

  deleteDevice: (keyId: number, fingerprint: string) =>
    request<{ success: boolean }>(`/keys/${keyId}/devices/${fingerprint}`, "DELETE"),

  updatePolicies: (keyId: number, data: { devicePolicy?: string; idePolicy?: string }) =>
    request<{ success: boolean }>(`/keys/${keyId}/policies`, "PUT", data),
};

// Logs
export const logs = {
  list: (period: string, limit = 50, page = 1) =>
    request<{
      data: Array<{
        model: string; promptTokens: number; completionTokens: number;
        totalTokens: number; ideDetected: string; provider: string;
        latencyMs: number; statusCode: number; createdAt: string;
      }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/logs?period=${period}&limit=${limit}&page=${page}`, "GET"),
};

// Settings
export const settings = {
  setPassword: (newPassword: string, currentPassword?: string) =>
    request<{ success: boolean }>("/settings/password", "PUT", { newPassword, currentPassword }),
  removePassword: () =>
    request<{ success: boolean }>("/settings/password", "DELETE"),
};

// Root export
export const api = { me, auth, stats, keys, logs, settings };
