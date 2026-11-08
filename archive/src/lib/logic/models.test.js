import { test, expect } from "bun:test";
import { modelRows, whereLine, discoverArgs, addArgs, sourceProblem, draftOf, saveArgs, draftProblem, testLine, needsUrl } from "./models.js";

const world = { desk: { model: "echo", connectors: ["echo", "openai"], models: [
  { slug: "echo", name: "echo", config: { connector: "echo", context: 12000 }, used_by: ["askk"] },
  { slug: "qwen3-30b", name: "qwen3-30b", config: { connector: "openai", base_url: "http://127.0.0.1:8000/v1" }, used_by: [] },
] } };

test("rows mark the desk default and say where", () => {
  expect(modelRows(world).map((r) => [r.slug, r.isDefault])).toEqual([["echo", true], ["qwen3-30b", false]]);
  expect(modelRows({})).toEqual([]);
  expect(whereLine(world.desk.models[1])).toBe("openai · http://127.0.0.1:8000/v1");
});

test("discover and add args: url only where a connector has one, blanks dropped", () => {
  expect(needsUrl("claude-cli")).toBe(false);
  expect(discoverArgs({ connector: "claude-cli", base_url: "http://x", key_env: "" })).toEqual({ connector: "claude-cli" });
  const src = { connector: "openai", base_url: " http://127.0.0.1:4699/v1 ", key_env: "LOCAL_KEY" };
  expect(addArgs(src, "llama-4")).toEqual({ name: "llama-4", config: { connector: "openai", base_url: "http://127.0.0.1:4699/v1", key_env: "LOCAL_KEY" } });
  expect(sourceProblem({ connector: "openai", key_env: "sk-abc123" })).toContain("NAME");
  expect(sourceProblem({ connector: "openai", key_env: "OPENAI_API_KEY" })).toBe("");
});

test("an edit keeps slug, name and connector; context a number", () => {
  const d = draftOf(world.desk.models[0]);
  expect(d.context).toBe("12000");
  expect(saveArgs({ ...d, key_env: "K" })).toEqual({ slug: "echo", name: "echo", config: { connector: "echo", key_env: "K", context: 12000 } });
  expect(draftProblem({ context: "-1" })).toContain("positive");
  expect(draftProblem({ key_env: "lower" })).toContain("NAME");
});

test("test lines", () => {
  expect(testLine({})).toBe("never called");
  expect(testLine({ test: { running: true } })).toBe("testing…");
  expect(testLine({ test: { ok: true, ms: 3, reply: "pong" } })).toBe("test ok (3 ms): pong");
  expect(testLine({ test: { ok: false, error: "no key" } })).toBe("test failed: no key");
});
