import { expect, test } from "bun:test";

import {
  AGENT_KEYS,
  HISTORY_HEADING,
  LOADER_KEYS,
  RESERVED_KEYS,
  agentMetadata,
  loadAgent,
  loadTools,
  toolName,
} from "../core/agentfile.js";
import { ReActResponse, VerifyResponse } from "../core/responses.js";
import { tool } from "../core/tool-call.js";
import { memoryFs } from "../core/ports/memory-fs.js";

const MODELS = JSON.stringify({
  default: "local",
  models: { local: { model: "m", base_url: "http://127.0.0.1:8873/v1" } },
});

/** A log that keeps every line, so a test can prove a warning was announced. */
function collector() {
  /** @type {string[]} */
  const lines = [];
  const push = (/** @type {string} */ m) => void lines.push(m);
  return { warning: push, info: push, error: push, lines };
}

/** @param {Record<string, string>} files @param {Record<string, any>} [extra] */
function deps(files, extra = {}) {
  const fs = memoryFs({ files: { "agents/models.json": MODELS, ...files } });
  return {
    ports: /** @type {any} */ ({ fs, fetch: async () => new Response("") }),
    log: collector(),
    ...extra,
  };
}

/** @param {string} frontmatter @param {string} [body] */
const agentFile = (frontmatter, body = "You are a helpful assistant.") => `---\n${frontmatter}\n---\n\n${body}\n`;

// ── the key tables ───────────────────────────────────────────────────────

test("AGENT_KEYS is the Python's model_fields minus LOADER_KEYS, written out", () => {
  // The Python derived this set; JS declares it (finding F-5). The relationship
  // the derivation guaranteed still has to hold, so it is asserted rather than
  // assumed: no loader key may also be an agent key.
  for (const key of LOADER_KEYS) expect(Object.hasOwn(AGENT_KEYS, key)).toBe(false);
  expect(Object.keys(AGENT_KEYS)).toHaveLength(17);
  expect(AGENT_KEYS.response_model).toBe("responseModel");
  expect(AGENT_KEYS.max_rounds).toBe("maxRounds");
});

test("space is the one key that is both reserved and loader-set", () => {
  expect([...RESERVED_KEYS].filter((k) => LOADER_KEYS.has(k))).toEqual(["space"]);
});

// ── toolName ─────────────────────────────────────────────────────────────

test("toolName reads a declared name, a function name, or a Tool's name", () => {
  expect(toolName(tool("look_up", "d", "{}", () => ""))).toBe("look_up");
  expect(toolName(function plain() {})).toBe("plain");
  expect(toolName({ name: "from_a_tool" })).toBe("from_a_tool");
  expect(toolName(null)).toBe("");
  expect(toolName("read_file")).toBe("");
});

// ── loadTools ────────────────────────────────────────────────────────────

test("a missing tools.js costs the agent nothing", async () => {
  expect(await loadTools("agents/x", deps({}, { loadModule: async () => ({}) }))).toEqual([]);
});

test("a broken tools.js costs the agent its tools, never its startup", async () => {
  const d = deps(
    { "agents/x/tools.js": "boom" },
    {
      loadModule: async () => {
        throw new Error("SyntaxError");
      },
    },
  );
  expect(await loadTools("agents/x", d)).toEqual([]);
  expect(d.log.lines[0]).toBe("Skipping tools in agents/x/tools.js: Error: SyntaxError");
});

test("TOOLS wins; without it every public exported function is a tool", async () => {
  const one = tool("one", "d", "{}", () => "");
  const files = { "agents/x/tools.js": "" };
  const declared = deps(files, { loadModule: async () => ({ TOOLS: [one], other: () => "" }) });
  expect(await loadTools("agents/x", declared)).toEqual([one]);

  const bare = deps(files, { loadModule: async () => ({ alpha: () => "", _hidden: () => "", VALUE: 3 }) });
  expect((await loadTools("agents/x", bare)).map(toolName)).toEqual(["alpha"]);
});

// ── loadAgent ────────────────────────────────────────────────────────────

test("no agent file is an error naming the path", async () => {
  await expect(loadAgent("ghost", deps({}))).rejects.toThrow("No agent file at agents/ghost/agent.md");
});

test("engine: base means no response model; a named one is looked up", async () => {
  const base = await loadAgent("b", deps({ "agents/b/agent.md": agentFile("engine: base") }));
  expect(base.responseModel).toBe(null);

  const react = await loadAgent("r", deps({ "agents/r/agent.md": agentFile("engine: react") }));
  expect(react.responseModel).toBe(ReActResponse);

  const named = await loadAgent(
    "v",
    deps({ "agents/v/agent.md": agentFile("engine: base\nresponse_model: verify") }),
  );
  expect(named.responseModel).toBe(VerifyResponse);
});

test("an absent engine defaults to base, so an agent file need not say so", async () => {
  const agent = await loadAgent("q", deps({ "agents/q/agent.md": agentFile("description: quiet") }));
  expect(agent.responseModel).toBe(null);
  expect(agent.name).toBe("q");
  expect(agent.description).toBe("quiet");
  expect(agent.system).toBe("You are a helpful assistant.");
});

test("the frontmatter's own name wins over the folder's", async () => {
  const agent = await loadAgent("folder", deps({ "agents/folder/agent.md": agentFile("name: declared") }));
  expect(agent.name).toBe("declared");
});

test("tools: picks by name; no tools list takes the lot", async () => {
  const alpha = tool("alpha", "a", "{}", () => "");
  const beta = tool("beta", "b", "{}", () => "");
  const module = async () => ({ TOOLS: [alpha, beta] });
  const files = { "agents/x/tools.js": "", "agents/x/agent.md": agentFile("tools: [beta]") };

  const picked = await loadAgent("x", deps(files, { loadModule: module }));
  expect(picked.toolbox.tools.map((t) => t.name)).toEqual(["beta"]);

  const all = await loadAgent(
    "x",
    deps({ ...files, "agents/x/agent.md": agentFile("engine: react") }, { loadModule: module }),
  );
  expect(all.toolbox.tools.map((t) => t.name)).toEqual(["alpha", "beta"]);
});

test("naming the space is the whole request — its tools come with it", async () => {
  const write = tool("remember", "r", "{}", () => "");
  const space = { name: "research", path: "spaces/research", toolsFor: () => [write] };
  const d = deps({ "agents/m/agent.md": agentFile("space: research") }, { getSpace: () => space });

  const agent = await loadAgent("m", d);

  expect(agent.space).toBe(space);
  expect(agent.toolbox.tools.map((t) => t.name)).toEqual(["remember"]);
  expect(d.log.lines).toContain("m: working in the 'research' space (spaces/research)");
});

test("log_path is always the agent's own folder, and preload is opt-in", async () => {
  const files = { "agents/m/agent.md": agentFile("engine: base"), "agents/m/log.txt": "[USER]: hi\n" };
  const quiet = await loadAgent("m", deps(files));
  expect(quiet.logPath).toBe("agents/m/log.txt");
  expect(quiet.system).toBe("You are a helpful assistant.");
  expect(quiet.messages).toEqual([]);

  const preloaded = await loadAgent(
    "m",
    deps({ ...files, "agents/m/agent.md": agentFile("preload_history: true") }),
  );
  // Folded into the system block, not replayed: turns it never took would read
  // as things it said.
  expect(preloaded.system).toBe(`You are a helpful assistant.\n\n${HISTORY_HEADING}\n\n[USER]: hi`);
  expect(preloaded.messages).toEqual([]);
});

test("preload_history with no log leaves the system block alone", async () => {
  const agent = await loadAgent("m", deps({ "agents/m/agent.md": agentFile("preload_history: true") }));
  expect(agent.system).toBe("You are a helpful assistant.");
});

test("multimodal names providers that never reach the toolbox", async () => {
  const shot = tool("take_screenshot", "s", "{}", () => "");
  const click = tool("click", "c", "{}", () => "");
  const d = deps(
    { "agents/x/tools.js": "", "agents/x/agent.md": agentFile("tools: [click]\nmultimodal: [take_screenshot]") },
    { loadModule: async () => ({ TOOLS: [shot, click] }) },
  );

  const agent = await loadAgent("x", d);

  expect(agent.toolbox.tools.map((t) => t.name)).toEqual(["click"]);
  expect(agent.modalities.map((t) => t.name)).toEqual(["take_screenshot"]);
});

test("leftover settings override the catalogue entry and reach the client", async () => {
  const d = deps({ "agents/m/agent.md": agentFile("temperature: 0.3\nbase_url: http://elsewhere/v1") });
  const agent = await loadAgent("m", d);
  expect(agent.inference.temperature).toBe(0.3);
  expect(agent.inference.baseUrl).toBe("http://elsewhere/v1");
});

test("a name that is neither a local tool nor an agent is warned about by name", async () => {
  const d = deps({ "agents/m/agent.md": agentFile("tools: [chrome, nowhere]") }, { agentNames: ["chrome"] });
  await loadAgent("m", d);
  expect(d.log.lines).toContain("m: nothing named nowhere in tools.js or agents/");
});

test("with a config block the outstanding names are MCP tools, and modalities come too", async () => {
  const catalogue = [
    { name: "navigate_page", description: "Go", inputSchema: { properties: { url: {} }, required: ["url"] } },
    { name: "take_screenshot", description: "Shoot", inputSchema: {} },
    { name: "unwanted", description: "No", inputSchema: {} },
  ];
  let closed = false;
  const client = { list_tools: async () => catalogue, close: () => void (closed = true) };
  const d = deps(
    {
      "agents/c/agent.md": agentFile(
        "tools:\n  - navigate_page\nmultimodal:\n  - take_screenshot\nconfig:\n  mcpServers:\n    chrome:\n      command: npx",
      ),
    },
    { connectMcp: async () => client },
  );

  const agent = await loadAgent("c", d);

  expect(agent.toolbox.tools.map((t) => t.name)).toEqual(["navigate_page"]);
  expect(agent.modalities.map((t) => t.name)).toEqual(["take_screenshot"]);
  expect(d.log.lines.some((l) => l.includes("nothing named"))).toBe(false);
  await agent.close();
  expect(closed).toBe(true);
});

test("an unreachable MCP server costs this agent its tools, not the session", async () => {
  const d = deps(
    { "agents/c/agent.md": agentFile("tools: [navigate_page]\nconfig:\n  mcpServers:\n    chrome:\n      command: npx") },
    {
      connectMcp: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
  );

  const agent = await loadAgent("c", d);

  expect(agent.toolbox.tools).toEqual([]);
  expect(d.log.lines).toContain("c: MCP init failed: Error: ECONNREFUSED");
});

// ── agentMetadata ────────────────────────────────────────────────────────

test("agentMetadata is the frontmatter and nothing else", async () => {
  const d = deps({ "agents/m/agent.md": agentFile("name: m\ntemperature: 0.7\ntools: [a, b]") });
  expect(await agentMetadata("m", d)).toEqual({ name: "m", temperature: 0.7, tools: ["a", "b"] });
  await expect(agentMetadata("ghost", d)).rejects.toThrow("No agent file at agents/ghost/agent.md");
});

test("the repository's own main agent.md loads", async () => {
  const text = await Bun.file(new URL("../agents/main/agent.md", import.meta.url)).text();
  const models = await Bun.file(new URL("../agents/models.json", import.meta.url)).text();
  const fs = memoryFs({ files: { "agents/models.json": models, "agents/main/agent.md": text } });
  const log = collector();

  const agent = await loadAgent("main", {
    ports: /** @type {any} */ ({ fs, fetch: async () => new Response("") }),
    log,
    env: { OMLX_API_KEY: "k" },
  });

  expect(agent.name).toBe("main");
  expect(agent.responseModel).toBe(ReActResponse);
  expect(agent.inference.temperature).toBe(0.7);
  expect(agent.inference.model).toBe("Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp");
  expect(agent.logPath).toBe("agents/main/log.txt");
  // Its four cron tools have no home in this test: no tools.js is loaded and no
  // space is handed in, so the loader says so rather than building a prompt that
  // never mentions them.
  expect(log.lines.some((l) => l.startsWith("main: nothing named list_cron_jobs,"))).toBe(true);
});
