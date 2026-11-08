// The canvas, pure (contract §6, design-rules §11): every engine is a frame placed in world space; a camera
// {x, y, z} maps world → screen (screen = world·z + (x, y)). Frames without a saved position are laid out as a
// tidy tree (parents above their children, nothing overlapping); edges are drawn from the world: parent → child,
// and every help.ask route (asker → the engine that holds the ask, or → the owner), open asks highlighted.
import TOKENS from "../../../design/tokens.json";
import { SIZES, sizeForZoom } from "./sizes.js";

export const MIN_Z = 0.1, MAX_Z = 2.5;
export const EDGE_STYLES = ["curve", "straight", "step", "none"];
export function clampZoom(z) { return Math.min(MAX_Z, Math.max(MIN_Z, z)); }
/** Zoom by factor keeping the screen point (px, py) fixed. */
export function zoomAt(cam, factor, px, py) {
  const z = clampZoom(cam.z * factor);
  const k = z / cam.z;
  return { x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, z };
}

const px = (s) => parseFloat(String(s)) || 0;
const rem = (s) => parseFloat(String(s)) * 16 || 0;
/**
 * Legibility (design-rules §11): no text under LEGIBLE_PX on screen. Each canvas size's smallest text (px at zoom 1):
 * cards carry `xs` text; an icon frame shows only avatars and its title (`md`); a far frame is its avatar and its
 * title (`xl`). The zoom thresholds of the page tree pick a size; legibility caps it: a size whose smallest text
 * would be under LEGIBLE_PX renders one step smaller, down to icon, then the far frame.
 */
export const LEGIBLE_PX = 10;
export const CANVAS_TEXT = { far: rem(TOKENS.text.xl), icon: rem(TOKENS.text.md), small: rem(TOKENS.text.xs), medium: rem(TOKENS.text.xs), large: rem(TOKENS.text.xs) };
const LADDER = ["far", ...SIZES];
export const legibleFrom = (s) => LEGIBLE_PX / (CANVAS_TEXT[s] ?? CANVAS_TEXT.small);
/** The canvas size at zoom z: the thresholds' size, stepped down until its text is legible; "far" below icon. */
export function canvasSize(z, m) {
  let i = LADDER.indexOf(sizeForZoom(z, m ?? undefined));
  while (i > 0 && z < legibleFrom(LADDER[i])) i--;
  return LADDER[i];
}
/** A far frame shows its title only while the title is legible. */
export const showsTitle = (z) => z >= legibleFrom("far");
/** The zoom band [lo, hi] in which canvasSize gives `s` (null when never). */
export function zoomBand(s, m) {
  let lo = null, hi = null;
  for (let z = MIN_Z; z <= MAX_Z + 1e-9; z += 0.005) if (canvasSize(z, m) === s) { lo ??= z; hi = z; }
  return lo == null ? null : { lo, hi };
}

/** A frame's width at each canvas size: the width tokens (sm … xl). */
export const FRAME_W = { far: px(TOKENS.width.sm), icon: px(TOKENS.width.sm), small: px(TOKENS.width.md), medium: px(TOKENS.width.lg), large: px(TOKENS.width.xl) };
const ROW_H = { icon: 0, small: 64, medium: 150, large: 280 };
/** Gaps between frames, in world units: the space scale's largest step, times a few. */
export const GAP = px(TOKENS.space[6]) * 2;

/** Every engine at any depth, depth first, with its parent id. */
export function flatten(engines = [], parent = null, depth = 0, out = []) {
  for (const e of engines ?? []) {
    out.push({ id: e.id, parent, depth, engine: e });
    flatten(e.children, e.id, depth + 1, out);
  }
  return out;
}

/** A frame's size before it is measured (the canvas re-lays out with the measured sizes). */
export function estimateSize(engine, at = "small") {
  const w = FRAME_W[at] ?? FRAME_W.small;
  const n = (engine?.elements ?? []).length;
  if (at === "far") return { w, h: 88 };
  if (at === "icon") return { w, h: 64 + (n ? Math.ceil(n / 4) * 56 : 0) };
  return { w, h: 96 + n * (ROW_H[at] + 8) };
}

export const overlaps = (a, b, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The box around rects ({x, y, w, h}); null when none. */
export function bounds(rects) {
  const r = Object.values(rects ?? {});
  if (!r.length) return null;
  const x = Math.min(...r.map((a) => a.x)), y = Math.min(...r.map((a) => a.y));
  return { x, y, w: Math.max(...r.map((a) => a.x + a.w)) - x, h: Math.max(...r.map((a) => a.y + a.h)) - y };
}

/** Pack subtrees (each a list of [id, rect] with its root at y 0) left to right, each as far left as its contour allows. */
function pack(subs, gap) {
  const out = [], roots = [];
  for (const sub of subs) {
    let dx = 0;
    if (out.length) {
      dx = -Infinity;
      for (const [, a] of out) for (const [, b] of sub)
        if (a.y < b.y + b.h + gap && b.y < a.y + a.h + gap) dx = Math.max(dx, a.x + a.w + gap - b.x);
      if (dx === -Infinity) dx = 0;
    }
    for (const [id, r] of sub) out.push([id, { ...r, x: r.x + dx }]);
    roots.push(out[out.length - sub.length][1]);
  }
  return { out, roots };
}

/**
 * Frame rects for every engine. A saved position wins; the rest are a compact tidy tree (Reingold–Tilford-like):
 * top-level engines side by side in one row, each child row just below its parent (siblings side by side), each
 * subtree packed against its neighbours' contours, a parent centred over its children. Sizes are the measured ones
 * when given. The tree is moved clear of the saved frames, so no two frames ever overlap.
 */
export function autoLayout(engines, { saved = {}, sizes = {}, at = "small", gap = GAP, wrap = Infinity } = {}) {
  const nodes = flatten(engines);
  const size = (n) => sizes[n.id] ?? estimateSize(n.engine, at);
  const rects = {};
  for (const n of nodes) {
    const p = saved?.[n.id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) rects[n.id] = { x: p.x, y: p.y, ...size(n) };
  }
  const free = nodes.filter((n) => !rects[n.id]);
  if (!free.length) return rects;
  const isFree = new Set(free.map((n) => n.id));
  const kids = (id) => free.filter((n) => n.parent === id);
  const tree = (n) => {
    const s = size(n), ks = kids(n.id);
    if (!ks.length) return [[n.id, { x: 0, y: 0, w: s.w, h: s.h }]];
    const { out, roots } = pack(ks.map((k) => tree(k).map(([id, r]) => [id, { ...r, y: r.y + s.h + gap }])), gap);
    const mid = (roots[0].x + roots[0].w / 2 + roots.at(-1).x + roots.at(-1).w / 2) / 2;
    const all = [[n.id, { x: mid - s.w / 2, y: 0, w: s.w, h: s.h }], ...out];
    const minX = Math.min(...all.map(([, r]) => r.x));
    return all.map(([id, r]) => [id, { ...r, x: r.x - minX }]);
  };
  // top-level subtrees side by side; past `wrap` (world units) the next one starts a new row below (a tall viewport)
  const out = [];
  let shelf = [], top = 0;
  const flush = () => {
    if (!shelf.length) return;
    const { out: row } = pack(shelf, gap);
    for (const [id, r] of row) out.push([id, { ...r, y: r.y + top }]);
    top = Math.max(...row.map(([, r]) => r.y + r.h)) + top + gap;
    shelf = [];
  };
  const tops = free.filter((n) => !n.parent);
  for (const sub of tops.map(tree)) {
    if (shelf.length && pack([...shelf, sub], gap).out.reduce((m, [, r]) => Math.max(m, r.x + r.w), 0) > wrap) flush();
    shelf.push(sub);
  }
  flush();
  const placed = [];
  for (const [id, r] of out) { rects[id] = r; placed.push(r); }
  // the placed forest moves clear of every saved frame
  const fixed = Object.values(rects).filter((r) => !placed.includes(r));
  if (fixed.length && placed.some((a) => fixed.some((f) => overlaps(a, f, gap / 2)))) {
    const dx = Math.max(...fixed.map((f) => f.x + f.w)) + gap - Math.min(...placed.map((a) => a.x));
    for (const a of placed) a.x += dx;
  }
  // a free subtree under a saved (dragged) parent hangs below that parent, moved right until it overlaps nothing
  for (const n of free.filter((n) => n.parent && !isFree.has(n.parent))) {
    const p = rects[n.parent], sub = tree(n), root = sub[0][1];
    let dx = p.x + p.w / 2 - (root.x + root.w / 2), dy = p.y + p.h + gap;
    const all = () => Object.values(rects);
    for (let i = 0; i < 200; i++) {
      let push = 0;
      for (const [, r] of sub) for (const o of all()) if (overlaps({ ...r, x: r.x + dx, y: r.y + dy }, o, gap / 2)) push = Math.max(push, o.x + o.w + gap - (r.x + dx));
      if (!push) break;
      dx += push;
    }
    for (const [id, r] of sub) rects[id] = { ...r, x: r.x + dx, y: r.y + dy };
  }
  return rects;
}

/**
 * Edges from the world: `child` parent → child for every child engine; `ask` asker → holder for each help.ask
 * an engine holds (`state.asks`), `to: "owner"` when it is the owner's; `open` while the ask waits.
 */
export function edgesFrom(engines) {
  const out = [];
  for (const n of flatten(engines)) {
    if (n.parent) out.push({ id: `child:${n.parent}>${n.id}`, kind: "child", from: n.parent, to: n.id, open: false });
    for (const a of Array.isArray(n.engine?.state?.asks) ? n.engine.state.asks : []) {
      if (!a?.id) continue;
      const owner = a.to === "owner";
      out.push({ id: `ask:${n.id}:${a.id}`, kind: "ask", ask: a.id, from: owner ? n.id : a.from ?? n.id, to: owner ? "owner" : n.id, open: a.status === "open", question: a.question ?? "" });
    }
  }
  return out;
}

/** Where an owner's ask points: a pin above the engine's frame. */
export const ownerPin = (r) => ({ x: r.x + r.w / 2, y: r.y - GAP * 1.5 });

/** An SVG path for an edge between two frame rects. Child edges leave the parent's bottom for the child's top;
 * ask edges leave the asker's side for the holder's side (so they never sit on a child edge). */
export function edgePath(edge, a, b, style = "curve") {
  if (!a || style === "none") return "";
  let x1, y1, x2, y2, horizontal = false;
  if (edge.to === "owner") { x1 = a.x + a.w / 2; y1 = a.y; ({ x: x2, y: y2 } = ownerPin(a)); }
  else if (!b) return "";
  else if (edge.kind === "ask") { x1 = a.x + a.w; y1 = a.y + Math.min(a.h / 2, 60); x2 = b.x + b.w; y2 = b.y + Math.min(b.h / 2, 60); horizontal = true; }
  else { x1 = a.x + a.w / 2; y1 = a.y + a.h; x2 = b.x + b.w / 2; y2 = b.y; }
  const r = (n) => Math.round(n * 10) / 10;
  if (style === "straight") return `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`;
  if (style === "step") {
    if (horizontal) { const xm = Math.max(x1, x2) + GAP; return `M${r(x1)} ${r(y1)}H${r(xm)}V${r(y2)}H${r(x2)}`; }
    const ym = (y1 + y2) / 2; return `M${r(x1)} ${r(y1)}V${r(ym)}H${r(x2)}V${r(y2)}`;
  }
  if (horizontal) { const k = Math.max(GAP * 1.5, Math.abs(y2 - y1) / 2); return `M${r(x1)} ${r(y1)}C${r(x1 + k)} ${r(y1)},${r(x2 + k)} ${r(y2)},${r(x2)} ${r(y2)}`; }
  const k = Math.max(GAP / 2, Math.abs(y2 - y1) / 2);
  return `M${r(x1)} ${r(y1)}C${r(x1)} ${r(y1 + k)},${r(x2)} ${r(y2 - k)},${r(x2)} ${r(y2)}`;
}

/** The camera that shows every rect inside a viewport (w, h), with a margin; zoom clamped (at most `max`). */
export function fitCamera(rects, vw, vh, margin = GAP, max = 1.25) {
  const b = bounds(rects);
  if (!b || !(vw > 0) || !(vh > 0)) return { x: 0, y: 0, z: 1 };
  const z = clampZoom(Math.min((vw - margin * 2) / Math.max(1, b.w), (vh - margin * 2) / Math.max(1, b.h), max));
  return { x: (vw - b.w * z) / 2 - b.x * z, y: (vh - b.h * z) / 2 - b.y * z, z };
}

/**
 * Fit: the largest canvas size whose layout fits the viewport at a zoom that shows that size (legibly). Tries
 * large → far; each size laid out with `sizesFor(size)` (measured sizes) when given, else estimates.
 * → {at, rects, cam}.
 */
export function fitView(engines, vw, vh, { saved = {}, sizesFor = () => ({}), zoom, margin = Math.min(GAP, vw / 24) } = {}) {
  let last = null;
  for (const at of ["large", "medium", "small", "icon", "far"]) {
    const band = zoomBand(at, zoom);
    if (!band) continue;
    const sizes = sizesFor(at) ?? {};
    // one row of top-level engines, or wrapped into rows when that shows them larger (a tall viewport)
    let best = null;
    const row = autoLayout(engines, { saved, sizes, at });
    const full = bounds(row)?.w ?? 0;
    for (let k = 1; k <= 6; k++) {
      const wrap = k === 1 ? Infinity : full / k;
      const rects = k === 1 ? row : autoLayout(engines, { saved, sizes, at, wrap });
      const cam = fitCamera(rects, vw, vh, margin, Math.min(band.hi, 1.25));
      if (!best || cam.z > best.cam.z + 1e-6) best = { at, rects, cam, wrap };
    }
    last = best;
    if (best.cam.z >= band.lo) return best;
  }
  return last ?? { at: "far", rects: {}, cam: { x: 0, y: 0, z: 1 }, wrap: Infinity };
}

/** The camera that puts world point (wx, wy) at the viewport's centre. */
export const centreOn = (cam, wx, wy, vw, vh) => ({ ...cam, x: vw / 2 - wx * cam.z, y: vh / 2 - wy * cam.z });

/** One step of inertia: velocity decays by `friction` each frame; stops under `min`. */
export function coast(v, friction = 0.9, min = 0.05) {
  const n = { x: v.x * friction, y: v.y * friction };
  return Math.hypot(n.x, n.y) < min ? null : n;
}
