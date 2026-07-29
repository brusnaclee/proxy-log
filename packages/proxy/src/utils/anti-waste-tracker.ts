/**
 * In-memory per-session tool signature tracker for anti-waste.
 * Key = `${sessionId}:${apiKeyId}` — reset on new user prompt.
 */

import type { ToolSignature } from "./tool-signature.js";

export type AntiWasteTrackState = {
  seen: Map<string, number>;
  lastKey: string | null;
  consecutiveIdentical: number;
  lastPathKey: string | null;
  /** Consecutive hops hitting the same path, whatever the line range. */
  consecutiveSamePath: number;
  nudged: boolean;
};

const trackers = new Map<string, AntiWasteTrackState>();
const MAX_TRACKERS = 5000;

function getOrCreate(key: string): AntiWasteTrackState {
  let s = trackers.get(key);
  if (!s) {
    if (trackers.size >= MAX_TRACKERS) {
      // Drop oldest-ish: clear half map
      let i = 0;
      for (const k of trackers.keys()) {
        trackers.delete(k);
        if (++i >= Math.floor(MAX_TRACKERS / 2)) break;
      }
    }
    s = {
      seen: new Map(),
      lastKey: null,
      consecutiveIdentical: 0,
      lastPathKey: null,
      consecutiveSamePath: 0,
      nudged: false,
    };
    trackers.set(key, s);
  }
  return s;
}

export function resetAntiWasteTracker(sessionKey: string) {
  trackers.delete(sessionKey);
}

export function recordToolSignature(
  sessionKey: string,
  sig: ToolSignature | null,
): AntiWasteTrackState & { seenCount: number } {
  const state = getOrCreate(sessionKey);
  if (!sig) {
    return { ...state, seenCount: 0 };
  }
  const prev = state.seen.get(sig.key) || 0;
  const seenCount = prev + 1;
  state.seen.set(sig.key, seenCount);
  if (state.lastKey === sig.key) {
    state.consecutiveIdentical += 1;
  } else {
    state.consecutiveIdentical = 1;
    state.lastKey = sig.key;
  }
  if (sig.pathKey && state.lastPathKey === sig.pathKey) {
    state.consecutiveSamePath += 1;
  } else {
    state.consecutiveSamePath = sig.pathKey ? 1 : 0;
    state.lastPathKey = sig.pathKey;
  }
  return { ...state, seenCount };
}

export function markAntiWasteNudged(sessionKey: string) {
  const s = getOrCreate(sessionKey);
  s.nudged = true;
}
