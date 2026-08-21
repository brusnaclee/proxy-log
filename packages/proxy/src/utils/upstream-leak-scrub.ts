/**
 * Scrub upstream leaks from response bodies / errors before they reach clients.
 * Targets: amanai-style footers, upstream base URLs, provider API keys, Bearer tokens.
 * Safe for SSE: optional hold-back so footers split across chunks still get caught.
 */

import { sanitizeProviderApiKey } from "./crypto.js";

const REDACT_KEY = "";
const REDACT_URL = "";
const REDACT_FOOTER = "";

/** Exact secrets (provider keys) — longest first. */
let exactSecrets: string[] = [];
/** Upstream hostnames e.g. api.amanai.dev */
let upstreamHosts: string[] = [];

const DEFAULT_HOST_PATTERNS = ["amanai.dev"];

/** Footer / branding injects seen from some gateways. */
const FOOTER_RES: RegExp[] = [
  /this\s+response\s+was\s+delivered\s+by\s+(?:ai\.)?amanai(?:\.dev)?[.!]?\s*/gi,
  /(?:^|\n)\s*(?:delivered|powered)\s+by\s+(?:ai\.)?amanai[^\n]{0,240}/gi,
  /\bamana[ií]\s*(?:gateway|proxy|edge)?\s*(?:base\s*url|api\s*key|endpoint)\s*[:=]\s*[^\n]{0,200}/gi,
];

/** Generic secret-looking tokens in model output / errors. */
const SK_RE = /\b(?:sk-[A-Za-z0-9_\-]{8,}|sk-ant-[A-Za-z0-9_\-]{8,}|sk-or-[A-Za-z0-9_\-]{8,})\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9_\-./+=]{8,}/gi;
const AMANAI_URL_RE = /https?:\/\/(?:[\w.-]+\.)?amanai\.dev[^\s"'`<>)\\]]*/gi;

export function registerUpstreamSecret(raw: string | null | undefined): void {
  const key = sanitizeProviderApiKey(String(raw || ""));
  if (key.length < 8) return;
  if (!exactSecrets.includes(key)) {
    exactSecrets = [...exactSecrets, key].sort((a, b) => b.length - a.length);
  }
}

export function registerUpstreamHost(hostOrUrl: string | null | undefined): void {
  const raw = String(hostOrUrl || "").trim();
  if (!raw) return;
  let host = raw;
  try {
    if (/^https?:\/\//i.test(raw)) host = new URL(raw).hostname;
    else if (raw.includes("/")) host = raw.split("/")[0].replace(/:\d+$/, "");
  } catch {
    host = raw.replace(/^https?:\/\//i, "").split("/")[0];
  }
  host = host.toLowerCase().replace(/^\.+/, "");
  if (host.length < 4) return;
  if (!upstreamHosts.includes(host)) {
    upstreamHosts = [...upstreamHosts, host];
  }
}

export function getUpstreamScrubStats(): { secrets: number; hosts: number } {
  return { secrets: exactSecrets.length, hosts: upstreamHosts.length };
}

/** Test helper — replace scrub secret set. */
export function _resetUpstreamScrubForTests(opts?: {
  secrets?: string[];
  hosts?: string[];
}): void {
  exactSecrets = (opts?.secrets || []).map(sanitizeProviderApiKey).filter((k) => k.length >= 8);
  exactSecrets.sort((a, b) => b.length - a.length);
  upstreamHosts = (opts?.hosts || []).map((h) => h.toLowerCase());
}

export async function refreshUpstreamScrubSecretsFromDb(): Promise<void> {
  try {
    const { db } = await import("../db/index.js");
    const { providerApiKeys, providers } = await import("../db/schema.js");
    const [keyRows, provRows] = await Promise.all([
      db.select({ apiKey: providerApiKeys.apiKey }).from(providerApiKeys),
      db
        .select({
          endpoint: providers.endpoint,
          name: providers.name,
          apiKey: providers.apiKey,
        })
        .from(providers),
    ]);

    const nextSecrets: string[] = [];
    for (const r of keyRows) {
      const k = sanitizeProviderApiKey(r.apiKey);
      if (k.length >= 8) nextSecrets.push(k);
    }
    for (const p of provRows) {
      const k = sanitizeProviderApiKey(p.apiKey);
      if (k.length >= 8) nextSecrets.push(k);
    }
    exactSecrets = [...new Set(nextSecrets)].sort((a, b) => b.length - a.length);

    const nextHosts = new Set<string>(DEFAULT_HOST_PATTERNS);
    for (const p of provRows) {
      if (p.endpoint) {
        try {
          const u = new URL(
            p.endpoint.includes("://") ? p.endpoint : `https://${p.endpoint}`,
          );
          if (u.hostname) nextHosts.add(u.hostname.toLowerCase());
        } catch {
          /* ignore */
        }
      }
      if (/amanai/i.test(String(p.name || ""))) nextHosts.add("amanai.dev");
    }
    upstreamHosts = [...nextHosts];
  } catch (err) {
    console.warn(
      "[upstream-leak-scrub] refresh failed:",
      (err as Error)?.message || err,
    );
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrubExactSecrets(text: string): string {
  let out = text;
  for (const secret of exactSecrets) {
    if (!secret || secret.length < 8) continue;
    if (!out.includes(secret)) continue;
    out = out.split(secret).join(REDACT_KEY);
  }
  return out;
}

function scrubHostUrls(text: string): string {
  let out = text;
  out = out.replace(AMANAI_URL_RE, REDACT_URL);
  for (const host of upstreamHosts) {
    if (!host || host.length < 4) continue;
    // Full URLs containing this host
    const urlRe = new RegExp(
      `https?:\\/\\/(?:[\\w.-]+\\.)?${escapeRegExp(host)}[^\\s"'\\\`<>)\\\\]]*`,
      "gi",
    );
    out = out.replace(urlRe, REDACT_URL);
  }
  // Bare amanai hosts (no scheme) — avoid touching model ids like phantom/amanai/gpt-5.5
  out = out.replace(
    /(?:^|[\s"'=:（(])((?:[\w-]+\.)?amanai\.dev(?:\/[^\s"'`<>)）]*)?)/gi,
    (m, hostPart: string) => {
      if (m.length > hostPart.length) {
        return m.slice(0, m.length - hostPart.length) + REDACT_URL;
      }
      return REDACT_URL;
    },
  );
  return out;
}

function scrubFooters(text: string): string {
  let out = text;
  for (const re of FOOTER_RES) {
    out = out.replace(re, REDACT_FOOTER);
  }
  return out;
}

/**
 * Scrub a plain string (response text, error message, log preview).
 * Idempotent and safe on empty input.
 */
export function scrubUpstreamLeakText(text: string | null | undefined): string {
  if (text == null || text === "") return text == null ? "" : text;
  let out = String(text);
  out = scrubExactSecrets(out);
  out = scrubFooters(out);
  out = scrubHostUrls(out);
  out = out.replace(SK_RE, REDACT_KEY);
  out = out.replace(BEARER_RE, REDACT_KEY);
  // SECURITY INVARIANT: apart from the exact sensitive spans above, preserve
  // every byte. This function also runs on individual SSE delta fragments.
  // trimStart()/whitespace collapsing here turns streamed `" backend"` into
  // `"backend"`, corrupts shell commands (`ls backend` → `lsbackend`), joins
  // path components, and destroys indentation even when Token Saver is off.
  return out;
}

function scrubStringFieldsDeep(value: unknown, depth: number): unknown {
  if (depth > 12 || value == null) return value;
  if (typeof value === "string") return scrubUpstreamLeakText(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubStringFieldsDeep(value[i], depth + 1);
    }
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      // Skip huge binary-ish / non-content fields
      if (k === "logprobs" || k === "usage") continue;
      obj[k] = scrubStringFieldsDeep(obj[k], depth + 1);
    }
    return value;
  }
  return value;
}

/** Deep-scrub string fields in a parsed JSON payload (mutates + returns). */
export function scrubUpstreamLeakJson<T>(payload: T): T {
  if (payload == null) return payload;
  return scrubStringFieldsDeep(payload, 0) as T;
}

/**
 * Hold back trailing chars so multi-chunk footers / keys still get scrubbed.
 * Always scrubs the full buffer before emitting a stable prefix.
 */
export class StreamHoldbackScrubber {
  private buf = "";
  constructor(private readonly holdChars = 360) {}

  pending(): number {
    return this.buf.length;
  }

  push(chunk: string): string {
    if (!chunk) return "";
    this.buf += chunk;
    const scrubbed = scrubUpstreamLeakText(this.buf);
    if (scrubbed.length <= this.holdChars) {
      // Keep scrubbed form so partial sk-/URLs already caught stay redacted.
      this.buf = scrubbed;
      return "";
    }
    const emit = scrubbed.slice(0, scrubbed.length - this.holdChars);
    this.buf = scrubbed.slice(-this.holdChars);
    return emit;
  }

  flush(): string {
    const out = scrubUpstreamLeakText(this.buf);
    this.buf = "";
    return out;
  }

  pending(): number {
    return this.buf.length;
  }
}

/**
 * Some upstreams (amanai opus stream) emit finish_reason:stop (+ usage) before the
 * final content delta. Clients like Cursor stop when they see usage/finish and show
 * empty. Strip finish+usage for the wire, then emit a finish chunk right before [DONE].
 */
export class StreamFinishDeferral {
  private finishReason: string | null = null;
  private usage: unknown = undefined;
  private meta: { id?: string; model?: string; created?: number } = {};

  deferFromChunk(data: any): void {
    const choice = data?.choices?.[0];
    if (!choice?.finish_reason) return;
    this.finishReason = String(choice.finish_reason);
    if (data.usage != null) this.usage = data.usage;
    if (typeof data.id === "string") this.meta.id = data.id;
    if (typeof data.model === "string") this.meta.model = data.model;
    if (typeof data.created === "number") this.meta.created = data.created;
    choice.finish_reason = null;
    // Mid-stream usage is treated as "stream complete" by Cursor / some OpenAI SDKs.
    if (data.usage != null) delete data.usage;
  }

  hasDeferred(): boolean {
    return this.finishReason != null;
  }

  /** True when chunk has nothing left to show after finish/usage were stripped. */
  static isWireNoopChunk(data: any): boolean {
    if (!data || typeof data !== "object") return true;
    if (data.usage != null) return false;
    const choice = data?.choices?.[0];
    if (!choice) return true;
    if (choice.finish_reason) return false;
    const d = choice.delta;
    if (!d || typeof d !== "object") return true;
    if (typeof d.role === "string" && d.role) return false;
    if (typeof d.content === "string" && d.content.length > 0) return false;
    if (typeof d.reasoning_content === "string" && d.reasoning_content) return false;
    if (typeof d.reasoning === "string" && d.reasoning) return false;
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return false;
    return true;
  }

  /** SSE data line including trailing newlines, or null. */
  buildFinishSseLine(lastChunk: any | null): string | null {
    if (!this.finishReason) return null;
    const id =
      this.meta.id ||
      (lastChunk && typeof lastChunk.id === "string" && lastChunk.id) ||
      `chatcmpl-finish-${Date.now()}`;
    const model =
      this.meta.model ||
      (lastChunk && typeof lastChunk.model === "string" && lastChunk.model) ||
      undefined;
    const payload: any = {
      id,
      object: "chat.completion.chunk",
      created:
        this.meta.created ||
        (lastChunk && typeof lastChunk.created === "number"
          ? lastChunk.created
          : Math.floor(Date.now() / 1000)),
      choices: [{ index: 0, delta: {}, finish_reason: this.finishReason }],
    };
    if (model) payload.model = model;
    if (this.usage != null) payload.usage = this.usage;
    this.finishReason = null;
    this.usage = undefined;
    return `data: ${JSON.stringify(payload)}\n\n`;
  }
}

/**
 * Apply holdback to OpenAI chat.completion.chunk delta.content; scrub rest of payload.
 * On finish_reason, flush pending holdback into this same chunk.
 * After StreamFinishDeferral captured a premature finish, bypass holdback so late
 * content is emitted immediately (before the client gives up).
 */
export function scrubOpenAiStreamChunk(
  data: any,
  holdback: StreamHoldbackScrubber | null,
  finishDeferral?: StreamFinishDeferral | null,
): any {
  if (!data || typeof data !== "object") return data;
  const choice = data?.choices?.[0];
  if (!choice || typeof choice !== "object") {
    return scrubUpstreamLeakJson(data);
  }
  if (!choice.delta || typeof choice.delta !== "object") {
    choice.delta = {};
  }
  const delta = choice.delta;
  if (holdback && typeof delta.content === "string" && delta.content.length > 0) {
    if (finishDeferral?.hasDeferred()) {
      const pending = holdback.flush();
      delta.content = `${pending}${delta.content}`;
    } else {
      delta.content = holdback.push(delta.content);
    }
  }
  // Short replies stay in holdback until flush; if finish arrives first, release now.
  if (holdback && choice.finish_reason) {
    const pending = holdback.flush();
    if (pending) {
      delta.content = `${typeof delta.content === "string" ? delta.content : ""}${pending}`;
    }
  }
  return scrubUpstreamLeakJson(data);
}

export function buildOpenAiContentFlushChunk(
  lastChunk: any,
  text: string,
): string | null {
  if (!text) return null;
  const id =
    (lastChunk && typeof lastChunk.id === "string" && lastChunk.id) ||
    `chatcmpl-scrub-${Date.now()}`;
  const model =
    (lastChunk && typeof lastChunk.model === "string" && lastChunk.model) || undefined;
  const payload: any = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  if (model) payload.model = model;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Scrub Anthropic SSE event JSON (content_block_delta text, etc.). */
export function scrubAnthropicStreamEventData(
  data: any,
  holdback: StreamHoldbackScrubber | null,
): any {
  if (!data || typeof data !== "object") return data;
  if (
    holdback &&
    data.type === "content_block_delta" &&
    data.delta &&
    typeof data.delta.text === "string"
  ) {
    data.delta.text = holdback.push(data.delta.text);
  }
  return scrubUpstreamLeakJson(data);
}
