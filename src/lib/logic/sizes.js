// Card sizes (contract §2, design-rules §7): every object has four views, smallest first. A full-screen
// view may follow `large` later; the order leaves room for it.
export const SIZES = ["icon", "small", "medium", "large"];
/** Width breakpoints (px of the card's own container): below `small` → small, below `medium` → medium, else large. */
export const BREAKS = { icon: 120, small: 280, medium: 560 };
export const PHONE_MAX = 768;
/** Canvas zoom → size: below `icon` → icon, below `small` → small, below `medium` → medium, else large. */
export const ZOOM = { icon: 0.35, small: 0.6, medium: 1.25 };

export const isSize = (s) => SIZES.includes(s);
/** The size a card's available width affords. */
export function sizeForWidth(w, b = BREAKS) {
  const n = Number(w);
  if (!(n > 0)) return "medium"; // not measured yet
  return n < b.icon ? "icon" : n < b.small ? "small" : n < b.medium ? "medium" : "large";
}
/** Phones default one step smaller at the top: large becomes medium. */
export function forDevice(size, viewport) {
  return Number(viewport) <= PHONE_MAX && size === "large" ? "medium" : size;
}
export function sizeForZoom(z, m = ZOOM) {
  return z < (m.icon ?? ZOOM.icon) ? "icon" : z < (m.small ?? ZOOM.small) ? "small" : z < (m.medium ?? ZOOM.medium) ? "medium" : "large";
}
/** One step up (+1) or down (−1), clamped to the sizes. */
export function stepSize(size, d) {
  const i = Math.max(0, SIZES.indexOf(isSize(size) ? size : "medium"));
  return SIZES[Math.max(0, Math.min(SIZES.length - 1, i + Math.sign(d)))];
}
/** What a card shows: the owner's remembered size when there is one, else the automatic size. */
export function pickSize({ auto, chosen }) {
  return isSize(chosen) ? chosen : isSize(auto) ? auto : "medium";
}
/**
 * The automatic size of a card: `base` is a fixed size (a Slot's `at`, a grid's `size`) or "auto",
 * which reads the measured width, then the device.
 */
export function autoSize({ base = "auto", width, viewport, zoom }) {
  if (zoom != null) return sizeForZoom(zoom);
  if (isSize(base)) return base;
  return forDevice(sizeForWidth(width), viewport);
}
/** The layout's remembered sizes after a step: a step back to the automatic size forgets the choice. */
export function rememberSize(sizes = {}, id, next, auto) {
  const out = { ...sizes };
  if (next === auto) delete out[id];
  else out[id] = next;
  return out;
}
/** The view at a size, falling back to the nearest present one (an older backend). */
export function viewAt(views, size) {
  if (!views) return null;
  if (views[size]) return views[size];
  const i = SIZES.indexOf(size);
  for (let d = 1; d < SIZES.length; d++) for (const j of [i - d, i + d]) if (views[SIZES[j]]) return views[SIZES[j]];
  return null;
}

/**
 * The cascade (contract §6): containers hand their children presentation defaults, `{size?, kinds?: {<kind>:
 * {size}}}`. `chain` is nearest container first. The nearest container's per-kind default wins, then its default,
 * then the next container up.
 */
export function cascadeSize(chain = [], kind) {
  for (const d of chain ?? []) {
    const s = d?.kinds?.[kind]?.size ?? d?.size;
    if (isSize(s)) return s;
  }
  return null;
}
/**
 * A card's size: the owner's stepped choice > the container cascade > the page tree's fixed size > auto; then
 * `cap` (the canvas zoom's legible limit, contract §6) takes it down when it is larger: never an unreadable card.
 */
export function resolveSize({ chosen, chain, kind, base = "auto", auto, cap = null }) {
  const s = isSize(chosen) ? chosen : cascadeSize(chain, kind) ?? (isSize(base) ? base : isSize(auto) ? auto : "medium");
  return isSize(cap) && SIZES.indexOf(s) > SIZES.indexOf(cap) ? cap : s;
}
