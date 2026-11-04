import { describe, expect, test } from "bun:test";
import {
  listProviders,
  mockTestProvider,
  normalizeProvider,
} from "./providers.js";

describe("models attached (template)", () => {
  test("no built-ins, no silent default: empty list has no default", () => {
    const out = listProviders([]);
    expect(out.providers).toEqual([]);
    expect(out.default).toBeNull();
    expect(out.count).toBe(0);
  });

  test("API and CLI kinds understood, CLI has command not endpoint, default only if marked", () => {
    const out = listProviders([
      {
        id: "api-opus",
        kind: "api-anthropic",
        label: "Opus",
        model: "claude-opus-5-5",
        endpoint: "https://api.example/v1",
        keySet: true,
      },
      {
        id: "claude",
        kind: "cli-claude",
        label: "Claude CLI",
        model: "claude-sonnet-5-5",
        command: "claude",
      },
    ]);
    expect(out.default).toBeNull();
    expect(out.providers[1].endpoint).toBeNull();
    expect(out.providers[1].command).toBe("claude");
    const marked = listProviders([
      {
        id: "a",
        kind: "api-openai",
        model: "gpt",
        endpoint: "https://x",
        isDefault: true,
      },
      { id: "b", kind: "api-openai", model: "gpt2", endpoint: "https://x" },
    ]);
    expect(marked.default.id).toBe("a");
  });

  test("mock test is mocked, no real call, bad kind refused", () => {
    const res = mockTestProvider({
      id: "claude",
      kind: "cli-claude",
      command: "claude",
    });
    expect(res.mocked).toBe(true);
    expect(res.ok).toBe(true);
    expect(() => normalizeProvider({ id: "x", kind: "unknown" })).toThrow();
    expect(() => normalizeProvider({ id: "x", kind: "cli-claude" })).toThrow(
      /command/,
    );
  });
});
