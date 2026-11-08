import { iconOf } from "./avatar.js";
// The left panel ("view elements"): its engine tree and its remembered open/collapsed state.

const RUNS = new Set(["running", "waiting"]);
/**
 * What runs / failed below an engine (contract §2): the backend's `summary`, else counted from the
 * twin the same way (elements and child engines at any depth; never the engine itself).
 */
export function summaryOf(e) {
  if (e?.summary) return { running: e.summary.running ?? 0, failed: e.summary.failed ?? 0 };
  const s = { running: 0, failed: 0 };
  const count = (p) => { if (RUNS.has(p)) s.running++; else if (p === "failed") s.failed++; };
  for (const x of e?.elements ?? []) count(x.phase);
  for (const c of e?.children ?? []) { count(c.phase); const k = summaryOf(c); s.running += k.running; s.failed += k.failed; }
  return s;
}
/** "2 running · 1 failed", "" when nothing runs or failed below. */
export const summaryLine = (s) => [s.running && `${s.running} running`, s.failed && `${s.failed} failed`].filter(Boolean).join(" · ");

/** Open asks an engine holds (contract §3: `state.asks`, status open). */
export const openAsks = (e) => (Array.isArray(e?.state?.asks) ? e.state.asks : []).filter((a) => a?.status === "open").length;

/** Engines → children as a flat list with depth, from the world only (nothing hardcoded). */
export function engineTree(engines = [], depth = 0, out = []) {
  for (const e of engines ?? []) {
    const summary = summaryOf(e);
    out.push({ id: e.id, title: e.title || e.id, icon: iconOf(e), phase: e.phase ?? "idle", depth, summary, asks: openAsks(e), failed: e.phase === "failed" || summary.failed > 0, busy: summary.running > 0, top: depth === 0 });
    engineTree(e.children, depth + 1, out);
  }
  return out;
}

export const PANEL_KEY = "askk.panel";
import TOKENS from "../../../design/tokens.json";
export const MOBILE_MAX = parseInt(TOKENS.breakpoint.drawer);
/** Up to this width the panel is always the icon rail (visible, never hidden); wider it follows the saved choice. */
export const RAIL_MAX = parseInt(TOKENS.breakpoint.rail);

/** Saved collapsed flag; any storage error (private mode, blocked) → open. */
export function readCollapsed(storage) {
  try { return storage?.getItem(PANEL_KEY) === "collapsed"; } catch { return false; }
}
export function saveCollapsed(storage, collapsed) {
  try { storage?.setItem(PANEL_KEY, collapsed ? "collapsed" : "open"); return true; } catch { return false; }
}
export function isMobile(width) { return Number(width) <= MOBILE_MAX; }
/** The panel shows as the rail: forced on mid widths (tablet, split screen), else the saved choice. Never on phones. */
export function isRail(width, collapsed) { const w = Number(width); return w > MOBILE_MAX && (collapsed || w <= RAIL_MAX); }

export const SCHEME_KEY = "askk.scheme";
const SCHEMES = ["system", "light", "dark"];
/** system → light → dark → system. */
export function nextScheme(s) { return SCHEMES[(SCHEMES.indexOf(s) + 1) % SCHEMES.length]; }
export function readScheme(storage) {
  try { const s = storage?.getItem(SCHEME_KEY); return SCHEMES.includes(s) ? s : "system"; } catch { return "system"; }
}
export function saveScheme(storage, s) { try { storage?.setItem(SCHEME_KEY, s); } catch {} }
