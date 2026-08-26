import { test, expect } from "bun:test";

import { FLOWS } from "../core/flows.js";
import {
  CRITIQUE_PROMPT, PLAN_PROMPT, RESPOND_CAVEATS, RESPOND_PROMPT, SELECT_PROMPT,
  UNDERSTAND_PROMPT, VERIFY_PROMPT, WORK_PROMPT, fill, outcomesText, planText,
} from "../core/phase-prompts.js";
import {
  CritiquePhase, PHASES, PlanPhase, ReActPhase, RespondPhase, SelectSkillsPhase,
  UnderstandPhase, VerifyPhase, WorkPhase,
} from "../core/phases.js";
import { Critique, DONE, Session, Step, StepResult } from "../core/session.js";
import { memoryFs } from "../core/ports/memory-fs.js";

const PY = "/Users/kaush/PycharmProjects/PythonProject1/core/phases.py";

/** The Python's own bytes, read back out of the source it was ported from.
 * @param {string} source @param {string} name @returns {string} */
function pyConst(source, name) {
  const block = source.match(new RegExp(`^${name} = \\(([\\s\\S]*?)\\n\\)`, "m"));
  if (!block) throw new Error(`no ${name} in ${PY}`);
  const parts = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return parts.join("").replaceAll("\\n", "\n").replaceAll('\\"', '"');
}

test("every prompt is the Python's, character for character", async () => {
  const source = await Bun.file(PY).text();
  const ported = {
    UNDERSTAND_PROMPT, SELECT_PROMPT, PLAN_PROMPT, WORK_PROMPT,
    RESPOND_PROMPT, RESPOND_CAVEATS, VERIFY_PROMPT, CRITIQUE_PROMPT,
  };
  for (const [name, text] of Object.entries(ported)) expect(text).toBe(pyConst(source, name));
});

test("fill substitutes once and never rescans what it inserted", () => {
  expect(fill("a {x} b", { x: "1" })).toBe("a 1 b");
  // A `$` in a finding is data, not a replacement pattern; a `{}` in one is not a slot.
  expect(fill("{x}", { x: "$& {x}" })).toBe("$& {x}");
});

test("plan and outcome text match the Python's shapes", () => {
  const session = new Session({ query: "q" });
  expect(outcomesText(session)).toBe("(nothing recorded)");
  session.plan = [new Step({ description: "one" }), new Step({ description: "two", status: DONE })];
  expect(planText(session)).toBe("1. [pending] one\n2. [done] two");
  session.stepResults = [
    new StepResult({ step: "one", outcome: "did it" }),
    new StepResult({ step: "two", outcome: "nope", ok: false }),
  ];
  expect(outcomesText(session)).toBe("- one: did it\n- two: nope (FAILED)");
});

test("PHASES holds the eight phases, and flows has an edge for every outcome", () => {
  expect(Object.keys(PHASES).sort()).toEqual(
    ["critique", "plan", "react", "respond", "select_skills", "understand", "verify", "work"],
  );
  for (const [name, edges] of Object.entries(FLOWS.full.edges)) {
    const declared = /** @type {any} */ (PHASES[name].constructor).OUTCOMES;
    expect([...declared].sort()).toEqual(Object.keys(edges).sort());
  }
});

// ── the fake agent ───────────────────────────────────────────────────────

/** Records what each phase asked for and answers with canned replies.
 * @param {string[]} [replies]
 * @param {{ maxRounds?: number, fs?: import("../core/ports.js").FsPort }} [options]
 * @returns {any} */
function fakeAgent(replies = [], options = {}) {
  /** @type {any[]} */
  const calls = [];
  /** everything `agent.log.warning` was told, so a test can prove a diagnostic is reachable @type {string[]} */
  const warnings = [];
  return {
    name: "t",
    maxRounds: options.maxRounds ?? 3,
    skillsDir: "skills",
    verifier: null,
    critic: null,
    ports: { fs: options.fs ?? memoryFs() },
    log: { info() {}, warning: (/** @type {string} */ m) => void warnings.push(m) },
    warnings,
    calls,
    /** @param {any} components @param {any} model @param {boolean} tools @param {boolean} record */
    async turn(components, model, tools, record) {
      calls.push({ kind: "turn", components, tools, record });
      return model.parse(replies.shift() ?? "");
    },
    /** @param {any} components */
    async reactLoop(components) {
      calls.push({ kind: "reactLoop", components });
      return { answer: replies.shift() ?? "" };
    },
    /** @param {any} reviewer @param {string} prompt */
    async consult(reviewer, prompt) {
      calls.push({ kind: "consult", reviewer, prompt });
      return replies.shift() ?? "";
    },
  };
}

test("understand routes on complexity and records nothing", async () => {
  const agent = fakeAgent(["complexity: simple\n\nenhanced_query:  sharper  "]);
  const session = new Session({ query: "hi" });
  expect(await new UnderstandPhase().run(agent, session)).toBe("simple");
  expect(session.enhanced).toBe("sharper");
  expect(agent.calls[0]).toMatchObject({ tools: false, record: false });

  const careful = fakeAgent(["complexity: banana"]);
  expect(await new UnderstandPhase().run(careful, new Session({ query: "hi" }))).toBe("complex");
});

test("select_skills makes no call when there are no skills on disk", async () => {
  const agent = fakeAgent(["skills: [a]"]);
  expect(await new SelectSkillsPhase().run(agent, new Session())).toBe("done");
  expect(agent.calls).toEqual([]);
});

test("select_skills loads only what the model named", async () => {
  const fs = memoryFs();
  await fs.write("skills/one/SKILL.md", "---\nname: one\ndescription: first\n---\nbody one\n");
  await fs.write("skills/two/SKILL.md", "---\nname: two\ndescription: second\n---\nbody two\n");
  const agent = fakeAgent(["skills: [two, nonesuch]"], { fs });
  const session = new Session();
  expect(await new SelectSkillsPhase().run(agent, session)).toBe("done");
  expect(session.skills.map((s) => /** @type {any} */ (s).name)).toEqual(["two"]);
});

// Wave 4.6: `loadSkills` and `select` take an optional log and were called without one, so
// three warnings the Python emits by default (`skills.py:154,182,197`) could not be reached
// from here at all. These are what tell a user why a hand-written skill vanished.
test("select_skills puts the skill loader's three warnings on the agent's log", async () => {
  const fs = memoryFs();
  await fs.write("skills/good/SKILL.md", "---\nname: good\ndescription: fine\n---\nbody\n");
  await fs.write("skills/lonely/notes.md", "no SKILL.md here");
  await fs.write("skills/nameless/SKILL.md", "---\ndescription: no name\n---\nbody\n");
  const agent = fakeAgent(["skills: [good, nonesuch]"], { fs });

  expect(await new SelectSkillsPhase().run(agent, new Session())).toBe("done");

  expect(agent.warnings).toEqual([
    "Skipping skill folder skills/lonely: no SKILL.md inside",
    "Skipping skill skills/nameless/SKILL.md: frontmatter needs 'name' and 'description'",
    "Dropping unknown skill name(s): nonesuch",
  ]);
});

test("an empty plan is a planner failure, and the findings it answered are spent", async () => {
  const agent = fakeAgent(["steps: []"]);
  const session = new Session({ query: "the task" });
  session.critiques.push(new Critique({ finding: "wrong", severity: "blocking" }));
  session.stepResults.push(new StepResult({ step: "stale", outcome: "old" }));
  expect(await new PlanPhase().run(agent, session)).toBe("done");
  expect(session.plan.map((s) => s.description)).toEqual(["the task"]);
  expect(session.stepResults).toEqual([]);
  expect(session.unresolved).toEqual([]);
  expect(agent.calls[0].record).toBe(false);
});

test("work runs each pending step as its own react loop and checks it off", async () => {
  const agent = fakeAgent([" did one ", "did three"]);
  const session = new Session({ query: "goal" });
  session.plan = [
    new Step({ description: "one" }),
    new Step({ description: "two", status: DONE }),
    new Step({ description: "three" }),
  ];
  expect(await new WorkPhase().run(agent, session)).toBe("done");
  expect(agent.calls.map((/** @type {any} */ c) => c.kind)).toEqual(["reactLoop", "reactLoop"]);
  expect(session.stepResults.map((r) => [r.step, r.outcome])).toEqual([["one", "did one"], ["three", "did three"]]);
  expect(session.plan.every((s) => s.status === DONE)).toBe(true);
});

test("verify passes, retries with a prefixed blocking finding, then gives up", async () => {
  const passing = fakeAgent(["verdict: pass\n\nevidence: it holds"]);
  const session = new Session();
  expect(await new VerifyPhase().run(passing, session)).toBe("pass");
  expect(session.verifyReport).toContain("it holds");

  const failing = fakeAgent(["verdict: fail\n\nevidence: broken"]);
  expect(await new VerifyPhase().run(failing, session)).toBe("retry");
  expect(session.round).toBe(1);
  expect(session.critiques.at(-1)).toMatchObject({ finding: "verifier: broken", severity: "blocking" });

  session.round = 3;
  const spent = fakeAgent(["verdict: fail\n\nevidence: still broken"]);
  expect(await new VerifyPhase().run(spent, session)).toBe("exhausted");
  expect(session.round).toBe(3);
});

test("critique splits severity on the first colon and routes on the verdict", async () => {
  const agent = fakeAgent(["findings: [blocking: the schema: wrong, minor: a typo, unlabelled]\n\nverdict: revise"]);
  const session = new Session();
  expect(await new CritiquePhase().run(agent, session)).toBe("retry");
  expect(session.critiques.map((c) => [c.severity, c.finding])).toEqual([
    ["blocking", "the schema: wrong"],
    ["minor", "a typo"],
    ["minor", "unlabelled"],
  ]);
  expect(session.round).toBe(1);

  const clean = fakeAgent(["findings: [minor: nit]\n\nverdict: revise"]);
  expect(await new CritiquePhase().run(clean, new Session())).toBe("done");

  const spent = new Session({ round: 3 });
  const blocked = fakeAgent(["findings: [blocking: still wrong]\n\nverdict: revise"]);
  expect(await new CritiquePhase().run(blocked, spent)).toBe("exhausted");
});

test("respond records, and states what is still unresolved", async () => {
  const agent = fakeAgent(["response: here you go"]);
  const session = new Session({ query: "task" });
  session.critiques.push(new Critique({ finding: "left over", severity: "blocking" }));
  expect(await new RespondPhase().run(agent, session)).toBe("done");
  const [call] = agent.calls;
  expect(call.record).toBe(true);
  expect(call.components[0].body).toContain("Unresolved reviewer findings");
  expect(call.components[0].body).toContain("- left over");

  const quiet = fakeAgent(["response: done"]);
  await new RespondPhase().run(quiet, new Session({ query: "task" }));
  expect(quiet.calls[0].components[0].body).not.toContain("Unresolved reviewer findings");
});

test("react is the bare loop", async () => {
  const agent = fakeAgent(["answered"]);
  expect(await new ReActPhase().run(agent, new Session())).toBe("done");
  expect(agent.calls).toEqual([{ kind: "reactLoop", components: [] }]);
});
