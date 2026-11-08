// The single adapter to the backend (docs/contract.md §3).
import { API_BASE } from "./config.js";

const url = (p) => `${API_BASE}${p}`;

async function post(path, body) {
  const res = await fetch(url(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export async function world() {
  const res = await fetch(url("/world"));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const act = (target, action, args = {}) => post("/act", { target, action, args });
export const saveLayout = (view, layout) => post("/layout", { view, layout });
export const saveTheme = (tokens) => post("/theme", { tokens });
export const saveUi = (view, tree) => post("/ui", { view, tree });
/** An image for the page background → {url} served from data/ui/assets. */
export const uploadAsset = (name, data) => post("/ui/asset", { name, data });

/**
 * One /events stream with reconnect + backoff. handlers: {twin, world, open(reconnected), error}.
 * `open(true)` after a drop: events sent while away are lost, so the caller re-reads /world.
 * Returns stop(). `ES` is injectable for tests.
 */
export function events(handlers, ES = globalThis.EventSource) {
  let es, timer, delay = 1000, stopped = false, dropped = false;
  const connect = () => {
    if (stopped) return;
    es = new ES(url("/events"));
    es.onopen = () => { delay = 1000; const again = dropped; dropped = false; handlers.open?.(again); };
    es.addEventListener("twin", (e) => { try { const d = JSON.parse(e.data); handlers.twin?.(d.id, d.twin); } catch {} });
    es.addEventListener("world", (e) => { let d = null; try { d = JSON.parse(e.data); } catch {} handlers.world?.(d); });
    es.onerror = () => {
      es.close(); dropped = true; handlers.error?.();
      timer = setTimeout(connect, delay); delay = Math.min(delay * 2, 30000);
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); es?.close(); };
}
