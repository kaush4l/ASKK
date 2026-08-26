/**
 * The oracle. `tests/golden/` holds four files copied byte-for-byte out of the
 * Python tree, and a port that does not reproduce them has not been done.
 *
 * These four checks drive the real `Agent`, the way `test_core.py:172-209`
 * drove it: three configurations through `agent.render()`, and one scripted
 * react loop through `await agent.invoke(...)`. That is the point of the file.
 * A stand-in that assembles the same component list by hand goes on passing
 * after the caller it stands in for has drifted, which is exactly the failure
 * an oracle exists to catch — so the hand-assembled render below is kept only
 * as a *locator*, run after the real one, to say which module produced a wrong
 * byte once the real check has already said that one was produced.
 *
 * The context facts are pinned onto the instance rather than derived. The
 * recordings carry `2026-08-16 12:00:00 PDT` beside `day: Saturday` and
 * 2026-08-16 is a Sunday, so no clock can produce that pair; `test_core.py:99`
 * replaced `Agent.context` wholesale and `core/agent-recipe.js` kept that seam
 * on purpose. `docs/FOUND-IN-THE-PYTHON.md` records why.
 *
 * When a byte differs the fixture is not the thing that is wrong. `diff()`
 * below reports the offset, the surrounding bytes and which side is which, so
 * the failure says what to go and read.
 */

import { expect, test } from "bun:test";

import { Agent } from "../core/agent.js";
import { Inference } from "../core/inference.js";
import { fixedClock, memoryFs } from "../core/ports/memory-fs.js";
import {
  ContextBlock,
  PromptAssembler,
  ReActResponse,
  ResponseContract,
  Soul,
  SystemInstructions,
  Toolbox,
  Transcript,
  defaultPorts,
  loaded,
  tool,
} from "../core/index.js";

const GOLDEN = new URL("./golden/", import.meta.url);

/** @param {string} name @returns {Promise<string>} */
async function golden(name) {
  return await Bun.file(new URL(name, GOLDEN)).text();
}

/**
 * The first differing character, with enough either side to recognise it.
 * @param {string} actual @param {string} expected @returns {string}
 */
function diff(actual, expected) {
  if (actual === expected) return "";
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  const show = (/** @type {string} */ s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40));
  return [
    `first difference at character ${i}`,
    `  expected: ${show(expected)}`,
    `  actual:   ${show(actual)}`,
    `  expected codepoint: ${expected.codePointAt(i)}, actual: ${actual.codePointAt(i)}`,
  ].join("\n");
}

// The recordings were made at this instant, in this zone. `%Z` is why the zone
// is spelled out rather than derived: a Date alone cannot render `PDT` — and
// the weekday is pinned beside it because the recorded pair disagrees with the
// calendar. Neither string is this file's to correct.
const FIXED_CONTEXT = { "current time": "2026-08-16 12:00:00 PDT", day: "Saturday" };

const echo = tool("echo", "Echo the text back.", '{"text": "<text>"}', (a) => String(a.text));
const weather = tool("weather", "Report the weather for a city.", '{"city": "<city>"}', () => "sunny");

/** Answers by prompt marker, so phase order can change without breaking tests —
 * the good idea in `test_core.py:48-86` worth keeping. Nothing here reaches the
 * markers: these four cases are all react-flow, so every reply is the last one. */
class FakeInference extends Inference {
  constructor() {
    super({ model: "fake", baseUrl: "http://fake", apiKey: "none" });
    /** @type {string[]} */ this.calls = [];
  }

  /** @param {string} prompt @returns {Promise<string>} */
  async infer(prompt) {
    if (prompt.includes("You are working step")) {
      this.calls.push("work");
      return "act: answer\n\nresult: step finished fine";
    }
    this.calls.push("react");
    return "act: answer\n\nresult: simple answer";
  }
}

/** `test_core.py:191` — a model that reads from a script. */
class Scripted extends FakeInference {
  /** @param {string[]} replies */
  constructor(replies) {
    super();
    this.replies = replies;
  }

  /** @returns {Promise<string>} */
  async infer() {
    return this.replies.shift() ?? "";
  }
}

/** An Agent on a frozen clock with the golden context block pinned onto it.
 * @param {Partial<import("../core/agent-config.js").AgentOptions> &
 *         { inference: Inference }} options @returns {Agent} */
function agentOf(options) {
  const ports = { ...defaultPorts(), fs: memoryFs({}), clock: fixedClock("2026-08-16T12:00:00-07:00") };
  const built = new Agent({ ports, ...options });
  built.context = () => ({ ...FIXED_CONTEXT });
  return built;
}

test("render parity: bare", async () => {
  const expected = await golden("render-bare.prompt");
  const actual = agentOf({ name: "p2", system: "Sys.", inference: new FakeInference() }).render();
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

test("render parity: plain-text", async () => {
  const expected = await golden("render-plain-text.prompt");
  const agent = agentOf({ name: "p3", system: "Sys.", inference: new FakeInference(), responseModel: null });
  const actual = agent.render();
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

test("render parity: full", async () => {
  const expected = await golden("render-full.prompt");
  const agent = agentOf({
    name: "p",
    system: "You are helpful.\nBe brief.",
    inference: new FakeInference(),
    tools: [echo, weather],
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ],
  });
  const actual = agent.render();
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

/**
 * `test_core.py:188-209`: the answer `invoke` hands back and the turns the loop
 * leaves on the transcript, both against the recording. The script is the
 * Python's, at `test_core.py:197`.
 */
test("react loop parity: the answer and the turns the loop leaves behind", async () => {
  const expected = JSON.parse(await golden("react-loop.json"));
  const script = ['act: tool\n\nresult: echo({"text": "hey"})', "act: answer\n\nresult: done: hey"];
  const agent = agentOf({ name: "lp", system: "Sys.", inference: new Scripted(script), tools: [echo] });

  const out = await agent.invoke("please echo hey");

  expect(out.answer).toBe(expected.answer);
  expect(agent.messages.map((m) => [m.role, m.content])).toEqual(expected.history);
});

/**
 * The locator, and only the locator. `render()` is `baseComponents()` plus the
 * response contract and nothing else, so assembling that list by hand here and
 * getting the same bytes says the difference the test above would report lives
 * in a component rather than in the recipe — and getting *different* bytes says
 * the recipe is what changed. It proves nothing on its own: it runs after the
 * real `Agent.render()` check, never instead of it.
 */
test("locator: the full prompt is the base recipe and the contract, nothing else", async () => {
  const transcript = new Transcript({ name: "p" });
  transcript.add("user", "hi");
  transcript.add("assistant", "hello there");
  const assembled = new PromptAssembler().assemble([
    new Soul({ text: "" }),
    new SystemInstructions({ text: "You are helpful.\nBe brief." }),
    new ContextBlock({ facts: FIXED_CONTEXT }),
    loaded([]),
    transcript.component(),
    Toolbox.of(echo, weather).component(),
    ResponseContract.of(ReActResponse, "toon", "[ASSISTANT]:"),
  ]);
  const expected = await golden("render-full.prompt");
  expect(diff(assembled, expected)).toBe("");
  expect(assembled).toBe(expected);
});
