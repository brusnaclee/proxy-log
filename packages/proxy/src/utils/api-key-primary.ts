/**
 * Primary Discord / trial keys cannot be deleted — only extra portal/dashboard keys.
 * Usage still belongs to the same discord_user_id regardless of which key is used.
 */
export function isProtectedPrimaryApiKey(key: {
  provisionedBy?: string | null;
  isTrial?: boolean | null;
}): boolean {
  const by = String(key.provisionedBy || "").trim().toLowerCase();
  if (by === "discord-bot" || by === "trial-bot") return true;
  return false;
}
