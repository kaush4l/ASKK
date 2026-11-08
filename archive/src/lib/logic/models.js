// The desk's model library as the Models page shows it (world.desk, docs/contract.md §3 desk).
// A model is one name — the provider's model id — plus config {connector, base_url?, key_env?, context?}.
// Keys are never typed here: a model names only key_env, the env var that holds the key.

/** The config fields an existing row may edit (the connector and name stay). */
export const EDIT_FIELDS = ["base_url", "key_env", "context"];

/** The URL each connector reaches by default; none: the field is hidden (no server to name). */
export const DEFAULT_URL = {
  openai: "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};
export const needsUrl = (connector) => connector in DEFAULT_URL;

/** The library rows, the desk default marked: [{slug, name, config, …, isDefault}]. */
export function modelRows(world) {
  const d = world?.desk;
  if (!d) return [];
  return (d.models ?? []).map((m) => ({ ...m, isDefault: m.slug === d.model }));
}

/** "connector · base_url" for a row. */
export function whereLine(m) {
  const c = m?.config ?? {};
  return [c.connector, c.base_url].filter(Boolean).join(" · ");
}

/** The "Add models" source: connector, url, key_env → model.discover args (url only where one applies). */
export function discoverArgs(src) {
  const args = { connector: src.connector };
  const url = String(src.base_url ?? "").trim();
  if (needsUrl(src.connector) && url) args.base_url = url;
  const k = String(src.key_env ?? "").trim();
  if (k) args.key_env = k;
  return args;
}

/** model.save args for one discovered (or typed) name from that source. */
export function addArgs(src, name) {
  return { name: String(name).trim(), config: discoverArgs(src) };
}

/** What the client refuses before sending (the backend checks again). */
export function sourceProblem(src) {
  if (!String(src.connector ?? "").trim()) return "pick a connector";
  return keyEnvProblem(src.key_env);
}
function keyEnvProblem(k) {
  k = String(k ?? "").trim();
  if (k && !/^[A-Z_][A-Z0-9_]*$/.test(k)) return "key_env is the NAME of an env var (like OPENAI_API_KEY), never the key";
  return "";
}

/** An edit draft from a row: flat strings for base_url, key_env, context. */
export function draftOf(m) {
  const c = m?.config ?? {};
  const out = { slug: m.slug, name: m.name, connector: c.connector };
  for (const f of EDIT_FIELDS) out[f] = c[f] == null ? "" : String(c[f]);
  return out;
}

/** An edit draft → model.save args (the same slug and name; blanks left out, context a number). */
export function saveArgs(draft) {
  const config = { connector: draft.connector };
  for (const f of EDIT_FIELDS) {
    const v = String(draft[f] ?? "").trim();
    if (v) config[f] = f === "context" ? Number(v) : v;
  }
  return { slug: draft.slug, name: draft.name, config };
}

export function draftProblem(draft) {
  const p = keyEnvProblem(draft.key_env);
  if (p) return p;
  const n = String(draft.context ?? "").trim();
  if (n && !(Number(n) > 0)) return "context is a positive number of characters";
  return "";
}

/** One line for a test result or the last call. */
export function testLine(m) {
  const t = m?.test;
  if (!t) return m?.last ? `${m.calls ?? 0} call(s) · last ${m.last.ok ? "ok" : "failed"} ${m.last.ms ?? "?"} ms` : "never called";
  if (t.running) return "testing…";
  return t.ok ? `test ok (${t.ms} ms): ${t.reply}` : `test failed: ${t.error}`;
}
