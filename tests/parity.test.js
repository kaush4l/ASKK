/**
 * The oracle. `tests/golden/` holds four files copied byte-for-byte out of the
 * Python tree, and a port that does not reproduce them has not been done.
 *
 * `Agent` is wave 3, so this file does not use it. It assembles the same
 * component list `Agent.base_components` + `Agent.render` assemble — the
 * `DEFAULT_COMPONENTS` order `soul, system, context, loaded_skills, history,
 * tools`, then `ResponseContract.of(...)` — out of the modules that exist, and
 * compares the assembled string to the recording. That is not a weaker check
 * than driving `Agent`: `render()` is that list and nothing else, so a diff
 * here is a diff in a component, and a failure names the module that produced
 * the wrong bytes rather than the caller that asked for them.
 *
 * The context facts are frozen at the values the recordings were made with. The
 * Python froze them by monkeypatching `Agent.context`; here they are simply
 * passed, because a pure core takes its clock as an argument.
 *
 * When a byte differs the fixture is not the thing that is wrong. `diff()`
 * below reports the offset, the surrounding bytes and which side is which, so
 * the failure says what to go and read.
 */

import { expect, test } from "bun:test";

import {
  ContextBlock,
  PromptAssembler,
  ReActResponse,
  ResponseContract,
  Soul,
  SystemInstructions,
  Toolbox,
  Transcript,
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
// is spelled out rather than derived: a Date alone cannot render `PDT`.
const FIXED_CONTEXT = { "current time": "2026-08-16 12:00:00 PDT", day: "Saturday" };

const echo = tool("echo", "Echo the text back.", '{"text": "<text>"}', (a) => String(a.text));
const weather = tool("weather", "Report the weather for a city.", '{"city": "<city>"}', () => "sunny");

/**
 * `Agent.base_components(...)` + the response contract, without `Agent`.
 * @param {{ soul?: string, system?: string,
 *           messages?: ["user" | "assistant", string][],
 *           tools?: unknown[], model?: typeof ReActResponse | null }} spec
 * @returns {string}
 */
function render(spec) {
  const transcript = new Transcript({ name: "p" });
  for (const [role, content] of spec.messages ?? []) transcript.add(role, content);
  const parts = [
    new Soul({ text: spec.soul ?? "" }),
    new SystemInstructions({ text: spec.system ?? "" }),
    new ContextBlock({ facts: FIXED_CONTEXT }),
    loaded([]),
    transcript.component(),
    Toolbox.of(...(spec.tools ?? [])).component(),
    ResponseContract.of(spec.model === undefined ? ReActResponse : spec.model, "toon", "[ASSISTANT]:"),
  ];
  return new PromptAssembler().assemble(parts);
}

test("render parity: bare", async () => {
  const expected = await golden("render-bare.prompt");
  const actual = render({ system: "Sys." });
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

test("render parity: plain-text", async () => {
  const expected = await golden("render-plain-text.prompt");
  const actual = render({ system: "Sys.", model: null });
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

test("render parity: full", async () => {
  const expected = await golden("render-full.prompt");
  const actual = render({
    system: "You are helpful.\nBe brief.",
    messages: [
      ["user", "hi"],
      ["assistant", "hello there"],
    ],
    tools: [echo, weather],
  });
  expect(diff(actual, expected)).toBe("");
  expect(actual).toBe(expected);
});

/**
 * The react loop's turns, without the loop.
 *
 * `Agent.react_loop` is wave 3. What it does between the model and the
 * transcript is not: parse the reply, run the calls, write `Result: ` back as a
 * user turn, go round. That is played out here against the recorded script, so
 * the golden's history is pinned to the modules that produce every line of it —
 * `responses` for the answer, `tools` for the observation, `memory` for the
 * turns. Wave 3 replaces this with `Agent.invoke` and must produce the same
 * two values.
 */
test("react loop parity: the turns the loop leaves behind", async () => {
  const expected = JSON.parse(await golden("react-loop.json"));
  const script = ['act: tool\n\nresult: echo({"text": "hey"})', "act: answer\n\nresult: done: hey"];

  const transcript = new Transcript({ name: "lp" });
  const toolbox = Toolbox.of(echo);
  transcript.add("user", "please echo hey");

  let reply = 0;
  let parsed = ReActResponse.parse(script[reply++], "toon");
  transcript.add("assistant", String(parsed.answer).trim());
  while (!parsed.isAnswer) {
    const observation = await toolbox.invoke(String(parsed.answer).trim());
    transcript.add("user", `Result: ${observation}`);
    parsed = ReActResponse.parse(script[reply++], "toon");
    transcript.add("assistant", String(parsed.answer).trim());
  }

  expect(parsed.answer).toBe(expected.answer);
  expect(transcript.messages.map((m) => [m.role, m.content])).toEqual(expected.history);
});
