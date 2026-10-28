// The last restart's warm pass (scripts/warm-pages.js → logs/warm.json → projects/health → dev state.health.warm) as
// one line, the same one dev.health prints: "warm at 06:35: / 483 ms · /live 40 ms · …"; a page that did not answer 200
// shows its status (or its error, for status 0) before its ms. No warm pass known: null. Its time is local, through the
// views' own hm, like the Safety row's health and restart times (the ISO's UTC slice read hours off).

import { hm } from "../../backend/live/time.js"

export function warmLine(warm) {
  if (!warm?.pages?.length) return null
  return `warm at ${hm(warm.at)}: ${warm.pages.map((p) => `${p.path} ${p.status === 200 ? `${p.ms} ms` : `${p.status || p.error} in ${p.ms} ms`}`).join(" · ")}`
}

// The 3 heaviest static imports of / (scripts/home-imports.js → logs/home-imports.json → projects/health → dev
// state.health.imports): "heaviest on /: components/home/dashboard.jsx 5.0 KB · …". No ranking known: null.
export function importsLine(r) {
  if (!r?.top?.length) return null
  return `heaviest on /: ${r.top.slice(0, 3).map((n) => `${n.path} ${(n.bytes / 1024).toFixed(1)} KB`).join(" · ")}`
}

// The warm line's span in the Safety row: below sm it takes its own wrapped row (basis-full) so a phone never scrolls
// sideways; from sm up it sits inline after the checkpoint. It breaks at spaces, never mid-number (no break-all).
export function warmClasses() {
  return "min-w-0 basis-full break-words font-mono text-[11px] text-muted-foreground sm:basis-auto"
}
// A restart's health before (the desk's last dev.health, posted with dev.restart) and after (the supervisor's check once
// the server is up, or after the rollback), for the Safety row: "health before ok → after ok · 1840 ms"; a side not
// known reads "?". Neither known (a record from before 2026-10-27): null.
export function restartHealthLine(r) {
  if (!r?.before && !r?.after) return null
  const side = (h) => (h ? (h.ok ? "ok" : "failing") : "?")
  return `health before ${side(r.before)} → after ${side(r.after)}${r.after?.ms != null ? ` · ${r.after.ms} ms` : ""}`
}
