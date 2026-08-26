import { test, expect } from "bun:test";
import { Glob } from "bun";
import { parseAgentFile, FrontmatterError } from "../core/frontmatter.js";

const PY = "/Users/kaush/PycharmProjects/PythonProject1";

/** Every real agent and skill file in the Python tree. @returns {Promise<string[]>} */
async function corpus() {
  /** @type {string[]} */
  const out = [];
  for (const [dir, pattern] of [
    [`${PY}/agents`, "**/agent.md"],
    [`${PY}/core/agents`, "**/agent.md"],
    [`${PY}/skills`, "**/SKILL.md"],
  ]) {
    for await (const hit of new Glob(pattern).scan({ cwd: dir, absolute: true })) out.push(hit);
  }
  return out.sort();
}

test("main/agent.md parses to the shape the loader reads", async () => {
  const path = `${PY}/agents/main/agent.md`;
  const { metadata, body } = parseAgentFile(await Bun.file(path).text(), path);
  expect(metadata).toEqual({
    name: "main",
    description: "General-purpose local assistant running on the omlx server.",
    temperature: 0.7,
    engine: "react",
    space: "research",
    tools: ["list_cron_jobs", "create_cron_job", "update_cron_job", "delete_cron_job", "chrome"],
  });
  expect(body.startsWith("You are a helpful assistant. Answer clearly, accurately, and concisely.")).toBe(true);
  expect(body.endsWith("\n")).toBe(false);
  expect(body).toContain("## Conversation format");
});

test("chrome/agent.md keeps the nested MCP config and the inline list", async () => {
  const path = `${PY}/agents/chrome/agent.md`;
  const { metadata } = parseAgentFile(await Bun.file(path).text(), path);
  expect(metadata.config).toEqual({
    mcpServers: { "chrome-devtools": { command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] } },
  });
  expect(metadata.multimodal).toEqual(["take_screenshot"]);
});

// Bun.YAML.parse passes 402/402 of the yaml-test-suite, so it is the oracle for
// the hand-rolled subset. It cannot be the implementation: it does not exist in
// a browser bundle, and agent files are parsed in the page.
test("the hand-rolled parser agrees with Bun.YAML on every real agent and skill file", async () => {
  const files = await corpus();
  expect(files.length).toBeGreaterThanOrEqual(6);
  for (const path of files) {
    const text = await Bun.file(path).text();
    const rest = text.slice(3);
    const fence = rest.indexOf("\n---");
    const oracle = Bun.YAML.parse(rest.slice(0, fence)) ?? {};
    const { metadata, body } = parseAgentFile(text, path);
    expect({ path, metadata }).toEqual({ path, metadata: /** @type {any} */ (oracle) });
    expect(body).toBe(rest.slice(fence + 4).trim());
  }
});

test("YAML 1.2 core schema: yes/no/on/off stay strings, and Bun agrees", () => {
  const src = "---\na: yes\nb: no\nc: on\nd: off\ne: true\nf: FALSE\ng: null\nh: ~\ni: 0\nj: -1.5e3\n---\n";
  const { metadata } = parseAgentFile(src);
  expect(metadata).toEqual({
    a: "yes", b: "no", c: "on", d: "off", e: true, f: false, g: null, h: null, i: 0, j: -1500,
  });
  expect(metadata).toEqual(/** @type {any} */ (Bun.YAML.parse(src.slice(3, src.indexOf("\n---", 3)))));
});

test("quoted scalars, comments and an empty inline list", () => {
  const src = [
    "---",
    "# a whole-line comment",
    'quoted: "a: b # not a comment"',
    "single: 'it''s fine'",
    "bare: plain value   # trailing comment",
    "hash: a#b",
    "empty: []",
    "nothing:",
    "---",
  ].join("\n");
  expect(parseAgentFile(src).metadata).toEqual({
    quoted: "a: b # not a comment",
    single: "it's fine",
    bare: "plain value",
    hash: "a#b",
    empty: [],
    nothing: null,
  });
});

test("both malformed-frontmatter errors reproduce the Python word for word", () => {
  expect(() => parseAgentFile("no fence here", "agents/x/agent.md")).toThrow(
    "agents/x/agent.md: missing YAML frontmatter (file must start with '---')",
  );
  expect(() => parseAgentFile("---\nname: x\n", "agents/x/agent.md")).toThrow(
    "agents/x/agent.md: unterminated YAML frontmatter (no closing '---')",
  );
  expect(() => parseAgentFile("no fence here")).toThrow(
    "<string>: missing YAML frontmatter (file must start with '---')",
  );
  expect(() => parseAgentFile("no fence here")).toThrow(FrontmatterError);
});

test("frontmatter that is a list, not a mapping, is refused", () => {
  expect(() => parseAgentFile("---\n- a\n- b\n---\nbody", "s.md")).toThrow(
    "s.md: frontmatter must be a YAML mapping, got list",
  );
});

// Wave 4.6: the Python named the type it got (`utils.py:86-87`); this said only
// "expected 'key: value'", which tells a person nothing about what they wrote.
test("frontmatter that is a bare scalar names the type, as the Python did", () => {
  /** @param {string} yaml @returns {() => unknown} */
  const parse = (yaml) => () => parseAgentFile(`---\n${yaml}\n---\nbody`, "s.md");
  const got = (/** @type {string} */ kind) => `s.md: frontmatter must be a YAML mapping, got ${kind}`;
  expect(parse("just a line")).toThrow(got("string"));
  expect(parse("'quoted'")).toThrow(got("string"));
  expect(parse("''")).toThrow(got("string"));
  expect(parse("12")).toThrow(got("number"));
  expect(parse("0")).toThrow(got("number"));
  expect(parse("false")).toThrow(got("boolean"));
  expect(parse("[a, b]")).toThrow(got("list"));
  // `yaml.safe_load(...) or {}` swallowed the falsy ones into an empty mapping; refusing them
  // is D-3, and naming what they were is the half of that D-3 had not written down
  expect(parse("~")).toThrow(got("null"));
  // a key line still reaches the ordinary parse, so its own message stays reachable
  expect(parse("a: 1\njust a line")).toThrow("s.md:3: expected 'key: value'");
});

test("empty frontmatter is an empty mapping, as yaml.safe_load(...) or {} was", () => {
  expect(parseAgentFile("---\n---\nbody").metadata).toEqual({});
  expect(parseAgentFile("---\n# only a comment\n---\nbody").metadata).toEqual({});
  expect(parseAgentFile("---\n---\n  body  ").body).toBe("body");
});

test("anything outside the subset is a parse error naming the line", () => {
  /** @param {string} yaml @returns {() => unknown} */
  const parse = (yaml) => () => parseAgentFile(`---\n${yaml}\n---\n`, "s.md");
  expect(parse("a: 1\n  b: 2")).toThrow("s.md:3: unexpected indentation");
  expect(parse("a: {x: 1}")).toThrow("s.md:2: a flow mapping or block scalar is outside this subset");
  expect(parse("a: |\n  text")).toThrow("s.md:2: a flow mapping or block scalar is outside this subset");
  expect(parse("a: 1\njust a line")).toThrow("s.md:3: expected 'key: value'");
  expect(parse('a: "unclosed')).toThrow("s.md:2: unterminated quoted string");
  expect(parse("a: [1, 2")).toThrow("s.md:2: unterminated inline list");
  expect(parse("a: [[1], 2]")).toThrow("s.md:2: a nested flow collection is outside this subset");
  expect(parse("a:\n  - x: 1")).toThrow("s.md:3: a list of mappings is outside this subset");
  expect(parse("a:\n  -")).toThrow("s.md:3: a list item must carry its value on the same line");
  expect(parse("a:\n\tb: 1")).toThrow("s.md:3: a tab may not indent YAML");
  expect(parse('a: "x" y')).toThrow("s.md:2: unexpected text after a quoted value");
  expect(parse('a: "x\\q"')).toThrow("s.md:2: unsupported escape '\\q'");
});

test("a sequence may sit at its parent key's own indentation, as YAML allows", () => {
  const src = "---\ntools:\n- a\n- b\nname: x\n---\n";
  expect(parseAgentFile(src).metadata).toEqual({ tools: ["a", "b"], name: "x" });
  expect(parseAgentFile(src).metadata).toEqual(/** @type {any} */ (Bun.YAML.parse("tools:\n- a\n- b\nname: x\n")));
});
