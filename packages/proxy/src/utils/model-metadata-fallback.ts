/**
 * Hardcoded model metadata fallback.
 *
 * Used for models NOT found on OpenRouter (e.g., Xiaomi MiMo, internal/custom models).
 * Data sourced from official docs (Xiaomi MiMo platform, Alibaba Cloud Model Studio).
 *
 * Pricing is in microcents per 1M tokens (multiply USD by 1_000_000).
 * e.g., $1.20/M tokens = 1_200_000 microcents.
 */

export interface FallbackMetadata {
  modelId: string;
  displayName: string;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  inputPricePerMtok?: number;  // microcents per 1M tokens
  outputPricePerMtok?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedFeatures?: string[];
}

function usd(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

export const FALLBACK_METADATA: FallbackMetadata[] = [
  // ─── Xiaomi MiMo Series ──────────────────────────────────────────────────────
  {
    modelId: "mimo-v2.5-pro",
    displayName: "MiMo V2.5 Pro",
    description: "Xiaomi MiMo V2.5 Pro — 1.02T MoE (42B active), 1M context, agentic coding & reasoning",
    contextLength: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMtok: usd(0.435),
    outputPricePerMtok: usd(0.87),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["thinking", "function_call", "structured_output", "streaming", "web_search"],
  },
  {
    modelId: "mimo-v2-pro",
    displayName: "MiMo V2 Pro",
    description: "Xiaomi MiMo V2 Pro — previous gen flagship, 1M context",
    contextLength: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMtok: usd(0.435),
    outputPricePerMtok: usd(0.87),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["thinking", "function_call", "structured_output", "streaming"],
  },
  {
    modelId: "mimo-v2.5",
    displayName: "MiMo V2.5",
    description: "Xiaomi MiMo V2.5 — 310B MoE (15B active), multimodal (text/image/audio/video), 1M context",
    contextLength: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMtok: usd(0.22),
    outputPricePerMtok: usd(0.44),
    inputModalities: ["text", "image", "audio", "video"],
    outputModalities: ["text"],
    supportedFeatures: ["thinking", "function_call", "structured_output", "streaming", "multimodal", "web_search"],
  },
  {
    modelId: "mimo-v2-omni",
    displayName: "MiMo V2 Omni",
    description: "Xiaomi MiMo V2 Omni — multimodal understanding, 256K context",
    contextLength: 256_000,
    maxOutputTokens: 128_000,
    inputPricePerMtok: usd(0.22),
    outputPricePerMtok: usd(0.44),
    inputModalities: ["text", "image", "audio", "video"],
    outputModalities: ["text"],
    supportedFeatures: ["multimodal", "streaming"],
  },
  {
    modelId: "mimo-v2.5-tts",
    displayName: "MiMo V2.5 TTS",
    description: "Xiaomi MiMo V2.5 Text-to-Speech — standard preset voices",
    inputModalities: ["text"],
    outputModalities: ["audio"],
    supportedFeatures: ["tts"],
  },
  {
    modelId: "mimo-v2.5-tts-voiceclone",
    displayName: "MiMo V2.5 TTS Voice Clone",
    description: "Xiaomi MiMo V2.5 TTS with voice cloning from audio sample",
    inputModalities: ["text", "audio"],
    outputModalities: ["audio"],
    supportedFeatures: ["tts", "voice_clone"],
  },
  {
    modelId: "mimo-v2.5-tts-voicedesign",
    displayName: "MiMo V2.5 TTS Voice Design",
    description: "Xiaomi MiMo V2.5 TTS with customized tone design",
    inputModalities: ["text"],
    outputModalities: ["audio"],
    supportedFeatures: ["tts", "voice_design"],
  },
  {
    modelId: "mimo-v2-tts",
    displayName: "MiMo V2 TTS",
    description: "Xiaomi MiMo V2 Text-to-Speech",
    inputModalities: ["text"],
    outputModalities: ["audio"],
    supportedFeatures: ["tts"],
  },
  {
    modelId: "mimo-v2-flash",
    displayName: "MiMo V2 Flash",
    description: "Xiaomi MiMo V2 Flash — fast, low-cost, 256K context",
    contextLength: 256_000,
    maxOutputTokens: 64_000,
    inputPricePerMtok: usd(0.07),
    outputPricePerMtok: usd(0.14),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["thinking", "function_call", "structured_output", "streaming"],
  },

  // ─── Internal / Custom Models ────────────────────────────────────────────────
  {
    modelId: "combogroupy",
    displayName: "Combo Groupy",
    description: "Internal combo model for Groupy platform",
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
  {
    modelId: "ccai-pro",
    displayName: "CCAI Pro",
    description: "Alibaba Cloud Customer Contact AI — specialized conversational model",
    contextLength: 32_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
  {
    modelId: "tongyi-tingwu-slp",
    displayName: "Tongyi Tingwu SLP",
    description: "Alibaba Tongyi speech/language processing model",
    inputModalities: ["audio", "text"],
    outputModalities: ["text"],
    supportedFeatures: ["speech_processing"],
  },

  // ─── Qwen Machine Translation ────────────────────────────────────────────────
  {
    modelId: "qwen-mt-turbo",
    displayName: "Qwen MT Turbo",
    description: "Alibaba Qwen Machine Translation — fast, low cost",
    inputPricePerMtok: usd(0.05),
    outputPricePerMtok: usd(0.20),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["translation"],
  },
  {
    modelId: "qwen-mt-lite",
    displayName: "Qwen MT Lite",
    description: "Alibaba Qwen Machine Translation — lightweight",
    inputPricePerMtok: usd(0.03),
    outputPricePerMtok: usd(0.10),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["translation"],
  },
  {
    modelId: "qwen-mt-plus",
    displayName: "Qwen MT Plus",
    description: "Alibaba Qwen Machine Translation — higher quality",
    inputPricePerMtok: usd(0.10),
    outputPricePerMtok: usd(0.40),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["translation"],
  },
  {
    modelId: "qwen-mt-flash",
    displayName: "Qwen MT Flash",
    description: "Alibaba Qwen Machine Translation — fastest",
    inputPricePerMtok: usd(0.03),
    outputPricePerMtok: usd(0.10),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["translation"],
  },

  // ─── Qwen Character Models ──────────────────────────────────────────────────
  {
    modelId: "qwen-flash-character",
    displayName: "Qwen Flash Character",
    description: "Alibaba Qwen Character roleplay — flash tier",
    contextLength: 131_072,
    inputPricePerMtok: usd(0.05),
    outputPricePerMtok: usd(0.20),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["character_roleplay"],
  },
  {
    modelId: "qwen-plus-character",
    displayName: "Qwen Plus Character",
    description: "Alibaba Qwen Character roleplay — plus tier",
    contextLength: 131_072,
    inputPricePerMtok: usd(0.28),
    outputPricePerMtok: usd(0.56),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["character_roleplay"],
  },

  // ─── Qwen Coder Models ──────────────────────────────────────────────────────
  {
    modelId: "qwen-coder-plus",
    displayName: "Qwen Coder Plus",
    description: "Alibaba Qwen specialized coding model",
    contextLength: 131_072,
    inputPricePerMtok: usd(0.28),
    outputPricePerMtok: usd(0.56),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["coding", "function_call"],
  },
];

/**
 * Look up fallback metadata by model ID.
 * Tries exact match first, then prefix match (for versioned model IDs like qwen3-max-2026-01-23).
 */
export function getFallbackMetadata(modelId: string): FallbackMetadata | undefined {
  // Exact match
  const exact = FALLBACK_METADATA.find(m => m.modelId === modelId);
  if (exact) return exact;

  // Prefix match: if modelId is "qwen-mt-turbo-2025-04-28", match "qwen-mt-turbo"
  for (const fb of FALLBACK_METADATA) {
    if (modelId.startsWith(fb.modelId + "-") || modelId.startsWith(fb.modelId + "_")) {
      return fb;
    }
  }

  return undefined;
}
