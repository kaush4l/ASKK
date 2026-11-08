export const TONES = ["neutral", "ok", "warn", "error", "busy", "accent"];
const PHASE = { idle: "neutral", running: "busy", waiting: "accent", stopped: "neutral", interrupted: "warn", failed: "error" };
export function phaseTone(phase) { return PHASE[phase] ?? "neutral"; }
export function toneOf(tone, phase) {
  if (TONES.includes(tone)) return tone;
  if (phase) return phaseTone(phase);
  return "neutral";
}
/** CSS variable for a tone: tokens only, never raw colours. */
export function toneVar(tone, phase) { return `var(--${toneOf(tone, phase)})`; }
