/**
 * Repetition guard for streamed completions.
 *
 * Why this exists: reasoning-capable models occasionally degenerate into a loop
 * ("Now. Let me write. OK. Writing." repeated hundreds of times) when the
 * context is large and `max_tokens` is generous. The upstream happily bills the
 * whole budget, the client shows an endless wall of the same phrases, and the
 * user's quota is gone. Observed on deepseek-v4-flash-0731: one hop produced
 * 32,000 output tokens of the same four short sentences.
 *
 * The guard watches the accumulated *visible* text (not reasoning — reasoning is
 * legitimately repetitive) and reports when the tail is a repeating cycle. The
 * caller decides what to do: stop forwarding, close the stream early, and log a
 * warning so the user is not billed for the rest.
 *
 * Design notes:
 *  - Cheap: only runs every `checkEveryChars` newly accumulated characters.
 *  - Conservative: needs `minRepeats` full cycles of a cycle whose length is
 *    within [minCycleChars, maxCycleChars]. Normal prose never matches.
 *  - Stateless per request: caller owns the accumulator.
 */

export type LoopGuardOptions = {
  /** Minimum cycle length in characters. Short cycles like "OK.\n" are noise. */
  minCycleChars?: number;
  /** Maximum cycle length in characters. */
  maxCycleChars?: number;
  /** How many times the cycle must repeat before we call it a loop. */
  minRepeats?: number;
  /** Only re-check after this many newly accumulated characters. */
  checkEveryChars?: number;
  /** Do not run at all until the text is at least this long. */
  minTotalChars?: number;
  /**
   * A cycle carrying at least this many distinct words is treated as real
   * content rather than degeneration. A markdown table repeated verbatim has
   * many distinct words (column names, values); a model loop has a handful
   * ("Now", "Let", "me", "write", "OK", "Writing").
   */
  maxDistinctWordsInCycle?: number;
};

export type LoopGuardVerdict = {
  looping: boolean;
  /** The repeating unit, when a loop was detected. */
  cycle?: string;
  /** How many times the cycle repeated in the tail. */
  repeats?: number;
};

const DEFAULTS: Required<LoopGuardOptions> = {
  minCycleChars: 8,
  maxCycleChars: 400,
  minRepeats: 12,
  checkEveryChars: 400,
  minTotalChars: 2000,
  maxDistinctWordsInCycle: 10,
};

/** Distinct lowercase words in a string. */
function distinctWordCount(s: string): number {
  const words = s.toLowerCase().match(/[a-z0-9_.-]+/g) || [];
  return new Set(words).size;
}

/**
 * Detect a repeating cycle in the tail of `text`.
 *
 * Returns `{ looping: false }` for normal prose, code, markdown tables, and
 * anything shorter than `minTotalChars`.
 */
export function detectRepetitionLoop(
  text: string,
  opts?: LoopGuardOptions,
): LoopGuardVerdict {
  const o = { ...DEFAULTS, ...(opts || {}) };
  if (!text || text.length < o.minTotalChars) return { looping: false };

  // Only inspect the tail — a loop that already scrolled past is not actionable.
  const window = Math.min(text.length, o.maxCycleChars * (o.minRepeats + 2));
  const tail = text.slice(-window);

  for (let len = o.minCycleChars; len <= o.maxCycleChars; len++) {
    const need = len * o.minRepeats;
    if (tail.length < need) break;

    const cycle = tail.slice(-len);
    // A cycle of pure whitespace or a single repeated character is not a model
    // loop — it is formatting. Skip those.
    if (!cycle.trim()) continue;
    if (new Set(cycle).size <= 1) continue;
    // A cycle with many distinct words is real content that happens to repeat
    // (a markdown table, a config block), not model degeneration.
    if (distinctWordCount(cycle) > o.maxDistinctWordsInCycle) continue;

    let repeats = 0;
    let cursor = tail.length;
    while (cursor - len >= 0 && tail.slice(cursor - len, cursor) === cycle) {
      repeats++;
      cursor -= len;
      if (repeats >= o.minRepeats + 2) break;
    }
    if (repeats >= o.minRepeats) {
      return { looping: true, cycle, repeats };
    }
  }

  return { looping: false };
}

/**
 * Accumulates visible stream text and throttles `detectRepetitionLoop` so the
 * hot path stays cheap.
 */
export class StreamLoopGuard {
  private text = '';
  private sinceCheck = 0;
  private tripped = false;
  private readonly opts: Required<LoopGuardOptions>;

  constructor(opts?: LoopGuardOptions) {
    this.opts = { ...DEFAULTS, ...(opts || {}) };
  }

  /** Feed a visible-content delta. Returns a verdict only when a check ran. */
  push(delta: string): LoopGuardVerdict | null {
    if (this.tripped || !delta) return null;
    this.text += delta;
    this.sinceCheck += delta.length;
    if (this.sinceCheck < this.opts.checkEveryChars) return null;
    if (this.text.length < this.opts.minTotalChars) return null;

    this.sinceCheck = 0;
    const verdict = detectRepetitionLoop(this.text, this.opts);
    if (verdict.looping) this.tripped = true;
    return verdict;
  }

  get trippedAlready(): boolean {
    return this.tripped;
  }

  get totalChars(): number {
    return this.text.length;
  }
}
