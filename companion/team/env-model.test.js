import { describe, expect, test } from "bun:test"

import { envModel, forcedModels, MODELS } from "./compose.js"

describe("envModel", () => {
  test("unset → null: the desk keeps its own catalogue", () => {
    expect(envModel({})).toBeNull()
  })

  test("openai: an OpenAI-compatible server, key from OPENAI_API_KEY", () => {
    const m = envModel({ ASKK_LLM_PROVIDER: "openai", ASKK_LLM_ID: "gemma-3n", ASKK_LLM_BASE_URL: "http://127.0.0.1:8080/v1", OPENAI_API_KEY: "k", ASKK_LLM_CONTEXT: "32768" })
    expect(m).toMatchObject({ key: "env", provider: "openai", id: "gemma-3n", base_url: "http://127.0.0.1:8080/v1", api_key: "k", context_length: 32768 })
  })

  test("anthropic: base url optional, ASKK_LLM_API_KEY wins", () => {
    const m = envModel({ ASKK_LLM_PROVIDER: "Anthropic", ASKK_LLM_ID: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "a", ASKK_LLM_API_KEY: "b" })
    expect(m).toMatchObject({ provider: "anthropic", id: "claude-sonnet-5-5", api_key: "b" })
    expect("base_url" in m).toBe(false)
  })

  test("a bad or incomplete one throws, never a silent CLI fallback", () => {
    expect(() => envModel({ ASKK_LLM_PROVIDER: "claude-cli", ASKK_LLM_ID: "x" })).toThrow(/openai or anthropic/)
    expect(() => envModel({ ASKK_LLM_PROVIDER: "openai" })).toThrow(/ASKK_LLM_ID/)
    expect(() => envModel({ ASKK_LLM_PROVIDER: "openai", ASKK_LLM_ID: "x" })).toThrow(/ASKK_LLM_BASE_URL/)
  })
})

describe("forcedModels", () => {
  test("every key of the catalogue, plus default and env, answered by the forced model", () => {
    const forced = { key: "env", provider: "openai", id: "local", base_url: "http://127.0.0.1:8080/v1" }
    const out = forcedModels(MODELS, forced)
    for (const key of [...Object.keys(MODELS), "default", "env"]) expect(out[key]).toEqual({ ...forced, key })
  })
})
