/**
 * Shared colour helpers for the immersive overlay.
 *
 * Kept separate so the chip row, the focus panel and the summary stage all
 * resolve a reviewer's "voice colour" and a score's tone identically.
 */

/** Agent accents cycle through --agent-1..6; keep any index in range. */
export function accentVar(accentIndex: number): string {
  const n = (((accentIndex - 1) % 6) + 6) % 6;
  return `var(--agent-${n + 1})`;
}

/** Score → design-system tone. Matches results/ so both views agree. */
export function scoreColor(score: number): string {
  if (score >= 85) return "var(--color-success)";
  if (score >= 60) return "var(--color-primary)";
  return "var(--color-secondary)";
}
