import { test, expect } from "bun:test";
import { Component, Slot } from "../core/component-base.js";
import { COMPONENTS, getComponent } from "../core/component-registry.js";
import {
  ContextBlock,
  CritiqueFindings,
  History,
  LoadedSkills,
  PhaseInstructions,
  SkillCatalog,
  Soul,
  SystemInstructions,
} from "../core/components.js";

test("slot values are the prompt order", () => {
  expect([Slot.SOUL, Slot.SYSTEM, Slot.CONTEXT, Slot.SKILLS]).toEqual([0, 10, 20, 30]);
  expect([Slot.PHASE, Slot.HISTORY, Slot.TOOLS, Slot.RESPONSE]).toEqual([40, 50, 60, 99]);
  expect(Soul.SLOT).toBe(Slot.SOUL);
  expect(SystemInstructions.SLOT).toBe(Slot.SYSTEM);
  expect(ContextBlock.SLOT).toBe(Slot.CONTEXT);
  expect(SkillCatalog.SLOT).toBe(Slot.SKILLS);
  expect(LoadedSkills.SLOT).toBe(Slot.SKILLS);
  expect(PhaseInstructions.SLOT).toBe(Slot.PHASE);
  expect(CritiqueFindings.SLOT).toBe(Slot.PHASE);
  expect(History.SLOT).toBe(Slot.HISTORY);
});

test("only ContextBlock opts out of caching", () => {
  expect(ContextBlock.CACHEABLE).toBe(false);
  for (const cls of [Soul, SystemInstructions, History, PhaseInstructions, CritiqueFindings, SkillCatalog, LoadedSkills])
    expect(cls.CACHEABLE).toBe(true);
});

test("soul strips its text and vanishes when empty", () => {
  expect(new Soul({ text: "  I am here.  \n" }).render()).toBe("I am here.\n\n");
  expect(new Soul({ text: "x" }).applies()).toBe(true);
  expect(new Soul({}).applies()).toBe(false);
  expect(new Soul({ text: "   " }).applies()).toBe(false);
  // The system block is the same shape, one slot later.
  expect(new SystemInstructions({ text: "SYS" }).render()).toBe("SYS\n\n");
});

test("context indents a value that already starts on its own line", () => {
  const block = new ContextBlock({ facts: { day: "Saturday", notes: "\n  - one\n  - two", empty: "" } });
  expect(block.render()).toBe("## CONTEXT\n\nday: Saturday\nnotes:\n  - one\n  - two\n\n");
  expect(block.applies()).toBe(true);
  expect(new ContextBlock({ facts: { a: "" } }).applies()).toBe(false);
  expect(new ContextBlock({}).render()).toBe("");
});

test("history joins with a blank line between turns", () => {
  const h = new History({ lines: ["[USER]: hi", "[ASSISTANT]: hello there"] });
  expect(h.render()).toBe("[USER]: hi\n\n[ASSISTANT]: hello there\n\n");
  expect(new History({}).applies()).toBe(false);
  expect(new History({}).render()).toBe("");
});

test("history keys on the count and the lines, not the whole serialization", () => {
  const key = new History({ lines: ["a", "b"] }).key();
  expect(key.startsWith("History:2:")).toBe(true);
  expect(key).toBe(new History({ lines: ["a", "b"] }).key());
  expect(key).not.toBe(new History({ lines: ["a", "c"] }).key());
  expect(key).not.toBe(new History({ lines: ["a"] }).key());
  // A split that would join to the same words must not hash alike.
  expect(new History({ lines: ["a b", "c"] }).key()).not.toBe(new History({ lines: ["a", "b c"] }).key());
});

test("phase instructions strip the body and default the title", () => {
  expect(new PhaseInstructions({ body: "  Do the thing.  " }).render()).toBe("## CURRENT PHASE\n\nDo the thing.\n\n");
  expect(new PhaseInstructions({ title: "PLAN", body: "Write one." }).render()).toBe("## PLAN\n\nWrite one.\n\n");
  expect(new PhaseInstructions({}).render()).toBe("");
});

test("critique findings sort after the phase's own instructions", () => {
  const c = new CritiqueFindings({ findings: ["no tests", "no error path"] });
  expect(c.priority).toBe(10);
  expect(new PhaseInstructions({ body: "x" }).priority).toBe(0);
  expect(c.render()).toBe(
    "## UNRESOLVED FINDINGS\n\n" +
      "A reviewer raised these against the previous plan. Address every one.\n\n" +
      "- no tests\n- no error path\n\n",
  );
  expect(new CritiqueFindings({}).applies()).toBe(false);
});

test("the two skill components render their headings", () => {
  const catalog = new SkillCatalog({ entries: [["seo", "rank a page"], ["ops", "keep it up"]] });
  expect(catalog.render()).toBe("## AVAILABLE SKILLS\n\n- seo: rank a page\n- ops: keep it up\n\n");
  expect(new SkillCatalog({}).applies()).toBe(false);
  const loaded = new LoadedSkills({ bodies: ["### SKILL: seo\n\nbody", "### SKILL: ops\n\nbody"] });
  expect(loaded.render()).toBe("## LOADED SKILLS\n\n### SKILL: seo\n\nbody\n\n### SKILL: ops\n\nbody\n\n");
  expect(new LoadedSkills({}).render()).toBe("");
});

test("key is stable for equal fields and differs for any difference", () => {
  expect(new SystemInstructions({ text: "a" }).key()).toBe(new SystemInstructions({ text: "a" }).key());
  expect(new SystemInstructions({ text: "a" }).key()).not.toBe(new SystemInstructions({ text: "b" }).key());
  // Same fields, different class: a Soul and a SystemInstructions are not interchangeable in a memo.
  expect(new Soul({ text: "a" }).key()).not.toBe(new SystemInstructions({ text: "a" }).key());
  expect(new PhaseInstructions({ title: "A", body: "B" }).key()).not.toBe(
    new PhaseInstructions({ title: "B", body: "A" }).key(),
  );
  expect(new CritiqueFindings({ findings: ["x"] }).key()).not.toBe(new CritiqueFindings({ priority: 11, findings: ["x"] }).key());
});

test("a component is frozen — a value, not a place", () => {
  const soul = new Soul({ text: "a" });
  expect(Object.isFrozen(soul)).toBe(true);
  expect(() => {
    /** @type {any} */ (soul).text = "b";
  }).toThrow();
  const history = new History({ lines: ["a"] });
  expect(Object.isFrozen(history.lines)).toBe(true);
  // The caller's array is copied, so mutating it cannot change the key.
  const source = ["a"];
  const built = new History({ lines: source });
  const before = built.key();
  source.push("b");
  expect(built.key()).toBe(before);
});

test("templateData walks the declared FIELDS in order", () => {
  expect(Object.keys(new PhaseInstructions({ body: "x" }).templateData())).toEqual(["priority", "title", "body"]);
  expect(Object.keys(new Soul({ text: "x" }).templateData())).toEqual(["priority", "text"]);
  // ContextBlock hands the template lines it computed, not its raw facts.
  expect(Object.keys(new ContextBlock({ facts: { a: "1" } }).templateData())).toEqual(["lines"]);
});

test("the template is compiled once per class", () => {
  expect(SystemInstructions.template()).toBe(new SystemInstructions({ text: "zzz" }).template());
  expect(Soul.template()).not.toBe(SystemInstructions.template());
});

test("the registry names the eight components and getComponent lists the known ones", () => {
  expect(Object.keys(COMPONENTS)).toEqual([
    "soul",
    "system",
    "context",
    "history",
    "phase",
    "critique_findings",
    "skill_catalog",
    "loaded_skills",
  ]);
  expect(getComponent("soul")).toBe(Soul);
  expect(getComponent("critique_findings")).toBe(CritiqueFindings);
  expect(() => getComponent("nope")).toThrow(
    "Unknown component 'nope'. Known: soul, system, context, history, phase, critique_findings, skill_catalog, loaded_skills",
  );
});

test("the registry stays open for the tools and response components", () => {
  class Extra extends Component {
    static SLOT = Slot.TOOLS;
    static NAME = "Extra";
  }
  COMPONENTS["extra"] = Extra;
  expect(getComponent("extra")).toBe(Extra);
  delete COMPONENTS["extra"];
});
