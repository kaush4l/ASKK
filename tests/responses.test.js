import { test, expect } from "bun:test";

import {
  ANSWER,
  BaseResponse,
  CritiqueResponse,
  DEFAULT_FORMAT,
  JSON_FORMAT,
  PlanResponse,
  ReActResponse,
  RESPONSE_MODELS,
  ResponseContract,
  SimpleResponse,
  SkillSelectResponse,
  TOOL,
  TOON,
  UnderstandResponse,
  VerifyResponse,
  getResponseModel,
} from "../core/responses.js";
import { Slot } from "../core/component-base.js";
import { COMPONENTS } from "../core/component-registry.js";

// ── the bytes ────────────────────────────────────────────────────────────

test("the react contract is byte-identical to the golden prompt", async () => {
  const golden = await Bun.file(new URL("./golden/render-bare.prompt", import.meta.url)).text();
  const rendered = ResponseContract.of(ReActResponse, TOON).render();
  expect(golden.includes(rendered)).toBe(true);
  expect(golden.endsWith(rendered)).toBe(true);
});

test("instructions list the fields in declaration order, with (list) markers", () => {
  const text = ReActResponse.instructions(TOON);
  expect(text).toContain("Reply with exactly these fields, in this order: think, plan, act, result.");
  expect(text).toContain("- think (list): Your private reasoning, one thought per item.");
  expect(text).toContain("- act: Exactly 'tool' to call a tool");
  expect(text).toContain("think: [<your first think>, <your second think>]");
  expect(text).toContain("act: <your act here>");
});

test("JSON instructions carry the same field docs and a JSON example", () => {
  const text = UnderstandResponse.instructions(JSON_FORMAT);
  expect(text).toContain("Reply with a single JSON object containing exactly these keys:");
  expect(text).toContain("Output only the JSON object — no markdown fences, no text around it.");
  expect(text).toContain('Example:\n{\n  "think": "<think>",\n  "complexity": "<complexity>",');
  // format_notes only exists on the react contract
  expect(text).not.toContain("WRONG (never do this)");
});

// ── object -> string ─────────────────────────────────────────────────────

test("toString writes TOON blocks and JSON objects", () => {
  const parsed = new ReActResponse({ think: ["a", "b"], act: "tool", result: "echo({})" });
  expect(parsed.toString(TOON)).toBe("think: [a, b]\n\nplan: []\n\nact: tool\n\nresult: echo({})");
  expect(JSON.parse(parsed.toString(JSON_FORMAT))).toEqual({
    think: ["a", "b"],
    plan: [],
    act: "tool",
    result: "echo({})",
  });
  expect(DEFAULT_FORMAT).toBe(TOON);
});

// ── string -> object ─────────────────────────────────────────────────────

test("TOON parses field blocks, multi-line values and bracket lists", () => {
  const parsed = SimpleResponse.parse("thinking: one\ntwo\n\nresponse: hello");
  expect(parsed.value("thinking")).toBe("one\ntwo");
  expect(parsed.value("response")).toBe("hello");

  const plan = PlanResponse.parse("think: [a, b(c, d)]\n\nsteps: [one, two]");
  expect(plan.value("think")).toEqual(["a", "b(c, d)"]);
  expect(plan.value("steps")).toEqual(["one", "two"]);
});

test("a decorated key is still the field, and its closing marker is not the value", () => {
  const parsed = SimpleResponse.parse("**Thinking:** quietly\n\n- response: out loud");
  expect(parsed.value("thinking")).toBe("quietly");
  expect(parsed.value("response")).toBe("out loud");
});

test("a list written as lines becomes one item per line, bullets stripped", () => {
  const parsed = SkillSelectResponse.parse("skills:\n- one\n2. two\n\nthink: []");
  expect(parsed.value("skills")).toEqual(["one", "two"]);
  expect(parsed.value("think")).toEqual([]);
});

test("JSON is found inside surrounding prose, and a string list field is coerced", () => {
  const parsed = PlanResponse.parse('here you go: {"think": ["t"], "steps": "[a, b]"} — done', JSON_FORMAT);
  expect(parsed.value("steps")).toEqual(["a", "b"]);
});

test("the other format is tried when the requested one finds nothing", () => {
  const parsed = ReActResponse.parse('{"act": "answer", "result": "hi"}', TOON);
  expect(parsed.value("result")).toBe("hi");
  const toon = ReActResponse.parse("act: answer\n\nresult: hi", JSON_FORMAT);
  expect(toon.value("result")).toBe("hi");
});

test("an unparseable reply becomes the answer rather than an exception", () => {
  const parsed = SimpleResponse.parse("just some prose with no fields at all");
  expect(parsed.answer).toBe("just some prose with no fields at all");
  expect(parsed.value("thinking")).toBe("");
});

test("an unparseable reply to a list-answer contract stays empty, not one long item", () => {
  const parsed = CritiqueResponse.parse("no fields here");
  expect(parsed.value("findings")).toEqual([]);
  expect(parsed.value("verdict")).toBe("revise");
});

// ── coercions fail toward the careful branch ─────────────────────────────

test("an act that is a call is rescued into result, and act becomes tool", () => {
  const parsed = ReActResponse.parse('act: echo({"text": "hi"})');
  expect(parsed.value("act")).toBe(TOOL);
  expect(parsed.value("result")).toBe('echo({"text": "hi"})');
  expect(parsed.isToolCall).toBe(true);
});

test("an act that is neither word and not a call becomes answer", () => {
  expect(new ReActResponse({ act: "finish" }).value("act")).toBe(ANSWER);
  expect(new ReActResponse({ act: "**'Tool'**" }).value("act")).toBe(TOOL);
  expect(new ReActResponse().isAnswer).toBe(true);
});

test("a rescue never overwrites a result the model already wrote", () => {
  const parsed = new ReActResponse({ act: "echo({})", result: "kept" });
  expect(parsed.value("result")).toBe("kept");
  expect(parsed.value("act")).toBe(TOOL);
});

test("unknown complexity is complex, unknown verdicts are fail and revise", () => {
  expect(new UnderstandResponse({ complexity: "medium" }).value("complexity")).toBe("complex");
  expect(new UnderstandResponse({ complexity: "'Simple'" }).value("complexity")).toBe("simple");
  expect(new VerifyResponse({ verdict: "mostly" }).value("verdict")).toBe("fail");
  expect(new VerifyResponse({ verdict: "PASS" }).value("verdict")).toBe("pass");
  expect(new CritiqueResponse({ verdict: "looks fine" }).value("verdict")).toBe("revise");
  expect(new CritiqueResponse({ verdict: "approve" }).value("verdict")).toBe("approve");
});

test("defaults are the Python's, and a response is frozen", () => {
  const verify = new VerifyResponse();
  expect(verify.value("verdict")).toBe("fail");
  expect(verify.value("checks")).toEqual([]);
  expect(Object.isFrozen(verify)).toBe(true);
});

// ── the answer field ─────────────────────────────────────────────────────

test("the answer is the last field unless ANSWER_FIELD names another", () => {
  expect(ReActResponse.answerField()).toBe("result");
  expect(SimpleResponse.answerField()).toBe("response");
  expect(VerifyResponse.answerField()).toBe("evidence");
  expect(CritiqueResponse.answerField()).toBe("findings");
  expect(new VerifyResponse({ evidence: "I saw it" }).answer).toBe("I saw it");
});

// ── the registry and the component ───────────────────────────────────────

test("every response model resolves by its frontmatter name", () => {
  expect(Object.keys(RESPONSE_MODELS)).toEqual([
    "simple",
    "react",
    "understand",
    "skill_select",
    "plan",
    "verify",
    "critique",
  ]);
  expect(getResponseModel("react")).toBe(ReActResponse);
  expect(() => getResponseModel("nope")).toThrow(
    "Unknown response model 'nope'. Known: simple, react, understand, skill_select, plan, verify, critique",
  );
});

test("the contract always applies, and with no model it is just the cue", () => {
  const bare = ResponseContract.of(null);
  expect(bare.applies()).toBe(true);
  expect(bare.render()).toBe("[ASSISTANT]:");
  expect(ResponseContract.SLOT).toBe(Slot.RESPONSE);
  expect(COMPONENTS["response"]).toBe(ResponseContract);
});

test("a rendered contract is computed once per class and format", () => {
  let renders = 0;
  class Counted extends BaseResponse {
    static FIELDS = [{ name: "reply", description: "d" }];
    static instructions(fmt = DEFAULT_FORMAT) {
      renders += 1;
      return super.instructions(fmt);
    }
  }
  ResponseContract.of(Counted, TOON);
  ResponseContract.of(Counted, TOON);
  expect(renders).toBe(1);
  ResponseContract.of(Counted, JSON_FORMAT);
  expect(renders).toBe(2);
});

test("a custom cue closes the prompt in place of the default", () => {
  const contract = ResponseContract.of(null, TOON, "[REPLY]:");
  expect(contract.render()).toBe("[REPLY]:");
  expect(contract.key()).not.toBe(ResponseContract.of(null).key());
});
