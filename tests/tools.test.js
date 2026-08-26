import { test, expect } from "bun:test";

import { Slot } from "../core/component-base.js";
import { Tool, ToolResult, tool } from "../core/tool-call.js";
import { PREFERRED_PARAMS, initMcpTools, usageFromSchema } from "../core/tool-mcp.js";
import { ToolboxComponent } from "../core/tool-prompt.js";
import { ARG_ERROR, Toolbox } from "../core/tools.js";

// The two tools `render-full.prompt` was recorded with.
const echo = tool("echo", "Echo the text back.", '{"text": "<text>"}', (args) => args.text);
const weather = tool("weather", "Report the weather for a city.", '{"city": "<city>"}', () => "sunny");

// ── ToolResult ───────────────────────────────────────────────────────────

test("a result renders for the transcript", () => {
  expect(new ToolResult({ tool: "echo", ok: true, output: "hi" }).toString()).toBe("echo: hi");
  expect(new ToolResult({ tool: "echo", ok: false, error: "boom" }).toString()).toBe("echo: boom");
});

// ── Tool ─────────────────────────────────────────────────────────────────

test("a function tool declares its own usage line", () => {
  expect(Tool.fromFunction(echo).usage()).toBe('echo({"text": "<text>"}): Echo the text back.');
});

test("an undeclared function keeps the honest placeholder", () => {
  const bare = Tool.fromFunction(function search() {});
  expect(bare.name).toBe("search");
  expect(bare.usageArgs).toBe('{"key": "value"}');
});

test("nothing throws: an exploding tool comes back as a failed result", async () => {
  const bad = tool("bad", "", "{}", () => {
    throw new Error("kaboom");
  });
  const result = await Tool.fromFunction(bad).call({});
  expect(result.ok).toBe(false);
  expect(result.error).toBe("Error executing bad: kaboom");
});

test("a sub-agent is a tool with no adapter", async () => {
  /** @param {string} g */
  const invoke = async (g) => ({ answer: `got ${g}` });
  const agent = { name: "researcher", description: "Digs.", invoke };
  const asTool = Tool.fromAgent(agent);
  expect(asTool.usage()).toBe('researcher({"query": "<your detailed task description>"}): Digs.');
  expect((await asTool.call({ query: "  a goal " })).output).toBe("got a goal");
});

test("a sub-agent takes the goal from whatever single string was written", async () => {
  /** @param {string} g */
  const invoke = async (g) => g;
  const agent = { name: "r", description: "", invoke };
  expect((await Tool.fromAgent(agent).call({ task: "do the thing" })).output).toBe("do the thing");
});

test("nothing usable is an error, not an empty run", async () => {
  const agent = { name: "r", description: "", invoke: async () => "never" };
  const result = await Tool.fromAgent(agent).call({ query: "  " });
  expect(result.ok).toBe(false);
  expect(result.error).toBe(
    'Error executing r: no goal given. Call it as r({"query": "<the whole task, in one string>"})',
  );
});

test("an MCP image block survives as a data URL", async () => {
  const client = {
    call_tool: async () => ({
      content: [{ text: "before" }, { data: "QUJD", mimeType: "image/png" }],
    }),
  };
  const shot = Tool.fromMcp(client, { name: "screenshot" });
  expect((await shot.call({})).output).toBe("before\ndata:image/png;base64,QUJD");
  expect(shot.description).toBe("MCP tool");
});

// ── Toolbox.of, the ordered registry ─────────────────────────────────────

test("of() accepts the three kinds in order and skips nothing", () => {
  const agent = { name: "sub", description: "d", invoke: async () => "" };
  const passthrough = Tool.fromFunction(echo);
  const box = Toolbox.of(passthrough, agent, weather, null, undefined);
  expect(box.names).toEqual(["echo", "sub", "weather"]);
  expect(box.get("echo")).toBe(passthrough);
  expect(box.get("nope")).toBeNull();
  expect(box.any).toBe(true);
  expect(Toolbox.of().any).toBe(false);
});

// ── parseBatches ─────────────────────────────────────────────────────────

test("a comma keeps one batch, a newline starts the next", () => {
  const batches = Toolbox.parseBatches('a({"x": 1}), b()\nc()');
  expect(batches).toEqual([
    [
      ["a", { x: 1 }],
      ["b", {}],
    ],
    [["c", {}]],
  ]);
});

test("a JSON argument spanning lines stays in one piece", () => {
  const batches = Toolbox.parseBatches('go({\n  "url": "u"\n})\nnext()');
  expect(batches).toEqual([[["go", { url: "u" }]], [["next", {}]]]);
});

test("a nested JSON object survives the non-greedy pattern", () => {
  expect(Toolbox.parseBatches('a({"x": {"y": 1}}), b()')).toEqual([
    [
      ["a", { x: { y: 1 } }],
      ["b", {}],
    ],
  ]);
});

test("a list of lines is joined before matching", () => {
  expect(Toolbox.parseBatches(["a()", "b()"])).toEqual([[["a", {}]], [["b", {}]]]);
  expect(Toolbox.parseBatches(null)).toEqual([]);
});

test("unreadable arguments are carried, not discarded", async () => {
  const [[call]] = Toolbox.parseBatches('echo({"text": })');
  expect(call[0]).toBe("echo");
  expect(typeof call[1][ARG_ERROR]).toBe("string");

  const result = await Toolbox.of(echo).call("echo", call[1]);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Could not read the arguments: ");
  expect(result.error).toContain(
    'Write them as JSON on one line, escaping any " inside a string and using \\n for a line break — ' +
      'echo({"text": "<text>"}): Echo the text back.',
  );
});

// ── dispatch ─────────────────────────────────────────────────────────────

test("an unknown tool names what is available", async () => {
  expect((await Toolbox.of(echo).call("nope")).error).toBe("Tool not found. Available: echo");
  expect((await Toolbox.of().call("nope")).error).toBe("Tool not found. Available: none");
});

test("invoke runs batches in order and reports each as it lands", async () => {
  /** @type {string[][]} */
  const seen = [];
  const box = Toolbox.of(echo, weather);
  const out = await box.invoke('echo({"text": "hi"}), weather({"city": "Oslo"})\necho({"text": "bye"})', (rs) =>
    seen.push(rs.map((r) => r.toString())),
  );
  expect(out).toBe("echo: hi\nweather: sunny\necho: bye");
  expect(seen).toEqual([["echo: hi", "weather: sunny"], ["echo: bye"]]);
});

test("invoke never throws, even when the callback does", async () => {
  const out = await Toolbox.of(echo).invoke('echo({"text": "hi"})', () => {
    throw new Error("callback exploded");
  });
  expect(out).toBe("echo: hi");
});

// Wave 4.6: the toolbox was always built with NO_LOG and nothing replaced it, so the
// warning above (`tools.py:288` on the module logger, visible by default) was unreachable.
test("a callback that throws is announced on the log the Agent supplies", async () => {
  /** @type {string[]} */ const said = [];
  const box = Toolbox.withLog({ warning: (m) => said.push(m) }, echo);
  const out = await box.invoke('echo({"text": "hi"})', () => {
    throw new Error("callback exploded");
  });
  expect(out).toBe("echo: hi");
  expect(said).toEqual(["tool result callback failed: callback exploded"]);
  // and the tools still arrive the way `of` builds them
  expect(box.names).toEqual(Toolbox.of(echo).names);
});

test("no call at all is an observation, not an exception", async () => {
  expect(await Toolbox.of(echo).invoke("just prose")).toBe(
    "Error: No valid tool call found in: just prose",
  );
});

// ── MCP schema → usage ───────────────────────────────────────────────────

test("usage shows required params, or the one that carries the intent", () => {
  expect(usageFromSchema({ required: ["a", "b"], properties: {} })).toBe('{"a": "<a>", "b": "<b>"}');
  expect(usageFromSchema({ properties: { url: {}, timeout: {} } })).toBe('{"url": "<url>"}');
  expect(usageFromSchema({ properties: { timeout: {} } })).toBe("{}");
  expect(usageFromSchema(null)).toBe("{}");
  expect(PREFERRED_PARAMS[0]).toBe("url");
});

test("initMcpTools filters the catalogue and keeps the first description line", async () => {
  /** @type {string[]} */
  const warnings = [];
  const client = {
    list_tools: async () => [
      { name: "navigate_page", description: " Go somewhere.\nmore prose", inputSchema: { properties: { url: {} } } },
      { name: "unwanted", description: "" },
    ],
    call_tool: async () => ({}),
  };
  const tools = await initMcpTools(client, ["navigate_page", "absent"], { warn: (m) => warnings.push(m) });
  expect(tools.map((t) => t.usage())).toEqual(['navigate_page({"url": "<url>"}): Go somewhere.']);
  expect(warnings).toEqual(["MCP tools not found on server: absent"]);
});

// ── the TOOLS component ──────────────────────────────────────────────────

test("the TOOLS block is byte-identical to the recorded prompt", async () => {
  const golden = await Bun.file(new URL("./golden/render-full.prompt", import.meta.url)).text();
  const rendered = Toolbox.of(echo, weather).component().render();
  expect(golden).toContain(rendered);
  expect(rendered.startsWith("## AVAILABLE TOOLS\n\n")).toBe(true);
  // it is the whole span between the history and the response contract
  const start = golden.indexOf("## AVAILABLE TOOLS");
  const end = golden.indexOf("## RESPONSE FORMAT");
  expect(rendered).toBe(golden.slice(start, end));
});

test("an empty toolbox contributes nothing", () => {
  const empty = Toolbox.of().component();
  expect(empty.applies()).toBe(false);
  expect(empty.render()).toBe("");
  expect(ToolboxComponent.SLOT).toBe(Slot.TOOLS);
});

test("the component is registered under 'tools' and keys by content", async () => {
  const { COMPONENTS } = await import("../core/component-registry.js");
  expect(COMPONENTS["tools"]).toBe(ToolboxComponent);
  const a = new ToolboxComponent({ usages: ["x"] });
  expect(a.key()).toBe(new ToolboxComponent({ usages: ["x"] }).key());
  expect(a.key()).not.toBe(new ToolboxComponent({ usages: ["y"] }).key());
});

// ── Python string semantics at the two model-facing call sites ────────────
// Both were claimed reproduced in docs/FOUND-IN-THE-PYTHON.md and were not.
// Every expected string below came out of CPython 3.14 in the Python tree.

test("the goal rescue is `str(value or \"\")`, so an empty extra argument is skipped", async () => {
  const agent = { name: "researcher", description: "does research", invoke: async (/** @type {string} */ g) => `RAN<${g}>` };
  const sub = Tool.fromAgent(agent);
  // `??` only guards null and undefined, so every falsy extra argument used to
  // start a sub-agent instead of being skipped. 0 is not a goal.
  const refusal = 'no goal given. Call it as researcher({"query": "<the whole task, in one string>"})';
  for (const args of [{ task: 0 }, { task: false }, { task: "" }, { task: [] }, { task: {} }]) {
    await expect(sub.fn(args)).rejects.toThrow(refusal);
  }
  // and a non-empty one is rendered the way Python renders it
  expect(await sub.fn({ task: { goal: "x" } })).toBe("RAN<{'goal': 'x'}>");
  expect(await sub.fn({ query: { goal: "x" } })).toBe("RAN<{'goal': 'x'}>");
  expect(await sub.fn({ task: [1, 2] })).toBe("RAN<[1, 2]>");
  expect(await sub.fn({ task: true })).toBe("RAN<True>");
  expect(await sub.fn({ task: ["it's", 'a "b"'] })).toBe(`RAN<["it's", 'a "b"']>`);
  // the first non-empty extra wins, in argument order
  expect(await sub.fn({ a: 0, b: "second" })).toBe("RAN<second>");
});

test("the no-calls-found message renders a list repr, truncated after it is built", async () => {
  const box = new Toolbox();
  expect(await box.invoke(["hello", "there"])).toBe(
    "Error: No valid tool call found in: ['hello', 'there']",
  );
  expect(await box.invoke(["it's", "fine"])).toBe(
    `Error: No valid tool call found in: ["it's", 'fine']`,
  );
  expect(await box.invoke([{ k: "v" }])).toBe("Error: No valid tool call found in: [{'k': 'v'}]");
  expect(await box.invoke("plain text")).toBe("Error: No valid tool call found in: plain text");
  for (const empty of [[], 0, null, undefined]) {
    expect(await box.invoke(empty)).toBe("Error: No valid tool call found in: ");
  }
  // Python builds the repr and THEN cuts to 120, so the cut lands inside the
  // quoted item and the closing bracket never arrives.
  const long = await box.invoke(["x".repeat(200)]);
  expect(long).toBe(`Error: No valid tool call found in: ['${"x".repeat(118)}`);
  expect(long.endsWith("x")).toBe(true);
});
