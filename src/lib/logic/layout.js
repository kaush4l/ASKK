/** Engines in the saved dashboard order; unknown ids keep their boot order after. */
export function orderEngines(engines = [], layout) {
  const order = layout?.order ?? [];
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  return engines.map((e, i) => [e, i]).sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1]).map(([e]) => e);
}
/** Move id by delta within the list of ids; returns a new array. */
export function moveId(ids, id, delta) {
  const out = [...ids]; const i = out.indexOf(id); const j = i + delta;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** Default canvas position for the n-th frame when none is saved. */
export function defaultPosition(n) { return { x: 40 + (n % 3) * 420, y: 40 + Math.floor(n / 3) * 420 }; }
/** Move id to index (drag-reorder); returns a new array. */
export function moveTo(ids, id, index) {
  const out = ids.filter((x) => x !== id);
  if (out.length === ids.length) return [...ids];
  out.splice(Math.max(0, Math.min(index, out.length)), 0, id);
  return out;
}
/**
 * Dashboard grid rule: cards fill the width in columns of at least `min` px; a lone engine
 * takes the row up to `lone` px; the whole grid stops at `max` px.
 */
export function dashboardGrid(count, { min = "var(--width-md)", max = "var(--width-page)" } = {}) {
  // auto-fit (not auto-fill): empty tracks collapse, so the cards share the whole width. Widths are tokens.
  return { min, max, lone: count <= 1 ? "var(--width-wide)" : null, columns: `repeat(auto-fit,minmax(min(${min},100%),1fr))` };
}

/** The dashboard's split: the default engine featured (centred, large), every other top engine smaller beside it. */
export function featuredSplit(engines = [], dflt = null) {
  const featured = engines.find((e) => e.id === dflt) ?? engines[0] ?? null;
  return { featured, rest: engines.filter((e) => e !== featured) };
}
