// Motion rules (design-rules §4): durations and easings come from the token file; nothing under reduced motion.
import { MOTION, EASE } from "./scale.js";
export { MOTION };
export const CALM = EASE.calm;
export function reduced() {
  try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
}
/** A motion token's duration in ms (fast · base · calm · slow), 0 under reduced motion. */
export const ms = (name) => (reduced() ? 0 : MOTION[name] ?? MOTION.base);
/** "10:42" from unix seconds (local time); "" when unknown. */
export function clock(since) {
  if (!(since > 0)) return "";
  const d = new Date(since * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
