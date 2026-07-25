/**
 * Normalize OpenAI-style chat message roles before upstream forward.
 * Allowlist matches strict providers (e.g. amanai): user|assistant|system|tool|function.
 */

const ALLOWED = new Set(["user", "assistant", "system", "tool", "function"]);

const ALIAS: Record<string, string> = {
  developer: "system",
  model: "assistant",
};

export type RoleSanitizeResult = {
  changed: boolean;
  remaps: Record<string, number>;
};

function contentNonEmpty(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) return content.length > 0;
  if (content && typeof content === "object") return Object.keys(content as object).length > 0;
  return false;
}

/**
 * Mutates messages in place. Returns remap stats.
 * Unknown roles with content → user; empty unknown left as-is (logged by caller via remaps key).
 */
export function sanitizeChatMessageRoles(requestBody: any): RoleSanitizeResult {
  const remaps: Record<string, number> = {};
  let changed = false;

  const bump = (from: string, to: string) => {
    const key = `${from}→${to}`;
    remaps[key] = (remaps[key] || 0) + 1;
    changed = true;
  };

  const messages = requestBody?.messages;
  if (!Array.isArray(messages)) {
    return { changed: false, remaps };
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const raw = String(msg.role ?? "").trim();
    const lower = raw.toLowerCase();
    if (!lower) {
      if (contentNonEmpty(msg.content)) {
        msg.role = "user";
        bump("(empty)", "user");
      }
      continue;
    }
    if (ALLOWED.has(lower)) {
      if (msg.role !== lower) {
        msg.role = lower;
        bump(raw, lower);
      }
      continue;
    }
    const aliased = ALIAS[lower];
    if (aliased) {
      msg.role = aliased;
      bump(lower, aliased);
      continue;
    }
    if (contentNonEmpty(msg.content)) {
      msg.role = "user";
      bump(lower, "user");
    } else {
      bump(lower, "(kept)");
    }
  }

  return { changed, remaps };
}
