import { test, expect } from "bun:test";
import { compile } from "../core/template.js";

// The ten TEMPLATE strings that exist in the Python tree, copied character for
// character from core/components.py, core/responses.py and core/tools.py.
// These are the only templates this renderer will ever be asked to render.
const SOUL = "{{ text }}\n\n";
const CONTEXT = "{% if lines %}## CONTEXT\n\n{{ lines | join('\n') }}\n\n{% endif %}";
const HISTORY = "{% if lines %}{{ lines | join('\n\n') }}\n\n{% endif %}";
const PHASE = "{% if body %}## {{ title }}\n\n{{ body }}\n\n{% endif %}";
const FINDINGS =
  "{% if findings %}## UNRESOLVED FINDINGS\n\n" +
  "A reviewer raised these against the previous plan. Address every one.\n\n" +
  "{% for f in findings %}- {{ f }}\n{% endfor %}\n{% endif %}";
const CATALOG =
  "{% if entries %}## AVAILABLE SKILLS\n\n" +
  "{% for name, description in entries %}- {{ name }}: {{ description }}\n{% endfor %}\n{% endif %}";
const LOADED =
  "{% if bodies %}## LOADED SKILLS\n\n" +
  "{% for body in bodies %}{{ body }}\n\n{% endfor %}{% endif %}";
const TOOLS =
  "{% if usages %}## AVAILABLE TOOLS\n\n" +
  "{{ usages | join('\n') }}\n\n" +
  "Call them exactly as written above. Calls that do not depend on each other go on " +
  "one line, separated by commas, and run at the same time. A call that needs an earlier " +
  "call's result goes on its own line — lines run in order, top to bottom. Results come " +
  "back labelled with the tool name, in the order you wrote the calls.\n\n{% endif %}";
const CONTRACT = "{% if instructions %}{{ instructions }}\n\n{% endif %}{{ cue }}";

test("Soul keeps the trailing blank line the assembler relies on", () => {
  expect(compile(SOUL)({ text: "Sys." })).toBe("Sys.\n\n");
  expect(compile(SOUL)({ text: "You are helpful.\nBe brief." })).toBe(
    "You are helpful.\nBe brief.\n\n",
  );
});

test("ContextBlock renders the golden CONTEXT block", () => {
  const render = compile(CONTEXT);
  expect(render({ lines: ["current time: 2026-08-16 12:00:00 PDT", "day: Saturday"] })).toBe(
    "## CONTEXT\n\ncurrent time: 2026-08-16 12:00:00 PDT\nday: Saturday\n\n",
  );
  expect(render({ lines: [] })).toBe("");
});

test("History joins turns with a blank line", () => {
  const render = compile(HISTORY);
  expect(render({ lines: ["[USER]: hi", "[ASSISTANT]: hello there"] })).toBe(
    "[USER]: hi\n\n[ASSISTANT]: hello there\n\n",
  );
  expect(render({ lines: [] })).toBe("");
});

test("PhaseInstructions interpolates both fields", () => {
  const render = compile(PHASE);
  expect(render({ title: "CURRENT PHASE", body: "do it" })).toBe("## CURRENT PHASE\n\ndo it\n\n");
  expect(render({ title: "CURRENT PHASE", body: "" })).toBe("");
});

test("CritiqueFindings emits one bullet per finding", () => {
  const render = compile(FINDINGS);
  expect(render({ findings: ["a", "b"] })).toBe(
    "## UNRESOLVED FINDINGS\n\n" +
      "A reviewer raised these against the previous plan. Address every one.\n\n" +
      "- a\n- b\n\n",
  );
  expect(render({ findings: [] })).toBe("");
});

test("SkillCatalog unpacks the name/description pairs", () => {
  const render = compile(CATALOG);
  expect(render({ entries: [["a", "A"], ["b", "B"]] })).toBe(
    "## AVAILABLE SKILLS\n\n- a: A\n- b: B\n\n",
  );
  expect(render({ entries: [] })).toBe("");
});

test("LoadedSkills separates bodies and adds no extra tail", () => {
  const render = compile(LOADED);
  expect(render({ bodies: ["x", "y"] })).toBe("## LOADED SKILLS\n\nx\n\ny\n\n");
  expect(render({ bodies: [] })).toBe("");
});

test("ToolboxComponent reproduces the golden AVAILABLE TOOLS block", () => {
  const render = compile(TOOLS);
  const golden =
    "## AVAILABLE TOOLS\n\n" +
    'echo({"text": "<text>"}): Echo the text back.\n' +
    'weather({"city": "<city>"}): Report the weather for a city.\n\n' +
    "Call them exactly as written above. Calls that do not depend on each other go on one " +
    "line, separated by commas, and run at the same time. A call that needs an earlier call's " +
    "result goes on its own line — lines run in order, top to bottom. Results come back " +
    "labelled with the tool name, in the order you wrote the calls.\n\n";
  expect(
    render({
      usages: [
        'echo({"text": "<text>"}): Echo the text back.',
        'weather({"city": "<city>"}): Report the weather for a city.',
      ],
    }),
  ).toBe(golden);
  expect(render({ usages: [] })).toBe("");
});

test("ResponseContract always ends on the cue", () => {
  const render = compile(CONTRACT);
  expect(render({ instructions: "", cue: "[ASSISTANT]:" })).toBe("[ASSISTANT]:");
  expect(render({ instructions: "I", cue: "[ASSISTANT]:" })).toBe("I\n\n[ASSISTANT]:");
});

test("the golden prompts' own bytes come back out of these templates", async () => {
  const bare = await Bun.file(new URL("./golden/render-bare.prompt", import.meta.url)).text();
  const plain = await Bun.file(new URL("./golden/render-plain-text.prompt", import.meta.url)).text();
  const context = compile(CONTEXT)({
    lines: ["current time: 2026-08-16 12:00:00 PDT", "day: Saturday"],
  });
  // Each golden prompt is the concatenation of component renders with no
  // separator, so a component's bytes must appear in it verbatim.
  expect(plain).toBe(compile(SOUL)({ text: "Sys." }) + context + "[ASSISTANT]:");
  expect(bare.startsWith(compile(SOUL)({ text: "Sys." }) + context)).toBe(true);
  expect(bare.endsWith("\n\n[ASSISTANT]:")).toBe(true);
});

test("a template is compiled once and reusable across data", () => {
  const render = compile(SOUL);
  expect(render({ text: "one" })).toBe("one\n\n");
  expect(render({ text: "two" })).toBe("two\n\n");
});

test("an escaped separator and a real newline separator mean the same thing", () => {
  expect(compile("{{ xs | join('\\n') }}")({ xs: ["a", "b"] })).toBe("a\nb");
  expect(compile("{{ xs | join('\n') }}")({ xs: ["a", "b"] })).toBe("a\nb");
});

test("an absent variable renders as nothing, never as undefined", () => {
  expect(compile("[{{ missing }}]")({})).toBe("[]");
});

test("a construct outside the subset is a compile error, not a silent blank", () => {
  expect(() => compile("{% if a %}x")).toThrow("Unclosed {% if %}");
  expect(() => compile("{% endfor %}")).toThrow("Unexpected {% endfor %}");
  expect(() => compile("{% while a %}{% endwhile %}")).toThrow("Unsupported tag");
  expect(() => compile("{{ a.b }}")).toThrow("Unsupported expression");
  expect(() => compile("{{ xs | first }}")).toThrow("Unsupported expression");
});
