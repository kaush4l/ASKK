// Scale steps → tokens (docs/design-rules.md §1). Trees name steps only (gap 0–6, text xs–xl, width xs–page …);
// primitives turn a step into a `var(--…)` here and nowhere else. A value from an older tree (a px number, a
// "16% 8%" place) snaps to the nearest step — it is never used raw.
import TOKENS from "../../../design/tokens.json";

const px = (s) => parseFloat(String(s)) || 0;
const nearestKey = (group, n, keys = Object.keys(TOKENS[group])) =>
  keys.reduce((best, k) => (Math.abs(px(TOKENS[group][k]) - n) < Math.abs(px(TOKENS[group][best]) - n) ? k : best), keys[0]);

export const SPACE_MAX = 6;
export const PLACE_MAX = 8;
export const TEXT_SIZES = ["xs", "sm", "md", "lg", "xl"];

/** A gap / pad step 0–6 (a legacy larger number clamps). */
export const spaceStep = (n, fallback = 2) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(SPACE_MAX, Math.round(v))) : fallback;
};
export const space = (n, fallback) => `var(--space-${spaceStep(n, fallback)})`;
/** Text size step; an unknown size → md. */
export const text = (s) => `var(--text-${TEXT_SIZES.includes(s) ? s : "md"})`;
/** A width step (xs … page); a legacy px number snaps to the nearest step. */
export function widthStep(s, fallback = "md") {
  if (typeof s === "string" && s in TOKENS.width) return s;
  if (typeof s === "number") return nearestKey("width", s, ["xs", "sm", "md", "lg", "xl", "wide", "page"]);
  return fallback;
}
export const width = (s, fallback) => `var(--width-${widthStep(s, fallback)})`;
export const radius = (s) => `var(--radius-${s in TOKENS.radius ? s : "md"})`;
/** A field size (sm … xl); a legacy "26vmax" snaps. */
export function fieldStep(s) {
  if (typeof s === "string" && s in TOKENS.field) return s;
  return nearestKey("field", px(s) || 26);
}
/** A place [x, y] in eighths of the page; a legacy "16% 8%" snaps. */
export function placeStep(at) {
  if (Array.isArray(at) && at.length === 2) return at.map((n) => Math.max(0, Math.min(PLACE_MAX, Math.round(Number(n) || 0))));
  const v = String(at ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [50, 50];
  return [0, 1].map((i) => Math.max(0, Math.min(PLACE_MAX, Math.round((v[i] ?? 50) / 12.5))));
}
/** A place as CSS: steps of an eighth (calc over a percent unit, never written in a tree). */
export const place = (at) => placeStep(at).map((n) => `calc(${n} * 100% / ${PLACE_MAX})`).join(" ");
/** dim step 0–6 → opacity n/10; a legacy 0–0.8 fraction snaps. */
export const dimStep = (d) => { const n = Number(d) || 0; return spaceStep(n > 0 && n < 1 ? n * 10 : n, 0); };
/** blur step 0–6 → the space scale; a legacy px value snaps. */
export const blurStep = (b) => { const n = Number(b) || 0; return n > SPACE_MAX ? Number(nearestKey("space", n)) : spaceStep(n, 0); };

/** Durations and easings from the token file, in ms (JS animations read these, never a literal). */
export const MOTION = Object.fromEntries(Object.entries(TOKENS.motion).map(([k, v]) => [k, px(v)]));
export const EASE = TOKENS.ease;
