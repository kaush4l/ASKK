// Abstract elements core — desk reader + engine structure standardization.
//
// Every render-prompt element is an object, not a string in a file and
// not a hardcoded section in engine code:
//
//   { id, kind, version, data, render(), toString(), cacheKey }
//
// - id: stable, e.g. "soul", "tools", "artifact", "watchers-running".
// - kind: the element's type (soul | instructions | tools | artifact |
//   watchers | scripts | models | response | history).
// - version: bumped whenever the element's data changes. The cache key
//   is version + a stable JSON of the data, so an unchanged object
//   returns its cached string and a changed object re-renders — never
//   a stale tool list, never a stale soul.
// - render(): returns the element's string AS IT IS NOW.
// - toString(): cached render(). This is the "to string version" of
//   every element in the render prompt template: soul, instructions
//   and tools are all converted to string, exactly as they are now,
//   so a snapshot can capture them exactly.
// - data: plain data only. No functions, no keys, no absolute paths.
//
// No new dependencies, no agent libraries. Pure core (no Node imports),
// so the same elements can be used server-side and in tests.

import { createTemplate } from "./template-order.js";
import { describeTool } from "./tool.js";

function stableString(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableString).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableString(value[k])}`).join(",")}}`;
  }
  return "";
}

export function stableKey(value) {
  return stableString(value);
}

export class DeskElement {
  constructor({ id, kind, version = 1, data = {}, render } = {}) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("element needs an id");
    }
    if (typeof kind !== "string" || kind.trim() === "") {
      throw new Error("element needs a kind");
    }
    if (typeof render !== "function") {
      throw new Error(`element ${id} needs a render() function`);
    }
    this.id = id;
    this.kind = kind;
    this.version = version;
    this.data = data;
    this._render = render;
    this._cacheKey = null;
    this._cached = null;
  }

  cacheKey() {
    return `${this.kind}:${this.id}:v${this.version}:${stableKey(this.data)}`;
  }

  // Invalidate explicitly (version bump). Changing data without a
  // version bump still invalidates, because cacheKey includes data.
  invalidate() {
    this.version += 1;
    this._cacheKey = null;
    this._cached = null;
    return this.version;
  }

  render() {
    return this._render(this.data);
  }

  toString() {
    const key = this.cacheKey();
    if (this._cacheKey === key && this._cached !== null) {
      return this._cached;
    }
    const out = String(this.render());
    this._cacheKey = key;
    this._cached = out;
    return out;
  }

  twin() {
    return {
      id: this.id,
      kind: this.kind,
      version: this.version,
      cacheKey: this.cacheKey(),
      // Plain data only; render/toString are the string form, not data.
      data: JSON.parse(JSON.stringify(this.data ?? {})),
    };
  }
}

export function createElement(spec) {
  return new DeskElement(spec);
}

// --- Element builders: each element supplies ONLY its own context. ---

export function soulElement(text) {
  const data = { text: typeof text === "string" ? text : "" };
  return createElement({
    id: "soul",
    kind: "soul",
    data,
    render: (d) => d.text,
  });
}

export function instructionsElement(text) {
  const data = { text: typeof text === "string" ? text : "" };
  return createElement({
    id: "instructions",
    kind: "instructions",
    data,
    render: (d) => d.text,
  });
}

// NOTE (Milestone 4): there is no toolSpecToString anymore. The
// tools element renders through the SINGLE reader,
// tool.js describeTool(), which reads name/args/documentation
// from the tool object itself — so the prompt string, the
// registry's describeAll(), and /api/tools specs are the same
// string for the same tool, never two formats.
export function toolsElement(specs) {
  const data = { tools: Array.isArray(specs) ? specs : [] };
  return createElement({
    id: "tools",
    kind: "tools",
    data,
    render: (d) =>
      d.tools.length === 0 ? "No tools." : d.tools.map(describeTool).join("\n"),
  });
}

export function skillsElement(skills) {
  const data = { skills: Array.isArray(skills) ? skills : [] };
  return createElement({
    id: "skills",
    kind: "skills",
    data,
    render: (d) =>
      d.skills.length === 0
        ? "Skills: none."
        : `Skills:\n${d.skills.map((s) => `- ${s.id ?? s.name ?? s} (${s.duty ?? "phase"})`).join("\n")}`,
  });
}

export function artifactElement(state) {
  const data = {
    id: state?.id ?? "default",
    open: state?.open ?? [],
    focus: state?.focus ?? null,
    modified: state?.modified ?? [],
    tree: state?.tree ?? [],
  };
  return createElement({
    id: "artifact",
    kind: "artifact",
    data,
    render: (d) => {
      const focus =
        typeof d.focus === "string" ? d.focus : (d.focus?.path ?? "none");
      return [
        `Live artifact: ${d.id}`,
        `- open: ${d.open.length ? d.open.join(", ") : "none"}`,
        `- focus: ${focus}`,
        `- modified: ${d.modified.length ? d.modified.join(", ") : "none"}`,
      ].join("\n");
    },
  });
}

export function watchersElement(running) {
  const data = { running: Array.isArray(running) ? running : [] };
  return createElement({
    id: "watchers-running",
    kind: "watchers",
    data,
    render: (d) =>
      d.running.length === 0
        ? "Watchers running: none."
        : `Watchers running:\n${d.running.map((w) => `- ${w.name ?? w} (${w.status ?? "running"})`).join("\n")}`,
  });
}

export function scriptsElement(scripts) {
  const data = { scripts: Array.isArray(scripts) ? scripts : [] };
  return createElement({
    id: "scripts",
    kind: "scripts",
    data,
    render: (d) =>
      d.scripts.length === 0
        ? "Scripts: none."
        : `Scripts:\n${d.scripts.map((s) => `- ${s.name ?? s} (${s.scope ?? "shared"}, ${s.kind ?? "shortcut"})`).join("\n")}`,
  });
}

export function modelsElement(providers) {
  const data = { providers: Array.isArray(providers) ? providers : [] };
  return createElement({
    id: "models",
    kind: "models",
    data,
    render: (d) =>
      d.providers.length === 0
        ? "Models: none added."
        : `Models:\n${d.providers.map((p) => `- ${p.id} (${p.kind}) — ${p.model ?? ""}${p.isDefault ? " [default]" : ""}`).join("\n")}`,
  });
}

export function responseElement(format) {
  const data = { format: typeof format === "string" ? format : "" };
  return createElement({
    id: "response",
    kind: "response",
    data,
    render: (d) => d.format,
  });
}

// A plain-text element for a template segment that carries no
// structured data of its own: the owner request, owner guidance,
// earlier runs, and work done. Each keeps its own id so the
// template order (template-order.js) can place it, and its own
// kind so a snapshot can tell it apart from other text.
export function textElement(id, kind, text) {
  const data = { text: typeof text === "string" ? text : "" };
  return createElement({
    id,
    kind,
    data,
    render: (d) => d.text,
  });
}

export function requestElement(text) {
  return textElement("request", "request", text);
}

export function ownerGuidanceElement(text) {
  return textElement("owner-guidance", "owner-guidance", text);
}

export function earlierRunsElement(entries) {
  const data = { entries: Array.isArray(entries) ? entries : [] };
  return createElement({
    id: "earlier-runs",
    kind: "earlier-runs",
    data,
    render: (d) =>
      d.entries.length === 0
        ? "Earlier runs: none."
        : d.entries.map((e) => `- ${e}`).join("\n"),
  });
}

export function workDoneElement(entries) {
  const data = { entries: Array.isArray(entries) ? entries : [] };
  return createElement({
    id: "work-done",
    kind: "work-done",
    data,
    render: (d) =>
      d.entries.length === 0
        ? "Work done: none."
        : d.entries.map((e) => `- ${e}`).join("\n"),
  });
}

export function historyElement(entries) {
  const data = { entries: Array.isArray(entries) ? entries : [] };
  return createElement({
    id: "history",
    kind: "history",
    data,
    render: (d) =>
      d.entries.length === 0
        ? "History: none."
        : d.entries.map((e) => `- ${e}`).join("\n"),
  });
}

// Render a prompt from elements, in insertion order. The order
// is the order of the list given here — renderPrompt() builds an
// ordered template (template-order.js) and inserts each element
// in turn, so the renderer itself holds no hardcoded segment
// sequence. Reordering the input list reorders the prompt.
export function renderPrompt(elements) {
  const list = Array.isArray(elements) ? elements : [];
  const template = createTemplate();
  for (const el of list) {
    template.insert(el);
  }
  return template.render();
}

export function elementsToSnapshot(elements) {
  const out = {};
  for (const el of elements ?? []) {
    out[el.id] = el.toString();
  }
  return out;
}
