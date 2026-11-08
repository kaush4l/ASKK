// The element add/edit form's data (docs/contract.md Backend notes 3: Twin.config; §4 config types).

/** A list config value as form text: names comma-separated, a list holding objects as JSON. */
export function listText(v) {
  if (!Array.isArray(v)) return v == null ? "" : String(v);
  return v.some((x) => x && typeof x === "object") ? JSON.stringify(v) : v.join(", ");
}
/** Form text → a list: JSON when it starts with `[`, else comma-separated names. */
export function textList(v) {
  if (Array.isArray(v)) return v;
  const s = String(v ?? "").trim();
  if (s.startsWith("[")) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch {} }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
/** The editable copy of an element's config: the twin's own `config` map, lists as text. */
export function formConfig(element, fields = null) {
  const out = { ...(element?.config ?? {}) };
  const types = fields ? Object.fromEntries(fields) : {};
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) || types[k] === "list") out[k] = listText(v);
  return out;
}
/** Form values → the config the backend accepts: only the kind's fields, typed, blanks left out. */
export function coerceConfig(fields, values) {
  const out = {};
  for (const [f, t] of fields) {
    const v = values[f];
    if (v === undefined || v === "" || v === null) continue;
    out[f] = t === "number" ? Number(v) : t === "bool" ? !!v : t === "list" ? textList(v) : String(v);
  }
  return out;
}
/** What a Field submits (contract §5): its `args` with its own value on top. */
export function fieldBody(args, name, value, kind) {
  return { ...(args && typeof args === "object" ? args : {}), [name || "value"]: kind === "number" ? Number(value) : value };
}
