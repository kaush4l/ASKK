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
