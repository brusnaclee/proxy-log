/**
 * Cost calculator for AI model token usage.
 * Prices are in USD per 1M tokens. Microdollars = dollars * 1,000,000.
 *
 * Model IDs from Tokito (api3.tokito.xyz) are in format "provider/model-name".
 * Pricing is best-effort based on known upstream pricing; unknown models use
 * a conservative default fallback rate.
 *
 * Context tokens are priced at the same rate as input/prompt tokens
 * (all providers charge context as part of the input token count).
 */

import { db } from "../db/index.js";
import { modelMetadata } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface ModelRates {
  prompt: number;    // $ per 1M input tokens
  completion: number; // $ per 1M output tokens
}

// ─── Default fallback rate for unknown models ────────────────────────────────
// Conservative mid-range estimate: ~$1.50 input / $6.00 output per 1M tokens
const DEFAULT_RATES: ModelRates = { prompt: 1.50, completion: 6.00 };

// ─── Model Cost Table ────────────────────────────────────────────────────────
export const MODEL_COSTS: Record<string, ModelRates> = {

  // ── ag/ (Antigravity custom wrappers) ──────────────────────────────────────
  "ag/claude-opus-4-6-thinking":    { prompt: 5.00,  completion: 25.00 },
  "ag/claude-sonnet-4-6":           { prompt: 3.00,  completion: 15.00 },
  "ag/gemini-3-flash":              { prompt: 0.10,  completion: 0.40  },
  "ag/gemini-3.1-pro-high":         { prompt: 1.25,  completion: 5.00  },
  "ag/gemini-3.1-pro-low":          { prompt: 0.30,  completion: 1.25  },
  "ag/gpt-oss-120b-medium":         { prompt: 0.90,  completion: 0.90  },

  // ── cx/ (Codex / GPT-5 family variants) ───────────────────────────────────
  // Standard GPT-5.x → $2.50 in / $15 out
  "cx/gpt-5.1":                         { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.1-review":                  { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.2":                         { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.2-review":                  { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.4":                         { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.4-review":                  { prompt: 2.50, completion: 15.00 },

  // Flagship GPT-5.5 → $5 in / $30 out
  "cx/gpt-5.5":                         { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.5-review":                  { prompt: 5.00, completion: 30.00 },

  // Codex standard tier → $2.50 in / $15 out
  "cx/gpt-5-codex":                     { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5-codex-review":              { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.1-codex":                   { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.1-codex-review":            { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.2-codex":                   { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.2-codex-review":            { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex":                   { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-review":            { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-low":               { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-low-review":        { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-none":              { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-none-review":       { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-spark":             { prompt: 2.50, completion: 15.00 },
  "cx/gpt-5.3-codex-spark-review":      { prompt: 2.50, completion: 15.00 },

  // Codex mini tier → $0.75 in / $4.50 out
  "cx/gpt-5-codex-mini":                { prompt: 0.75, completion: 4.50 },
  "cx/gpt-5-codex-mini-review":         { prompt: 0.75, completion: 4.50 },
  "cx/gpt-5.1-codex-mini":              { prompt: 0.75, completion: 4.50 },
  "cx/gpt-5.1-codex-mini-review":       { prompt: 0.75, completion: 4.50 },
  "cx/gpt-5.1-codex-mini-high":         { prompt: 0.75, completion: 4.50 },
  "cx/gpt-5.1-codex-mini-high-review":  { prompt: 0.75, completion: 4.50 },

  // Codex max / high / xhigh tier (heavy reasoning) → $5.00 in / $30 out
  "cx/gpt-5.1-codex-max":               { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.1-codex-max-review":        { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.3-codex-high":              { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.3-codex-high-review":       { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.3-codex-xhigh":             { prompt: 5.00, completion: 30.00 },
  "cx/gpt-5.3-codex-xhigh-review":      { prompt: 5.00, completion: 30.00 },

  // ── glm/ (Zhipu AI GLM) ───────────────────────────────────────────────────
  "glm/glm-4.6v":  { prompt: 0.05, completion: 0.05 },
  "glm/glm-4.7":   { prompt: 0.05, completion: 0.05 },
  "glm/glm-5":     { prompt: 0.10, completion: 0.10 },
  "glm/glm-5.1":   { prompt: 0.10, completion: 0.10 },

  // ── minimax/ ──────────────────────────────────────────────────────────────
  "minimax/MiniMax-M2.1": { prompt: 0.10, completion: 0.55 },
  "minimax/MiniMax-M2.5": { prompt: 0.20, completion: 1.10 },
  "minimax/MiniMax-M2.7": { prompt: 0.30, completion: 1.10 },

  // ── ollama/ (self-hosted, minimal cost) ───────────────────────────────────
  "ollama/glm-4.7-flash":  { prompt: 0.01, completion: 0.01 },
  "ollama/glm-5":          { prompt: 0.01, completion: 0.01 },
  "ollama/gpt-oss:120b":   { prompt: 0.05, completion: 0.05 },
  "ollama/kimi-k2.5":      { prompt: 0.01, completion: 0.01 },
  "ollama/minimax-m2.5":   { prompt: 0.01, completion: 0.01 },
  "ollama/qwen3.5":        { prompt: 0.01, completion: 0.01 },

  // ── xai/ (Grok) ───────────────────────────────────────────────────────────
  "xai/grok-3":                  { prompt: 3.00,  completion: 15.00 },
  "xai/grok-4":                  { prompt: 5.00,  completion: 25.00 },
  "xai/grok-4-fast-reasoning":   { prompt: 5.00,  completion: 25.00 },
  "xai/grok-code-fast-1":        { prompt: 3.00,  completion: 15.00 },

  // ── combogroupy / unknown ─────────────────────────────────────────────────
  "combogroupy": { prompt: 1.00, completion: 4.00 },

  // ── Anthropic Claude (standard model IDs) ─────────────────────────────────
  "claude-opus-4":              { prompt: 5.00,  completion: 25.00 },
  "claude-opus-4.1":            { prompt: 15.00, completion: 75.00 },
  "claude-opus-4.5":            { prompt: 5.00,  completion: 25.00 },
  "claude-opus-4.6":            { prompt: 5.00,  completion: 25.00 },
  "claude-opus-4.7":            { prompt: 5.00,  completion: 25.00 },
  "claude-sonnet-4":            { prompt: 3.00,  completion: 15.00 },
  "claude-sonnet-4.5":          { prompt: 3.00,  completion: 15.00 },
  "claude-sonnet-4.6":          { prompt: 3.00,  completion: 15.00 },
  "claude-haiku-4":             { prompt: 1.00,  completion: 5.00  },
  "claude-haiku-4.5":           { prompt: 1.00,  completion: 5.00  },
  "claude-3-5-sonnet-20240620": { prompt: 3.00,  completion: 15.00 },
  "claude-3-5-sonnet-latest":   { prompt: 3.00,  completion: 15.00 },
  "claude-3-5-sonnet":          { prompt: 3.00,  completion: 15.00 },
  "claude-3-5-haiku-20241022":  { prompt: 1.00,  completion: 5.00  },
  "claude-3-5-haiku":           { prompt: 1.00,  completion: 5.00  },
  "claude-3-opus-20240229":     { prompt: 15.00, completion: 75.00 },
  "claude-3-opus":              { prompt: 15.00, completion: 75.00 },
  "claude-3-haiku-20240307":    { prompt: 0.25,  completion: 1.25  },
  "claude-3-haiku":             { prompt: 0.25,  completion: 1.25  },

  // ── OpenAI GPT (standard model IDs) ──────────────────────────────────────
  "gpt-5.5":           { prompt: 5.00,  completion: 30.00 },
  "gpt-5.4":           { prompt: 2.50,  completion: 15.00 },
  "gpt-5.3":           { prompt: 2.50,  completion: 15.00 },
  "gpt-5.2":           { prompt: 2.50,  completion: 15.00 },
  "gpt-5.1":           { prompt: 2.50,  completion: 15.00 },
  "gpt-5":             { prompt: 2.50,  completion: 15.00 },
  "gpt-5-mini":        { prompt: 0.75,  completion: 4.50  },
  "gpt-4o":            { prompt: 2.50,  completion: 10.00 },
  "gpt-4o-2024-05-13": { prompt: 5.00,  completion: 15.00 },
  "gpt-4o-mini":       { prompt: 0.15,  completion: 0.60  },
  "gpt-4-turbo":       { prompt: 10.00, completion: 30.00 },
  "gpt-3.5-turbo":     { prompt: 0.50,  completion: 1.50  },
  "o4-mini":           { prompt: 1.10,  completion: 4.40  },
  "o3":                { prompt: 10.00, completion: 40.00 },
  "o3-mini":           { prompt: 1.10,  completion: 4.40  },
  "o1-preview":        { prompt: 15.00, completion: 60.00 },
  "o1-mini":           { prompt: 3.00,  completion: 12.00 },
  "o1":                { prompt: 15.00, completion: 60.00 },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  "gemini-2.5-pro":           { prompt: 1.25, completion: 10.00 },
  "gemini-2.5-flash":         { prompt: 0.15, completion: 0.60  },
  "gemini-2.0-flash":         { prompt: 0.10, completion: 0.40  },
  "gemini-2.0-pro-exp-02-05": { prompt: 1.25, completion: 5.00  },
  "gemini-1.5-pro":           { prompt: 1.25, completion: 5.00  },
  "gemini-1.5-flash":         { prompt: 0.075, completion: 0.30 },

  // ── DeepSeek ─────────────────────────────────────────────────────────────
  "deepseek-chat":      { prompt: 0.14, completion: 0.28 },
  "deepseek-reasoner":  { prompt: 0.55, completion: 2.19 },
  "deepseek-v3":        { prompt: 0.27, completion: 1.10 },

  // ── Groq / Open-source ───────────────────────────────────────────────────
  "llama-3.1-70b-versatile": { prompt: 0.59, completion: 0.79 },
  "llama-3.1-8b-instant":    { prompt: 0.05, completion: 0.08 },
  "mixtral-8x7b-32768":      { prompt: 0.24, completion: 0.24 },
  "qwen3.5":                 { prompt: 0.10, completion: 0.30 },
  "kimi-k2.5":               { prompt: 0.14, completion: 0.28 },
};

// ─── Metadata-based pricing cache ──────────────────────────────────────────────
// Populated from model_metadata table on startup and periodically.
const metadataPricingCache = new Map<string, ModelRates>();
let metadataPricingLoaded = false;

export async function refreshMetadataPricing(): Promise<void> {
  try {
    const rows = await db.select({
      modelId: modelMetadata.modelId,
      inputPricePerMtok: modelMetadata.inputPricePerMtok,
      outputPricePerMtok: modelMetadata.outputPricePerMtok,
    }).from(modelMetadata).all();

    for (const row of rows) {
      if (row.inputPricePerMtok || row.outputPricePerMtok) {
        metadataPricingCache.set(row.modelId, {
          prompt: (row.inputPricePerMtok || 0) / 1_000_000,
          completion: (row.outputPricePerMtok || 0) / 1_000_000,
        });
      }
    }
    metadataPricingLoaded = true;
  } catch {
    // DB may not be ready yet on first call
  }
}

// Auto-refresh pricing cache every 10 minutes
setInterval(() => { void refreshMetadataPricing(); }, 10 * 60 * 1000);
// Initial load after 5s delay (wait for DB init)
setTimeout(() => { void refreshMetadataPricing(); }, 5000);

// ─── Lookup Helper ───────────────────────────────────────────────────────────

/**
 * Find cost rates for a model. Strategy:
 * 1. model_metadata DB pricing (from OpenRouter / hardcode enrichment)
 * 2. Exact match in hardcoded MODEL_COSTS
 * 3. Substring match (e.g. "anthropic/claude-sonnet-4.6" → matches "claude-sonnet-4")
 * 4. Prefix/provider match for known providers
 * 5. DEFAULT_RATES fallback
 */
function findModelRates(modelName: string): ModelRates {
  const n = String(modelName || "").toLowerCase().trim();
  if (!n) return DEFAULT_RATES;

  // 0. Check metadata pricing cache first (from OpenRouter / hardcode enrichment)
  const metaRates = metadataPricingCache.get(n) || metadataPricingCache.get(modelName);
  if (metaRates && (metaRates.prompt > 0 || metaRates.completion > 0)) return metaRates;

  // Also check without provider prefix for metadata
  const slashIdx = n.indexOf("/");
  if (slashIdx > 0) {
    const bareId = n.slice(slashIdx + 1);
    const bareRates = metadataPricingCache.get(bareId);
    if (bareRates && (bareRates.prompt > 0 || bareRates.completion > 0)) return bareRates;
  }

  // 1. Exact match (case-insensitive)
  const exact = MODEL_COSTS[n] ?? MODEL_COSTS[modelName];
  if (exact) return exact;

  // 2. Check each key: does the normalised model contain this key, or vice-versa?
  for (const [key, rates] of Object.entries(MODEL_COSTS)) {
    if (n.includes(key.toLowerCase()) || key.toLowerCase().includes(n)) {
      return rates;
    }
  }

  // 3. Provider-level fallback for known prefixes
  if (n.startsWith("ag/"))       return { prompt: 2.00,  completion: 10.00 };
  if (n.startsWith("cx/"))       return { prompt: 2.50,  completion: 15.00 };
  if (n.startsWith("glm/"))      return { prompt: 0.08,  completion: 0.08  };
  if (n.startsWith("minimax/"))  return { prompt: 0.20,  completion: 1.00  };
  if (n.startsWith("ollama/"))   return { prompt: 0.02,  completion: 0.02  };
  if (n.startsWith("xai/"))      return { prompt: 3.00,  completion: 15.00 };
  if (n.startsWith("claude"))    return { prompt: 3.00,  completion: 15.00 };
  if (n.startsWith("gpt"))       return { prompt: 2.50,  completion: 15.00 };
  if (n.startsWith("gemini"))    return { prompt: 0.30,  completion: 1.20  };
  if (n.startsWith("deepseek"))  return { prompt: 0.30,  completion: 1.00  };
  if (n.startsWith("o1") || n.startsWith("o3") || n.startsWith("o4")) {
    return { prompt: 5.00, completion: 20.00 };
  }

  return DEFAULT_RATES;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the per-million-token rates for a given model.
 * Exported so stats endpoints can compute per-model breakdowns.
 */
export function getModelRates(modelName: string): ModelRates {
  return findModelRates(modelName);
}

/**
 * Calculates the estimated cost of a request in micro-dollars (millionths of a dollar).
 * Returns integer: 1_000_000 = $1.00
 */
export function calculateEstimatedCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rates = findModelRates(modelName);
  const promptCost      = (promptTokens     || 0) * rates.prompt;
  const completionCost  = (completionTokens || 0) * rates.completion;
  return Math.round(promptCost + completionCost);
}
