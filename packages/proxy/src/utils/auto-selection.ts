/**
 * Auto-model selection.
 *
 * The virtual `auto` model used to be "whatever is online, lowest latency
 * first". That quietly routed traffic to expensive reasoning models (gpt-6-astra
 * at 25x, claude-opus-5.5 at 8.3x) because latency was the only signal, and it
 * never considered whether the model could even accept an image.
 *
 * Policy now, in three tiers:
 *
 *  1. **Hard exclusions** — never auto: anything above `AUTO_MAX_MULTIPLIER`
 *     unless the pool would otherwise be empty. This is what stops one user's
 *     `auto` call from burning 25x quota on a whim.
 *  2. **Vision** — a request carrying an image may only go to a model whose
 *     catalog row declares `image` in `input_modalities`. A text-only request
 *     may go to anything.
 *  3. **Ordering** — cheapest first, then fastest. Cost leads because `auto` is
 *     the default model for most users; latency decides ties and is the only
 *     signal left inside a price band.
 *
 * Every filter is best-effort: if catalog metadata is missing the model is
 * treated as text-only and expensive, which fails safe (it simply is not
 * chosen) rather than routing an image to a model that cannot read it.
 */

import { resolveAmanaiMultipliers } from "./amanai-credits.js";

/** Above this input multiplier a model is last-resort for `auto`. */
export const AUTO_MAX_MULTIPLIER = 6;

/** Models at or below this are preferred outright when one is available. */
export const AUTO_CHEAP_MULTIPLIER = 3;

export interface AutoCandidate {
  modelId: string;
  provider: string;
  latencyMs: number;
  baseUrl: string;
}

export interface AutoCatalogMeta {
  /** Input cost relative to the cheapest model, e.g. 4.7 for glm-5.3. */
  multiplier: number | null;
  /** Declared input modalities from the catalog, e.g. ["text","image"]. */
  inputModalities: string[];
}

export interface AutoPickOptions {
  /** True when the request body contains an image part. */
  needsVision: boolean;
  /** Look up catalog metadata for a `provider/model` string. */
  metaFor: (providerModel: string) => AutoCatalogMeta | null;
  /** Cap applied to the cheap tier; models above it are fallbacks only. */
  maxMultiplier?: number;
  cheapMultiplier?: number;
}

export interface RankedAutoCandidate extends AutoCandidate {
  multiplier: number;
  vision: boolean;
}

/**
 * Build the catalog metadata index that `rankAutoCandidates` consults.
 *
 * Both auto paths (primary and last-resort fallback) used to build this inline
 * and both keyed it by catalogue id only — `phantom/vibecode/glm-5.3`. The
 * candidates arriving from the monitor are keyed by *upstream* id —
 * `phantom/amanai/glm-5.3` — because `model_monitor.model_id` stores the raw
 * provider id while the client catalogue publishes the aliased vendor name.
 * Every lookup therefore missed, every multiplier became `Infinity`, and the
 * cost ordering silently degraded back to catalog order.
 *
 * The fix is to index each catalogue row under every id a candidate can arrive
 * as: the catalogue id, the raw `provider/model` form, and the aliased form.
 */
export async function buildAutoMetaIndex(): Promise<
  Map<string, AutoCatalogMeta>
> {
  const index = new Map<string, AutoCatalogMeta>();
  try {
    const { getModelCatalogResponse } = await import("./model-catalog.js");
    const {
      loadVendorAliasIndex,
      getAliasesForProviderName,
      toRealUpstreamIdCandidates,
    } = await import("./vendor-aliases.js");

    const [cat, aliasIndex] = await Promise.all([
      getModelCatalogResponse(),
      loadVendorAliasIndex().catch(() => null),
    ]);

    for (const m of (cat?.data || []) as any[]) {
      const id = String(m?.id || "");
      if (!id) continue;
      const rates = resolveAmanaiMultipliers(id);
      const meta: AutoCatalogMeta = {
        multiplier: rates ? rates.mIn : null,
        inputModalities: Array.isArray(m?.input_modalities) ? m.input_modalities : [],
      };

      const keys = new Set<string>([id]);

      // `provider/vendor/model` → also index every raw vendor the published
      // one can alias to.
      //
      // Two details matter here and both were wrong at first:
      //  - aliases are stored per PROVIDER (`providers.vendor_aliases` holds
      //    `{"amanai":"vibecode"}` for phantom), so the lookup key is `phantom`,
      //    not the vendor+leaf segment;
      //  - `toRealUpstreamIdCandidates` returns every raw vendor a published
      //    one can mean, which is what the monitor-keyed lookup needs —
      //    `model_monitor` stores `amanai` while the catalogue publishes
      //    `vibecode`.
      const slash = id.indexOf("/");
      if (slash > 0) {
        const provider = id.slice(0, slash);
        const rest = id.slice(slash + 1);
        keys.add(`${provider}/${rest}`);
        if (aliasIndex) {
          const aliases = getAliasesForProviderName(aliasIndex, provider);
          for (const real of toRealUpstreamIdCandidates(rest, aliases)) {
            if (real && real !== rest) keys.add(`${provider}/${real}`);
          }
        }
      }

      for (const k of keys) {
        if (!index.has(k)) index.set(k, meta);
      }
    }
  } catch {
    // No catalogue metadata: ranking still runs, but everything reads as
    // text-only / cost-unknown, which fails safe (vision requests error out
    // instead of reaching a model that cannot read the image).
  }
  return index;
}

/** Detect an image anywhere in an OpenAI- or Anthropic-shaped request body. */
export function requestHasImage(body: any): boolean {
  if (!body) return false;
  const scanParts = (parts: any[]): boolean =>
    parts.some((p) => {
      if (!p || typeof p !== "object") return false;
      if (p.type === "image_url" || p.type === "input_image") return true;
      if (p.type === "image") return true;
      if (p.image_url) return true;
      if (p.source?.type === "base64" || p.source?.type === "url") {
        return String(p.source?.media_type || "").startsWith("image/");
      }
      if (p.inlineData?.mimeType?.startsWith?.("image/")) return true;
      if (p.inline_data?.mime_type?.startsWith?.("image/")) return true;
      return false;
    });

  const scanContent = (content: any): boolean => {
    if (!content) return false;
    if (Array.isArray(content)) return scanParts(content);
    if (typeof content === "object") return scanParts([content]);
    return false;
  };

  const messages = body.messages || body.contents || [];
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (m?.content && scanContent(m.content)) return true;
      if (m?.parts && scanParts(m.parts)) return true;
    }
  }
  // Gemini-shaped inline data can also sit at the top level of a part list.
  if (Array.isArray(body.parts) && scanParts(body.parts)) return true;
  return false;
}

/**
 * Order the auto pool. Returns candidates best-first; the caller walks the list
 * and falls through on failure, so a cheap model that 500s still ends up trying
 * something rather than erroring out.
 */
export function rankAutoCandidates(
  models: AutoCandidate[],
  opts: AutoPickOptions,
): RankedAutoCandidate[] {
  const maxMult = opts.maxMultiplier ?? AUTO_MAX_MULTIPLIER;
  const cheapMult = opts.cheapMultiplier ?? AUTO_CHEAP_MULTIPLIER;

  const enriched: RankedAutoCandidate[] = models.map((m) => {
    const providerModel = `${m.provider}/${m.modelId}`;
    const meta = opts.metaFor(providerModel);
    // `resolveAmanaiMultipliers` is the billing meter's own table. Fall back to
    // it when the catalog row is missing so cost still has a usable number.
    const fromMeter = resolveAmanaiMultipliers(providerModel);
    const mult =
      meta?.multiplier ?? (fromMeter ? fromMeter.mIn : null) ?? Number.POSITIVE_INFINITY;
    const mods = meta?.inputModalities || [];
    return {
      ...m,
      multiplier: mult,
      vision: mods.includes("image"),
    };
  });

  // A vision request can only go to a vision model. If nothing qualifies we
  // return an empty list and the caller reports a clear error, rather than
  // silently sending an image to a text-only model.
  const visionOk = opts.needsVision ? enriched.filter((m) => m.vision) : enriched;

  const byCost = (a: RankedAutoCandidate, b: RankedAutoCandidate) => {
    // Cheapest first; then fastest; then stable by id so the pick is
    // deterministic across identical requests.
    if (a.multiplier !== b.multiplier) return a.multiplier - b.multiplier;
    const la = a.latencyMs ?? Number.POSITIVE_INFINITY;
    const lb = b.latencyMs ?? Number.POSITIVE_INFINITY;
    if (la !== lb) return la - lb;
    return a.modelId.localeCompare(b.modelId);
  };

  const cheap = visionOk.filter((m) => m.multiplier <= cheapMult).sort(byCost);
  const mid = visionOk
    .filter((m) => m.multiplier > cheapMult && m.multiplier <= maxMult)
    .sort(byCost);
  const expensive = visionOk.filter((m) => m.multiplier > maxMult).sort(byCost);

  // Cheap tier leads. Mid tier exists so a request still succeeds when the
  // cheap models are all failing. Expensive models are only reached when
  // nothing else is available — that is the "boleh mahal tapi jangan sering".
  return [...cheap, ...mid, ...expensive];
}
