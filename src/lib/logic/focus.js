// The four sizes as places (design-rules §7): icon and small live in the widget grid; medium expands the card INTO
// the content area (the rest recedes); large is an immersive full-screen scene at /focus?id=…. Pure, tested.
import { clock } from "./motion.js";

export const CYCLE = ["icon", "small", "medium", "large"];
/** The size step control cycles icon → small → medium → large → icon. */
export const nextSize = (s) => (CYCLE.includes(s) ? CYCLE[(CYCLE.indexOf(s) + 1) % CYCLE.length] : "small");
/** What a card takes in the grid: medium and large open out of it, so their place keeps the small card. */
export const gridSize = (s) => (s === "icon" ? "icon" : "small");
/** medium → "expand", large → "immersive", else null (stays in the grid). */
export const openMode = (s) => (s === "medium" ? "expand" : s === "large" ? "immersive" : null);

export const focusHref = (id) => `/focus?id=${encodeURIComponent(id)}`;
export const focusId = (url) => url?.searchParams?.get("id") || null;

/** The focus after a size pick: an open state {id, mode, from} or null (back in the grid). */
export function openFocus(_state, { id, size, from = null }) {
  const mode = openMode(size);
  return mode ? { id, mode, from } : null;
}
export const closeFocus = () => null;
export const focusKey = (state, key) => (key === "Escape" ? null : state);

/** The expanded card's box: the content area right of the panel, under any top bar, above the composer. */
export function expandBox({ vw, vh, shell = 0, composer = 0, gap = 16, top = gap }) {
  const x = shell + gap, y = top;
  return { x, y, w: vw - x - gap, h: vh - y - composer - gap };
}

/** The twin's activity (newest first, as the backend sends it) as rows: time, action, text, ok, by. */
export function activityRows(twin, n = 20) {
  return (twin?.activity ?? []).slice(0, n).map((a) => ({ time: clock(a.at), action: a.action ?? "", text: a.text ?? "", ok: a.ok !== false, by: a.by ?? "" }));
}
export const focusLine = (twin) => twin?.status?.focus || twin?.status?.now || "";
export const chipOf = (twin) => twin?.status?.chip || null;
