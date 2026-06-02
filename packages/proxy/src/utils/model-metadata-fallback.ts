/**
 * Hardcoded model metadata fallback.
 *
 * Used for models NOT found on OpenRouter (e.g., Xiaomi MiMo, internal/custom models,
 * ag/* wrappers, glm/*, ollama/*, Qwen legacy models, non-chat models).
 * Data sourced from official docs (Xiaomi MiMo, Alibaba Cloud, Zhipu AI, MiniMax, Anthropic, Google).
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
  inputPricePerMtok?: number;
  outputPricePerMtok?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedFeatures?: string[];
}

function usd(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

export const FALLBACK_METADATA: FallbackMetadata[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // ag/ — Antigravity custom wrappers (upstream pricing passthrough)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "ag/claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)", description: "Anthropic Claude Opus 4.6 with extended thinking", contextLength: 1_000_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(5.00), outputPricePerMtok: usd(25.00), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", description: "Anthropic Claude Sonnet 4.6 — coding, agents, professional work", contextLength: 1_000_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(3.00), outputPricePerMtok: usd(15.00), inputModalities: ["text", "image", "file"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/gemini-3-flash", displayName: "Gemini 3 Flash", description: "Google Gemini 3 Flash via AG", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(3.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/gemini-3-flash-agent", displayName: "Gemini 3 Flash Agent", description: "Google Gemini 3 Flash optimized for agent workflows", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(3.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "ag/gemini-3.5-flash-low", displayName: "Gemini 3.5 Flash (Low)", description: "Google Gemini 3.5 Flash — low thinking budget", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(1.50), outputPricePerMtok: usd(9.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/gemini-3.5-flash-extra-low", displayName: "Gemini 3.5 Flash (Extra Low)", description: "Google Gemini 3.5 Flash — minimal thinking", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(1.50), outputPricePerMtok: usd(9.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/gemini-3.1-pro-low", displayName: "Gemini 3.1 Pro (Low)", description: "Google Gemini 3.1 Pro — low thinking budget", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(2.00), outputPricePerMtok: usd(12.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "ag/gemini-pro-agent", displayName: "Gemini Pro Agent", description: "Google Gemini Pro optimized for agent workflows", contextLength: 1_048_576, maxOutputTokens: 65_536, inputPricePerMtok: usd(2.00), outputPricePerMtok: usd(12.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "ag/gpt-oss-120b-medium", displayName: "GPT-OSS 120B Medium", description: "Open-source GPT 120B via AG — medium compute", contextLength: 128_000, maxOutputTokens: 16_384, inputPricePerMtok: usd(0.90), outputPricePerMtok: usd(0.90), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // glm/ — Zhipu AI GLM models
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "glm/glm-5.1", displayName: "GLM 5.1", description: "Zhipu AI GLM-5.1 — 744B MoE (40B active), 200K context, agentic coding", contextLength: 200_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(1.40), outputPricePerMtok: usd(4.40), inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "glm/glm-5", displayName: "GLM 5", description: "Zhipu AI GLM-5 — 744B MoE (40B active), 200K context", contextLength: 200_000, maxOutputTokens: 131_072, inputPricePerMtok: usd(1.00), outputPricePerMtok: usd(3.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "glm/glm-4.7", displayName: "GLM 4.7", description: "Zhipu AI GLM-4.7 — efficient chat model", contextLength: 128_000, maxOutputTokens: 32_768, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(1.60), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "structured_outputs"] },
  { modelId: "glm/glm-4.6v", displayName: "GLM 4.6V", description: "Zhipu AI GLM-4.6V — vision-language model", contextLength: 128_000, maxOutputTokens: 32_768, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(1.60), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["tools", "vision"] },
  { modelId: "glm-5.1", displayName: "GLM 5.1 (Qwen)", description: "GLM-5.1 via Qwen provider", contextLength: 200_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(1.40), outputPricePerMtok: usd(4.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // minimax/ — MiniMax models
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "minimax/MiniMax-M2.7", displayName: "MiniMax M2.7", description: "MiniMax M2.7 — self-improvement, coding, office productivity", contextLength: 204_800, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.30), outputPricePerMtok: usd(1.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "minimax/MiniMax-M2.5", displayName: "MiniMax M2.5", description: "MiniMax M2.5 — SOTA coding and agent, cost-effective", contextLength: 204_800, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.15), outputPricePerMtok: usd(1.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "minimax/MiniMax-M2.1", displayName: "MiniMax M2.1", description: "MiniMax M2.1 — multi-language programming", contextLength: 204_800, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.10), outputPricePerMtok: usd(0.55), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "structured_outputs"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // ollama/ — Self-hosted models (near-zero cost)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "ollama/qwen3.5", displayName: "Qwen 3.5 (Ollama)", description: "Self-hosted Qwen 3.5", contextLength: 262_144, inputPricePerMtok: usd(0.01), outputPricePerMtok: usd(0.01), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning"] },
  { modelId: "ollama/kimi-k2.5", displayName: "Kimi K2.5 (Ollama)", description: "Self-hosted Kimi K2.5", contextLength: 262_144, inputPricePerMtok: usd(0.01), outputPricePerMtok: usd(0.01), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning"] },
  { modelId: "ollama/glm-5", displayName: "GLM 5 (Ollama)", description: "Self-hosted GLM 5", contextLength: 200_000, inputPricePerMtok: usd(0.01), outputPricePerMtok: usd(0.01), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "ollama/minimax-m2.5", displayName: "MiniMax M2.5 (Ollama)", description: "Self-hosted MiniMax M2.5", contextLength: 204_800, inputPricePerMtok: usd(0.01), outputPricePerMtok: usd(0.01), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "ollama/gpt-oss:120b", displayName: "GPT-OSS 120B (Ollama)", description: "Self-hosted GPT-OSS 120B", contextLength: 128_000, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.05), inputModalities: ["text"], outputModalities: ["text"] },
  { modelId: "ollama/glm-4.7-flash", displayName: "GLM 4.7 Flash (Ollama)", description: "Self-hosted GLM 4.7 Flash", contextLength: 128_000, inputPricePerMtok: usd(0.01), outputPricePerMtok: usd(0.01), inputModalities: ["text"], outputModalities: ["text"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Xiaomi MiMo Series
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "mimo-v2.5-pro", displayName: "MiMo V2.5 Pro", description: "Xiaomi MiMo V2.5 Pro — 1.02T MoE (42B active), 1M context, agentic coding", contextLength: 1_000_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(0.435), outputPricePerMtok: usd(0.87), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["thinking", "function_call", "structured_output", "streaming"] },
  { modelId: "mimo-v2-pro", displayName: "MiMo V2 Pro", description: "Xiaomi MiMo V2 Pro — previous gen flagship, 1M context", contextLength: 1_000_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(0.435), outputPricePerMtok: usd(0.87), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["thinking", "function_call", "structured_output", "streaming"] },
  { modelId: "mimo-v2.5", displayName: "MiMo V2.5", description: "Xiaomi MiMo V2.5 — 310B MoE (15B active), multimodal, 1M context", contextLength: 1_000_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(0.22), outputPricePerMtok: usd(0.44), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text"], supportedFeatures: ["thinking", "function_call", "structured_output", "multimodal"] },
  { modelId: "mimo-v2-omni", displayName: "MiMo V2 Omni", description: "Xiaomi MiMo V2 Omni — multimodal, 256K context", contextLength: 256_000, maxOutputTokens: 128_000, inputPricePerMtok: usd(0.22), outputPricePerMtok: usd(0.44), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text"], supportedFeatures: ["multimodal", "streaming"] },
  { modelId: "mimo-v2.5-tts", displayName: "MiMo V2.5 TTS", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts"] },
  { modelId: "mimo-v2.5-tts-voiceclone", displayName: "MiMo V2.5 TTS Voice Clone", inputModalities: ["text", "audio"], outputModalities: ["audio"], supportedFeatures: ["tts", "voice_clone"] },
  { modelId: "mimo-v2.5-tts-voicedesign", displayName: "MiMo V2.5 TTS Voice Design", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts", "voice_design"] },
  { modelId: "mimo-v2-tts", displayName: "MiMo V2 TTS", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts"] },
  { modelId: "mimo-v2-flash", displayName: "MiMo V2 Flash", description: "Xiaomi MiMo V2 Flash — fast, 256K", contextLength: 256_000, maxOutputTokens: 64_000, inputPricePerMtok: usd(0.07), outputPricePerMtok: usd(0.14), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["thinking", "function_call", "streaming"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal / Custom Models
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "combogroupy", displayName: "Combo Groupy", description: "Internal combo model for Groupy", inputModalities: ["text"], outputModalities: ["text"] },
  { modelId: "ccai-pro", displayName: "CCAI Pro", description: "Alibaba Cloud Customer Contact AI", contextLength: 32_000, inputModalities: ["text"], outputModalities: ["text"] },
  { modelId: "tongyi-tingwu-slp", displayName: "Tongyi Tingwu SLP", description: "Alibaba speech/language processing", inputModalities: ["audio", "text"], outputModalities: ["text"], supportedFeatures: ["speech_processing"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Turbo / Max / Flash / Plus (legacy and current)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen-turbo", displayName: "Qwen Turbo", description: "Alibaba Qwen Turbo — fast, cost-effective", contextLength: 1_000_000, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "structured_outputs"] },
  { modelId: "qwen-max", displayName: "Qwen Max", description: "Alibaba Qwen Max — flagship (legacy)", contextLength: 262_144, maxOutputTokens: 32_768, inputPricePerMtok: usd(1.60), outputPricePerMtok: usd(6.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "qwen-flash", displayName: "Qwen Flash", description: "Alibaba Qwen Flash — latency-optimized", contextLength: 1_000_000, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.03), outputPricePerMtok: usd(0.10), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen-plus", displayName: "Qwen Plus", description: "Alibaba Qwen Plus — balanced performance/cost", contextLength: 1_000_000, maxOutputTokens: 32_768, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(0.56), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "structured_outputs"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Vision/VL models
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen-vl-max", displayName: "Qwen VL Max", description: "Alibaba Qwen Vision-Language Max", contextLength: 32_000, inputPricePerMtok: usd(1.60), outputPricePerMtok: usd(6.40), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["vision"] },
  { modelId: "qwen-vl-plus", displayName: "Qwen VL Plus", description: "Alibaba Qwen Vision-Language Plus", contextLength: 128_000, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(0.56), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["vision"] },
  { modelId: "qwen3-vl-plus", displayName: "Qwen3 VL Plus", description: "Qwen3 Vision-Language Plus — 256K context", contextLength: 256_000, inputPricePerMtok: usd(0.20), outputPricePerMtok: usd(1.60), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["tools", "vision", "reasoning"] },
  { modelId: "qwen3-vl-flash", displayName: "Qwen3 VL Flash", description: "Qwen3 Vision-Language Flash — fast", contextLength: 256_000, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.40), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["tools", "vision"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen 3.5 — Plus / Flash / Omni
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen3.5-plus", displayName: "Qwen 3.5 Plus", description: "Alibaba Qwen 3.5 Plus — balanced tier", contextLength: 262_144, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(3.00), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "qwen3.5-flash", displayName: "Qwen 3.5 Flash", description: "Alibaba Qwen 3.5 Flash — fast, 1M context", contextLength: 1_000_000, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.25), outputPricePerMtok: usd(1.50), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },
  { modelId: "qwen3.5-omni-flash", displayName: "Qwen 3.5 Omni Flash", description: "Qwen 3.5 Omni Flash — multimodal (audio/video/image/text)", contextLength: 256_000, inputPricePerMtok: usd(0.20), outputPricePerMtok: usd(1.00), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal", "tools"] },
  { modelId: "qwen3.5-omni-plus", displayName: "Qwen 3.5 Omni Plus", description: "Qwen 3.5 Omni Plus — multimodal, higher quality", contextLength: 256_000, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(3.00), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal", "tools", "reasoning"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen 3.7 — Plus / Max
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen3.7-plus", displayName: "Qwen 3.7 Plus", description: "Alibaba Qwen 3.7 Plus — new default tier", contextLength: 1_000_000, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.50), outputPricePerMtok: usd(3.00), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "qwen3.7-max-preview", displayName: "Qwen 3.7 Max Preview", description: "Qwen 3.7 Max Preview — flagship preview", contextLength: 1_000_000, maxOutputTokens: 65_536, inputPricePerMtok: usd(2.50), outputPricePerMtok: usd(7.50), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen 3 — Omni Flash
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen3-omni-flash", displayName: "Qwen3 Omni Flash", description: "Qwen3 Omni Flash — multimodal (audio/video/image/text)", contextLength: 256_000, inputPricePerMtok: usd(0.15), outputPricePerMtok: usd(0.60), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal"] },
  { modelId: "qwen3-max-preview", displayName: "Qwen3 Max Preview", description: "Qwen3 Max Preview", contextLength: 262_144, maxOutputTokens: 32_768, inputPricePerMtok: usd(1.20), outputPricePerMtok: usd(6.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "structured_outputs"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Reasoning models (QwQ, QvQ)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwq-plus", displayName: "QwQ Plus", description: "Qwen QwQ Plus — reasoning-focused model", contextLength: 131_072, maxOutputTokens: 33_000, inputPricePerMtok: usd(0.22), outputPricePerMtok: usd(0.56), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },
  { modelId: "qvq-max", displayName: "QvQ Max", description: "Qwen QvQ Max — visual question answering", contextLength: 131_072, inputPricePerMtok: usd(0.60), outputPricePerMtok: usd(2.40), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["vision", "reasoning"] },
  { modelId: "qwen-omni-turbo", displayName: "Qwen Omni Turbo", description: "Qwen Omni Turbo — multimodal, fast", contextLength: 256_000, inputPricePerMtok: usd(0.10), outputPricePerMtok: usd(0.40), inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text"], supportedFeatures: ["multimodal"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Machine Translation
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen-mt-turbo", displayName: "Qwen MT Turbo", description: "Machine Translation — fast", inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["translation"] },
  { modelId: "qwen-mt-lite", displayName: "Qwen MT Lite", description: "Machine Translation — lightweight", inputPricePerMtok: usd(0.03), outputPricePerMtok: usd(0.10), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["translation"] },
  { modelId: "qwen-mt-plus", displayName: "Qwen MT Plus", description: "Machine Translation — higher quality", inputPricePerMtok: usd(0.10), outputPricePerMtok: usd(0.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["translation"] },
  { modelId: "qwen-mt-flash", displayName: "Qwen MT Flash", description: "Machine Translation — fastest", inputPricePerMtok: usd(0.03), outputPricePerMtok: usd(0.10), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["translation"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Character / Coder / Other
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen-flash-character", displayName: "Qwen Flash Character", description: "Character roleplay — flash tier", contextLength: 131_072, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["character_roleplay"] },
  { modelId: "qwen-plus-character", displayName: "Qwen Plus Character", description: "Character roleplay — plus tier", contextLength: 131_072, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(0.56), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["character_roleplay"] },
  { modelId: "qwen-coder-plus", displayName: "Qwen Coder Plus", description: "Specialized coding model", contextLength: 131_072, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(0.56), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["coding", "function_call"] },
  { modelId: "qwen3-coder-480b-a35b-instruct", displayName: "Qwen3 Coder 480B A35B Instruct", description: "Open-source 480B MoE coding model (35B active), 262K context", contextLength: 262_144, maxOutputTokens: 262_144, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(1.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "coding", "structured_outputs"] },
  { modelId: "qwen3-235b-a22b-instruct-2507", displayName: "Qwen3 235B A22B Instruct 2507", description: "235B MoE instruct model (22B active), 262K context", contextLength: 262_144, maxOutputTokens: 262_144, inputPricePerMtok: usd(0.455), outputPricePerMtok: usd(1.82), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Kimi
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "kimi-k2.6", displayName: "Kimi K2.6", description: "Moonshot Kimi K2.6 — 262K context", contextLength: 262_144, maxOutputTokens: 65_536, inputPricePerMtok: usd(0.74), outputPricePerMtok: usd(3.50), inputModalities: ["text", "image", "video"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning", "structured_outputs", "vision"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Non-chat model types (correct modalities)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen-image-2.0-pro", displayName: "Qwen Image 2.0 Pro", description: "Image generation — professional quality", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "qwen-image-2.0", displayName: "Qwen Image 2.0", description: "Image generation — standard", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "qwen-image-max", displayName: "Qwen Image Max", description: "Image generation — max quality", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "qwen-image-plus", displayName: "Qwen Image Plus", description: "Image generation — plus tier", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "qwen-image-edit", displayName: "Qwen Image Edit", description: "Image editing", inputModalities: ["text", "image"], outputModalities: ["image"], supportedFeatures: ["image_editing"] },
  { modelId: "qwen-image-edit-plus", displayName: "Qwen Image Edit Plus", description: "Image editing — plus tier", inputModalities: ["text", "image"], outputModalities: ["image"], supportedFeatures: ["image_editing"] },
  { modelId: "qwen-image-edit-max", displayName: "Qwen Image Edit Max", description: "Image editing — max tier", inputModalities: ["text", "image"], outputModalities: ["image"], supportedFeatures: ["image_editing"] },
  { modelId: "z-image-turbo", displayName: "Z Image Turbo", description: "Fast image generation", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "wan2.7-image-pro", displayName: "Wan 2.7 Image Pro", description: "Wan image generation — pro", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "wan2.7-image", displayName: "Wan 2.7 Image", description: "Wan image generation", inputModalities: ["text"], outputModalities: ["image"], supportedFeatures: ["image_generation"] },
  { modelId: "text-embedding-v3", displayName: "Text Embedding V3", description: "Text embedding model v3", inputModalities: ["text"], outputModalities: ["embedding"], supportedFeatures: ["embedding"] },
  { modelId: "text-embedding-v4", displayName: "Text Embedding V4", description: "Text embedding model v4", inputModalities: ["text"], outputModalities: ["embedding"], supportedFeatures: ["embedding"] },
  { modelId: "qwen3-tts-flash", displayName: "Qwen3 TTS Flash", description: "Text-to-Speech — flash", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts"] },
  { modelId: "qwen3-tts-instruct-flash", displayName: "Qwen3 TTS Instruct Flash", description: "Instructable TTS", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts"] },
  { modelId: "qwen3-tts-vd", displayName: "Qwen3 TTS VD", description: "TTS voice design", inputModalities: ["text"], outputModalities: ["audio"], supportedFeatures: ["tts", "voice_design"] },
  { modelId: "qwen3-tts-vc", displayName: "Qwen3 TTS VC", description: "TTS voice cloning", inputModalities: ["text", "audio"], outputModalities: ["audio"], supportedFeatures: ["tts", "voice_clone"] },
  { modelId: "qwen3-asr-flash", displayName: "Qwen3 ASR Flash", description: "Automatic speech recognition", inputModalities: ["audio"], outputModalities: ["text"], supportedFeatures: ["speech_recognition"] },
  { modelId: "qwen3-livetranslate-flash", displayName: "Qwen3 Live Translate", description: "Live translation (audio-to-audio)", inputModalities: ["audio"], outputModalities: ["audio"], supportedFeatures: ["translation", "realtime"] },
  { modelId: "qwen3-s2s-flash-realtime", displayName: "Qwen3 S2S Flash", description: "Speech-to-speech realtime", inputModalities: ["audio"], outputModalities: ["audio"], supportedFeatures: ["speech_to_speech", "realtime"] },
  { modelId: "qwen3-omni-30b-a3b-captioner", displayName: "Qwen3 Omni Captioner", description: "Image/video captioning model", inputModalities: ["image", "video"], outputModalities: ["text"], supportedFeatures: ["captioning"] },
  { modelId: "qwen-vl-ocr", displayName: "Qwen VL OCR", description: "OCR for documents, tables, handwriting", inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["ocr", "vision"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen — Omni realtime variants (prefix match will catch dated versions)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen3.5-omni-flash-realtime", displayName: "Qwen 3.5 Omni Flash RT", description: "Omni flash realtime streaming", contextLength: 256_000, inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal", "realtime"] },
  { modelId: "qwen3.5-omni-plus-realtime", displayName: "Qwen 3.5 Omni Plus RT", description: "Omni plus realtime streaming", contextLength: 256_000, inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal", "realtime"] },
  { modelId: "qwen3-omni-flash-realtime", displayName: "Qwen3 Omni Flash RT", description: "Qwen3 omni flash realtime", contextLength: 256_000, inputModalities: ["text", "image", "audio", "video"], outputModalities: ["text", "audio"], supportedFeatures: ["multimodal", "realtime"] },
  { modelId: "qwen3.5-livetranslate-flash-realtime", displayName: "Qwen 3.5 Live Translate RT", description: "Live translate realtime", inputModalities: ["audio"], outputModalities: ["audio"], supportedFeatures: ["translation", "realtime"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // Qwen2.5 legacy (via OpenRouter should match, but fallback just in case)
  // ═══════════════════════════════════════════════════════════════════════════
  { modelId: "qwen2.5-7b-instruct", displayName: "Qwen 2.5 7B Instruct", contextLength: 131_072, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen2.5-14b-instruct", displayName: "Qwen 2.5 14B Instruct", contextLength: 131_072, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.10), outputPricePerMtok: usd(0.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen2.5-32b-instruct", displayName: "Qwen 2.5 32B Instruct", contextLength: 131_072, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.20), outputPricePerMtok: usd(0.80), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen2.5-72b-instruct", displayName: "Qwen 2.5 72B Instruct", contextLength: 131_072, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.28), outputPricePerMtok: usd(1.12), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools", "reasoning"] },
  { modelId: "qwen2.5-7b-instruct-1m", displayName: "Qwen 2.5 7B Instruct 1M", contextLength: 1_000_000, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen2.5-14b-instruct-1m", displayName: "Qwen 2.5 14B Instruct 1M", contextLength: 1_000_000, maxOutputTokens: 8_192, inputPricePerMtok: usd(0.10), outputPricePerMtok: usd(0.40), inputModalities: ["text"], outputModalities: ["text"], supportedFeatures: ["tools"] },
  { modelId: "qwen2.5-vl-32b-instruct", displayName: "Qwen 2.5 VL 32B", contextLength: 131_072, inputPricePerMtok: usd(0.20), outputPricePerMtok: usd(0.80), inputModalities: ["text", "image"], outputModalities: ["text"], supportedFeatures: ["vision", "tools"] },
  { modelId: "qwen2-7b-instruct", displayName: "Qwen 2 7B Instruct", contextLength: 32_768, inputPricePerMtok: usd(0.05), outputPricePerMtok: usd(0.20), inputModalities: ["text"], outputModalities: ["text"] },
];

/**
 * Look up fallback metadata by model ID.
 * Tries exact match first, then prefix match (for versioned IDs like qwen3-max-2026-01-23).
 */
export function getFallbackMetadata(modelId: string): FallbackMetadata | undefined {
  const exact = FALLBACK_METADATA.find(m => m.modelId === modelId);
  if (exact) return exact;

  // Prefix match: "qwen-mt-turbo-2025-04-28" → match "qwen-mt-turbo"
  for (const fb of FALLBACK_METADATA) {
    if (modelId.startsWith(fb.modelId + "-") || modelId.startsWith(fb.modelId + "_")) {
      return fb;
    }
  }

  return undefined;
}
