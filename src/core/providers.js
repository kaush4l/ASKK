// Models attached — TEMPLATE only in this PR.
//
// Provider kinds understood in the template:
// - API: "api-openai" (OpenAI API), "api-anthropic" (Anthropic-compatible),
//   "api-local" (OpenAI-compatible local server, e.g. oMLX / Qwen).
// - CLI: "cli-claude" (Claude CLI), "cli-openai" (OpenAI CLI),
//   "cli-gemini" (Gemini CLI). A CLI provider has a command, not an
//   endpoint. A local API provider has an endpoint and no key.
//
// NO built-ins, NO defaults to fill a void: the list is only what
// was added. Empty list => empty state, no default. A default exists
// only if an entry is explicitly marked default (isDefault) or a
// defaultId is passed — the first entry is NOT silently promoted.
// No real model calls in this PR: mockTestProvider() returns a
// mocked result, so the template can be tested without a model,
// a key, or a CLI on the machine. Keys are never returned: the
// template twin carries keySet (boolean) only, never a key or an
// apiKeyEnv value.

export const PROVIDER_KINDS = Object.freeze([
  "api-openai",
  "api-anthropic",
  "api-local",
  "cli-claude",
  "cli-openai",
  "cli-gemini",
]);

export function normalizeProvider(entry) {
  if (!entry || typeof entry.id !== "string" || entry.id.trim() === "") {
    throw new Error("provider needs an id");
  }
  if (!PROVIDER_KINDS.includes(entry.kind)) {
    throw new Error(
      `provider kind must be one of ${PROVIDER_KINDS.join(", ")}, got ${JSON.stringify(entry.kind)}`,
    );
  }
  const isCli = entry.kind.startsWith("cli-");
  if (
    isCli &&
    (typeof entry.command !== "string" || entry.command.trim() === "")
  ) {
    throw new Error(
      `CLI provider ${entry.id} needs a command, not an endpoint`,
    );
  }
  if (
    !isCli &&
    (typeof entry.endpoint !== "string" || entry.endpoint.trim() === "")
  ) {
    throw new Error(`API provider ${entry.id} needs an endpoint`);
  }
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label ?? entry.id,
    model: entry.model ?? "",
    endpoint: isCli ? null : entry.endpoint,
    command: isCli ? entry.command : null,
    tokens: entry.tokens ?? null,
    keySet: Boolean(entry.keySet),
    isDefault: Boolean(entry.isDefault),
  };
}

export function listProviders(entries, defaultId = null) {
  const providers = (entries ?? []).map(normalizeProvider);
  // No silent default: default only if explicitly marked or passed.
  let def = null;
  if (defaultId) {
    def = providers.find((p) => p.id === defaultId) ?? null;
  } else {
    def = providers.find((p) => p.isDefault) ?? null;
  }
  return {
    providers: providers.map((p) => ({
      ...p,
      isDefault: def ? p.id === def.id : false,
    })),
    default: def ? { ...def, isDefault: true } : null,
    // Saved ones on load: the list as added, in order, nothing else.
    count: providers.length,
  };
}

// Model details, from provider/model data only — never invented.
// ctx comes from the entry's ctx / contextLength / context field;
// timings and counts come from the entry's own fields. Absent
// fields stay null here: defaultsFor() is the labelled-default
// path, and it must never be mistaken for a model fact.
export function getModelDetails(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("model details need a provider entry");
  }
  const ctx =
    entry.ctx ?? entry.contextLength ?? entry.context ?? entry.tokens ?? null;
  return {
    id: entry.id ?? null,
    model: entry.model ?? "",
    ctx: ctx ?? null,
    ctxSource: ctx === null ? null : "model",
    timings: entry.timings ?? null,
    counts: entry.counts ?? null,
  };
}

// Explicit, LABELLED defaults for when model data is absent.
// ctx 128000 is a default, not a claim about any model — every
// value here carries label "default" so the UI can say so.
export function defaultsFor(model) {
  return {
    model: model ?? "",
    ctx: { value: 128000, label: "default" },
    timings: { value: null, label: "default" },
    counts: { value: null, label: "default" },
  };
}

// Pure provider actions, for the Models page and its route.
// use: set the default by id (throws when the id is absent).
// edit: merge a patch (id immutable), re-validated when the
// merged entry carries a kind. delete: remove by id (throws when
// absent). test: the mocked test (no real call, no CLI).
export function setDefaultProvider(entries, id) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.some((entry) => entry?.id === id)) {
    throw new Error(`no provider with id ${id}`);
  }
  return list.map((entry) => ({ ...entry, isDefault: entry.id === id }));
}

export function updateProvider(entries, id, patch = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const at = list.findIndex((entry) => entry?.id === id);
  if (at < 0) {
    throw new Error(`no provider with id ${id}`);
  }
  const merged = { ...list[at], ...patch, id };
  if (merged.kind) {
    normalizeProvider(merged);
  }
  const next = [...list];
  next[at] = merged;
  return next;
}

export function removeProvider(entries, id) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.some((entry) => entry?.id === id)) {
    throw new Error(`no provider with id ${id}`);
  }
  return list.filter((entry) => entry.id !== id);
}

export function applyProviderAction(state, action) {
  const entries = state?.providers ?? [];
  const defaultId = state?.defaultId ?? null;
  if (action?.action === "use") {
    const next = setDefaultProvider(entries, action.id);
    return {
      state: { providers: next, defaultId: action.id },
      result: { ok: true, action: "use", id: action.id },
    };
  }
  if (action?.action === "delete") {
    const next = removeProvider(entries, action.id);
    return {
      state: {
        providers: next,
        defaultId: defaultId === action.id ? null : defaultId,
      },
      result: { ok: true, action: "delete", id: action.id },
    };
  }
  if (action?.action === "edit") {
    const next = updateProvider(entries, action.id, action.patch ?? {});
    return {
      state: { providers: next, defaultId },
      result: { ok: true, action: "edit", id: action.id },
    };
  }
  if (action?.action === "test") {
    const entry = entries.find((item) => item?.id === action.id);
    if (!entry) {
      throw new Error(`no provider with id ${action.id}`);
    }
    return { state: { providers: entries, defaultId }, result: mockTestProvider(entry) };
  }
  throw new Error(`unknown provider action ${JSON.stringify(action?.action)}`);
}

export function mockTestProvider(provider) {
  const p = normalizeProvider(provider);
  // Mocked, standard test: no network, no CLI spawn, no key use.
  return {
    ok: true,
    mocked: true,
    id: p.id,
    kind: p.kind,
    message: `Mock test passed for ${p.id} (${p.kind}): template rendered, no real call made.`,
  };
}
