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
    "⚠️ **Limit Trial Tercapai**\n\nLimit harian/bulanan trial Anda sudah habis. Trial berakhir: {expiresAt}",
  expired:
    "⏰ **Trial Berakhir**\n\nMasa trial API Anda sudah habis. Hubungi admin jika ingin akses penuh.",
  terminated:
    "🚫 **Trial Dihentikan Admin**\n\nTrial API Anda dihentikan oleh admin.\nAlasan: {reason}",
  keyRotated:
    "🔄 **API Key Trial Di-rotate**\n\nKey trial Anda di-rotate karena terdeteksi penggunaan dari lebih dari 1 device.\n\n**Endpoint:** `{endpoint}`\n**Key baru:** `{apiKey}`",
  claimed:
    "🎁 **Trial API Aktif**\n\n**Endpoint:** `{endpoint}`\n**Authorization:** `Bearer {apiKey}`\n\n**Rules:**\n• Durasi: {durationDays} hari (sampai {expiresAt})\n• Token harian: {dailyTokenLimit}\n• Prompt: {promptLimit}/{promptWindow}\n• Model: hanya **gpy**\n\n**Model tersedia:**\n{modelList}",
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
    trialDefaultDurationDays: config.trialDefaultDurationDays ?? 30,
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
        (key.isTrial ? "5h" : "30m"),
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
    window: config?.globalPromptLimitWindow || "30m",
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
