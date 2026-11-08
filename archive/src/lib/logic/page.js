// Pages as component trees (contract §6): data/ui/<view>.json is a Node tree the UI renders a route from.
// Trees name scale steps only (docs/design-rules.md): places [x, y] in eighths, field sizes sm–xl, blur/dim 0–6.
import { place, fieldStep } from "./scale.js";

/** Page-level primitives (registered beside the view primitives of contract §5). */
export const PAGE_PRIMITIVES = ["Page", "Panel", "CardGrid", "Canvas", "Background", "Composer"];

/** The desk's background: hard-edged colour fields in the wall tokens, a wash, a fine ripple. */
export const DEFAULT_BACKGROUND = {
  image: null,
  fields: [
    { at: [1, 1], size: "md", color: "wall-a", hard: true },
    { at: [7, 7], size: "lg", color: "wall-b", hard: true },
    { at: [6, 0], size: "sm", color: "wall-c", hard: true },
    { at: [3, 8], size: "sm", color: "wall-d", hard: true },
  ],
  wash: true, ripples: true, tint: null, blur: 0, dim: 0,
};
// `default`: the engine the page centres on and the Composer talks to (the first top engine when absent or gone)
const COMPOSER = { c: "Composer", props: { phases: true, placeholder: "Ask Askk…" } };
const page = (main) => ({ c: "Page", props: { default: "askk", background: DEFAULT_BACKGROUND }, children: [{ c: "Panel" }, main, COMPOSER] });
/** The same trees the backend seeds; used when a world carries none (the fixture, an older server). */
export const DEFAULT_UI = {
  dashboard: page({ c: "CardGrid", props: { source: "engines", size: "auto", min: "md", gap: 4, max: "page" } }),
  canvas: page({ c: "Canvas", props: { source: "engines", zoom: { icon: 0.35, small: 0.6, medium: 1.25 }, grid: true, minimap: true, edges: "curve" } }),
};

/** A node is `{c: string, props?: object, children?: Node[]}` at every level. */
export function isTree(n) {
  if (!n || typeof n !== "object" || typeof n.c !== "string") return false;
  if (n.props != null && (typeof n.props !== "object" || Array.isArray(n.props))) return false;
  if (n.children != null && (!Array.isArray(n.children) || !n.children.every(isTree))) return false;
  return true;
}
/** The tree a route renders: the world's, else the default. */
export function pageTree(world, view) {
  const t = world?.ui?.[view];
  return isTree(t) ? t : DEFAULT_UI[view] ?? DEFAULT_UI.dashboard;
}
/** The component for a primitive name; an unknown name gets the registry's `Unknown` (never a crash). */
export function primitiveFor(registry, c) {
  return Object.hasOwn(registry, c) ? registry[c] : registry.Unknown;
}
/** The first node of a primitive, depth first, with its path of child indexes. */
export function findNode(tree, c, path = []) {
  if (!tree) return null;
  if (tree.c === c) return { node: tree, path };
  for (const [i, k] of (tree.children ?? []).entries()) {
    const f = findNode(k, c, [...path, i]);
    if (f) return f;
  }
  return null;
}
/** A copy of the tree with the node at `path` given new props (merged). */
export function withProps(tree, path, props) {
  const t = structuredClone(tree);
  let n = t;
  for (const i of path) n = n.children[i];
  n.props = { ...(n.props ?? {}), ...props };
  return t;
}

const TOKEN = /^[a-z][a-z0-9-]*$/;
/** A colour named by token (`wall-a` → `var(--wall-a)`); anything else (a raw colour) → null. */
export function colorOf(c) {
  if (c == null || c === "") return null;
  const s = String(c).trim();
  return TOKEN.test(s) ? `var(--${s})` : null;
}
/** The fields as CSS backgrounds: a hard field is a disc with a crisp rim, a soft one fades out. */
export function fieldsCss(fields = [], wash = false) {
  const out = [];
  for (const f of fields ?? []) {
    const col = colorOf(f?.color);
    if (!col) continue;
    const at = place(f.at ?? [4, 4]), size = `var(--field-${fieldStep(f.size)})`;
    out.push(f.hard
      ? `radial-gradient(circle at ${at},${col},color-mix(in oklab,${col} 45%,transparent) ${size},transparent calc(${size} * 1.008))`
      : `radial-gradient(${size} ${size} at ${at},color-mix(in oklab,${col} 70%,transparent),transparent 70%)`);
  }
  if (wash) out.push(`radial-gradient(var(--background-wash) calc(var(--background-wash) * .78) at 50% 45%,color-mix(in oklab,${colorOf(fields?.[0]?.color) ?? "var(--wall-a)"} 34%,transparent),transparent 72%)`);
  return out.join(",");
}
/** A background image URL: http(s), a site path (/ui/assets/…), or a data: image; anything else → null. */
export function imageUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (/^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(s) && !/["'()\\\s]/.test(s.replace(/^data:[^,]*,/, ""))) return s;
  return null;
}
export const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
