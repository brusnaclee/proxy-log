/**
 * Whether an upstream rejection is explicitly scoped to the selected API key.
 *
 * Keep this narrow: provider/model-wide 403s must surface immediately rather
 * than burning through the entire key pool. Only failures where another key
 * can plausibly help should rotate.
 */
export function isKeyScopedAuthFailure(
  status: number,
  body: string | null | undefined,
): boolean {
  if (status !== 403) return false;
  const text = String(body || "");
  return (
    /\b(?:api\s+)?key\b.{0,80}\brevoked\b/i.test(text) ||
    /\bcombo\b.{0,160}\bnot allowed for this api key\b/i.test(text)
  );
}
