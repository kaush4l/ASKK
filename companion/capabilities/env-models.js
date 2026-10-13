// The model connections configured in the environment (capability `models`,
// GET models): .env, which Bun loads from the folder ASKK starts in.
// Used by companion/server/host-api.js and companion/team/ask.js.

// The model connections configured in the environment (.env, which Bun loads
// from the folder ASKK starts in): { default, models } in the models.json
// format, or an empty catalogue when ASKK_MODEL_ID is unset. ASKK_MODEL_* is
// the default; ASKK_BACKUP_* (optional) is its fallback, used when the default
// fails before answering. A model this machine runs (provider claude-cli,
// codex-cli, gemini-cli, apple) needs no URL.
const RUN_HERE = ["claude-cli", "codex-cli", "gemini-cli", "apple"]
function envModel(env, prefix, fallbackKey) {
  const value = (name) => env[`${prefix}_${name}`]?.trim() || undefined
  const number = (name) => (Number(value(name)) > 0 ? Number(value(name)) : undefined)
  const id = value("ID")
  const provider = value("PROVIDER") || "openai"
  if (!id || (!value("BASE_URL") && !RUN_HERE.includes(provider))) return null
  return [
    value("KEY") || fallbackKey,
    {
      label: value("LABEL") || `${id} (from .env)`,
      provider,
      base_url: value("BASE_URL"),
      id,
      api_key: value("API_KEY"),
      max_tokens: number("MAX_TOKENS"),
      context_length: number("CONTEXT_LENGTH"),
    },
  ]
}

export function modelsFromEnv(env = process.env) {
  const main = envModel(env, "ASKK_MODEL", "local")
  if (!main) return { default: null, models: {} }
  const backup = envModel(env, "ASKK_BACKUP", "backup")
  if (backup && backup[0] !== main[0]) main[1].fallback = backup[0]
  return { default: main[0], models: Object.fromEntries(backup ? [backup, main] : [main]) }
}
