import type { AdminConfig } from "../db/schema.js";

export type TrialEmbedConfig = {
  title?: string;
  description?: string;
  color?: number;
  footer?: string;
  buttonLabel?: string;
};

export type TrialDmTemplates = {
  limitReached?: string;
  expired?: string;
  terminated?: string;
  keyRotated?: string;
  claimed?: string;
  reclaimAvailable?: string;
  upgradePhantom?: string;
  extended?: string;
};

export const DEFAULT_TRIAL_EMBED: TrialEmbedConfig = {
  title: "🎁 Trial API Access — Klaim Sekarang!",
  description:
    "Dapatkan akses trial ke proxy API Groupy.\n\n" +
    "**Syarat:**\n" +
    "• 1 akun = 1 trial\n" +
    "• Berlaku selama periode trial\n" +
    "• Model **gpy** saja\n\n" +
    "Klik tombol di bawah untuk klaim.",
  color: 0x57f287,
  footer: "Groupy Proxy Trial",
  buttonLabel: "Klaim Trial API",
};

export const DEFAULT_TRIAL_DM: TrialDmTemplates = {
  limitReached:
    "⚠️ **Limit Trial Tercapai**\n\nLimit harian/bulanan trial Anda sudah habis. Trial berakhir: {expiresAtFormatted}\n\n{upgradePhantom}",
  expired:
    "⏰ **Trial Berakhir**\n\nMasa trial API Anda sudah habis. Terima kasih sudah mencoba!\n\n{upgradePhantom}",
  terminated:
    "🚫 **Trial Dihentikan Admin**\n\nTrial API Anda dihentikan oleh admin.\nAlasan: {reason}\n\n{upgradePhantom}",
  keyRotated:
    "🔄 **API Key Trial Di-rotate**\n\nKey trial Anda di-rotate karena terdeteksi penggunaan dari lebih dari 1 device.\n\n**Endpoint:** `{endpoint}`\n**Key baru:** `{apiKey}`",
  claimed:
    "🎁 **Trial API Aktif**\n\n**A. OpenAI-compatible clients (Cline/Codex/OpenCode/Cursor):**\n```\nEndpoint:   {endpoint}\nAuthorization: Bearer {apiKey}\n```\n\n**B. Anthropic clients (Claude Code) — auto-translated by proxy:**\n```bash\nexport ANTHROPIC_BASE_URL=\"{endpoint}\"\nexport ANTHROPIC_AUTH_TOKEN=\"{apiKey}\"\nexport ANTHROPIC_DEFAULT_SONNET_MODEL=\"{firstModel}\"\nexport ANTHROPIC_DEFAULT_HAIKU_MODEL=\"{firstModel}\"\nexport ANTHROPIC_DEFAULT_OPUS_MODEL=\"{firstModel}\"\nexport API_TIMEOUT_MS=500000\n```\n(Setting `ANTHROPIC_BASE_URL` ke path di atas otomatis route ke `/v1/messages` di proxy.)\n\n**Rules:**\n• Durasi: {durationDays} hari (berakhir {expiresAtFormatted})\n• Token harian: {dailyTokenLimit}\n• Prompt: {promptLimit}/{promptWindow}\n• Model: hanya **gpy**\n\n**Model tersedia:**\n{modelList}",
  reclaimAvailable:
    "🎁 **Trial Baru Tersedia**\n\nAdmin sudah membuka akses trial lagi untuk kamu. Silakan klaim ulang di channel <#{channelId}> dengan menekan tombol **Klaim Trial API**.\n\nDurasi baru: {durationDays} hari\n{upgradePhantom}",
  upgradePhantom:
    "🚀 **Upgrade ke Phantom Member**\n\nUntuk akses unlimited, semua model, dan token lebih besar, verifikasi AG kamu di channel <#{agverifChannelId}>.\n\nKeuntungan Phantom:\n• Akses semua model (qwen, anthropic, tokito, dll)\n• Token limit lebih besar\n• Multi-device\n• Permanen (selama role aktif)",
  extended:
    "⏰ **Trial Diperpanjang**\n\nAdmin sudah memperpanjang trial API kamu.\n\n• Tambahan: **{days} hari**\n• Baru berakhir: {expiresAtFormatted}\n• Key tetap sama: `{apiKey}`\n\n{upgradePhantom}",
};

export function parseTrialEmbedConfig(raw: string | null | undefined): TrialEmbedConfig {
  try {
    const parsed = JSON.parse(raw || "{}");
    return { ...DEFAULT_TRIAL_EMBED, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_TRIAL_EMBED };
  }
}

export function parseTrialDmTemplates(raw: string | null | undefined): TrialDmTemplates {
  try {
    const parsed = JSON.parse(raw || "{}");
    return { ...DEFAULT_TRIAL_DM, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_TRIAL_DM };
  }
}

export function parseTrialModelWhitelist(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseTrialUpstreams(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function formatTrialTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  // Auto-substitute Discord-friendly timestamps so templates can stay readable
  // (admin writes "{expiresAt}" or "{expiresAtFormatted}") and the user sees a
  // localized "<t:..:F>" token that Discord renders in their timezone.
  if (vars.expiresAt) {
    const unix = Math.floor(new Date(vars.expiresAt).getTime() / 1000);
    if (Number.isFinite(unix)) {
      out = out
        .split("{expiresAtFormatted}").join(`<t:${unix}:F>`)
        .split("{expiresAtRelative}").join(`<t:${unix}:R>`)
        .split("{expiresAtTime}").join(`<t:${unix}:t>`)
        .split("{expiresAtDate}").join(`<t:${unix}:D>`);
    }
  }
  return out;
}

export function buildTrialSettingsResponse(
  config: AdminConfig,
  gpyModels: string[] = [],
  catalogModelsByUpstream: Record<string, string[]> = {},
) {
  const embed = parseTrialEmbedConfig(config.trialEmbedConfig);
  const dmTemplates = parseTrialDmTemplates(config.trialDmTemplates);
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  const trialUpstreams = parseTrialUpstreams(config.trialUpstreams);
  const accessMode = config.trialAccessMode || "groupy_members";
  const requiredRoleId = config.trialRequiredRoleId || "1354682641961582632";

  let embedDescription = embed.description || DEFAULT_TRIAL_EMBED.description || "";
  if (accessMode === "groupy_members") {
    embedDescription +=
      `\n\n**Syarat role:** <@&${requiredRoleId}> (minimal punya role Groupy)`;
  } else {
    embedDescription += "\n\n**Akses:** Semua member server boleh klaim.";
  }

  return {
    trialEnabled: Boolean(config.trialEnabled),
    trialAccessMode: accessMode,
    trialRequiredRoleId: requiredRoleId,
    trialDefaultDurationDays: config.trialDefaultDurationDays ?? 1,
    trialMaxPerAccount: config.trialMaxPerAccount ?? 1,
    trialDailyTokenLimit: config.trialDailyTokenLimit ?? 1_000_000,
    trialPromptLimit: config.trialPromptLimit ?? 50,
    trialPromptLimitWindow: config.trialPromptLimitWindow || "5h",
    trialModelSelectionMode: config.trialModelSelectionMode || "all_gpy",
    trialModelWhitelist: whitelist,
    trialUpstreams,
    trialPanelMessageId: config.trialPanelMessageId || null,
    trialEmbedConfig: { ...embed, description: embedDescription },
    trialDmTemplates: dmTemplates,
    gpyModels,
    catalogModelsByUpstream,
    configUpdatedAt: config.updatedAt ? new Date(config.updatedAt).toISOString() : null,
  };
}

export function isGpyProviderOrModel(providerName: string | null | undefined, modelId: string): boolean {
  const p = (providerName || "").toLowerCase();
  const m = (modelId || "").toLowerCase();
  return p === "gpy" || m.startsWith("gpy/") || m.startsWith("gpy:");
}

type KeyLimitFields = {
  isTrial: boolean;
  promptLimit?: number | null;
  promptLimitWindow?: string | null;
  rateLimit?: number | null;
  rateLimitWindow?: string | null;
  dailyTokenLimit?: number | null;
};

/** Resolve prompt limit/window — trial keys never fall back to global Phantom limits. */
export function resolveKeyPromptLimit(
  key: KeyLimitFields,
  config: AdminConfig | null | undefined,
): { limit: number; window: string } {
  const keyLimit = key.promptLimit || 0;
  if (keyLimit > 0) {
    return {
      limit: keyLimit,
      window:
        key.promptLimitWindow ||
        (key.isTrial ? config?.trialPromptLimitWindow : config?.globalPromptLimitWindow) ||
        (key.isTrial ? "5h" : "5h"),
    };
  }
  if (key.isTrial) {
    return {
      limit: config?.trialPromptLimit ?? 50,
      window: config?.trialPromptLimitWindow || "5h",
    };
  }
  return {
    limit: config?.globalPromptLimit || 0,
    window: config?.globalPromptLimitWindow || "5h",
  };
}

/**
 * Resolve API-call (hop) limit/window.
 * Key override → global; trial uses global hop limit when set (same shared infra).
 */
export function resolveKeyApiCallLimit(
  key: KeyLimitFields,
  config: AdminConfig | null | undefined,
): { limit: number; window: string } {
  const keyLimit = key.rateLimit || 0;
  if (keyLimit > 0) {
    return {
      limit: keyLimit,
      window: key.rateLimitWindow || config?.globalRateLimitWindow || "5h",
    };
  }
  return {
    limit: config?.globalRateLimit || 0,
    window: config?.globalRateLimitWindow || "5h",
  };
}

/** Resolve daily token cap — trial keys never fall back to global Phantom limits. */
export function resolveKeyDailyTokenLimit(
  key: KeyLimitFields,
  config: AdminConfig | null | undefined,
): number {
  const keyLimit = key.dailyTokenLimit || 0;
  if (keyLimit > 0) return keyLimit;
  if (key.isTrial) return config?.trialDailyTokenLimit ?? 1_000_000;
  return config?.globalDailyTokenLimit || 0;
}
