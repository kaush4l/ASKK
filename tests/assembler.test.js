import { test, expect } from "bun:test";

import { Component, Slot } from "../core/component-base.js";
import {
  ContextBlock,
  CritiqueFindings,
  History,
  PhaseInstructions,
  SkillCatalog,
  Soul,
  SystemInstructions,
} from "../core/components.js";
import { AssemblyError, MEMO_LIMIT, PromptAssembler } from "../core/assembler.js";

/**
 * The RESPONSE-slot component ships with `core/responses.js` (increment 2.3),
 * which does not exist yet. This is the Python's `ResponseContract` template and
 * slot and nothing else — enough to satisfy the invariant the assembler checks.
 */
class ResponseContract extends Component {
  static SLOT = Slot.RESPONSE;
  static TEMPLATE = "{% if instructions %}{{ instructions }}\n\n{% endif %}{{ cue }}";
  static FIELDS = ["priority", "instructions", "cue"];
  static NAME = "ResponseContract";

  /** @param {{ priority?: number, instructions?: string, cue?: string }} [data] */
  constructor(data = {}) {
    super(data);
    /** @type {string} */
    this.instructions = data.instructions ?? "";
    /** @type {string} */
    this.cue = data.cue ?? "[ASSISTANT]:";
    Object.freeze(this);
  }

  applies() {
    // Always renders: even with no structured contract, the cue must close the prompt.
    return true;
  }
}

let systemRenders = 0;

/** A SystemInstructions that counts its own renders, to see the memo work. */
class CountedSystem extends SystemInstructions {
  static NAME = "CountedSystem";
  render() {
    systemRenders += 1;
    return super.render();
  }
}

// ── the three invariants: thrown, never repaired ─────────────────────────

test("invariant: missing response", () => {
  const assembler = new PromptAssembler();
  const parts = [new SystemInstructions({ text: "x" })];
  expect(() => assembler.assemble(parts)).toThrow(AssemblyError);
  expect(() => assembler.assemble(parts)).toThrow(
    "A prompt needs exactly one RESPONSE component, got 0: none",
  );
});

test("invariant: missing soul/system", () => {
  const assembler = new PromptAssembler();
  const parts = [new ResponseContract()];
  expect(() => assembler.assemble(parts)).toThrow(AssemblyError);
  expect(() => assembler.assemble(parts)).toThrow(
    "A prompt needs a SOUL or SYSTEM component — an agent must be someone.",
  );
});

test("invariant: double response", () => {
  const assembler = new PromptAssembler();
  const parts = [new SystemInstructions({ text: "x" }), new ResponseContract(), new ResponseContract()];
  expect(() => assembler.assemble(parts)).toThrow(AssemblyError);
  expect(() => assembler.assemble(parts)).toThrow(
    "A prompt needs exactly one RESPONSE component, got 2: ['ResponseContract', 'ResponseContract']",
  );
});

test("invariant: RESPONSE sorts last", () => {
  // Unreachable through the shipped Slot values — the Python verifies it anyway,
  // so a component invented with a slot past RESPONSE must still be caught.
  class Straggler extends Component {
    static SLOT = Slot.RESPONSE + 1;
    static TEMPLATE = "late\n";
    static NAME = "Straggler";
  }
  const assembler = new PromptAssembler();
  expect(() =>
    assembler.assemble([new SystemInstructions({ text: "x" }), new ResponseContract(), new Straggler()]),
  ).toThrow("Straggler sorts after the RESPONSE component.");
});

test("an AssemblyError is an Error and names itself", () => {
  const error = new AssemblyError("nope");
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("AssemblyError");
});

// ── ordering ─────────────────────────────────────────────────────────────

test("slot ordering from a shuffled input", () => {
  const assembler = new PromptAssembler();
  const prompt = assembler.assemble([
    new ResponseContract(),
    new History({ lines: ["[USER]: hi"] }),
    new PhaseInstructions({ body: "Do the thing." }),
    new ContextBlock({ facts: { day: "Saturday" } }),
    new SystemInstructions({ text: "SYS" }),
    new Soul({ text: "SOUL" }),
  ]);
  const order = ["SOUL", "SYS", "## CONTEXT", "CURRENT PHASE", "[USER]: hi", "[ASSISTANT]:"].map((m) =>
    prompt.indexOf(m),
  );
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(prompt.endsWith("[ASSISTANT]:")).toBe(true);
  expect(prompt.startsWith("SOUL")).toBe(true);
});

test("priority breaks a tie inside one slot", () => {
  const assembler = new PromptAssembler();
  const prompt = assembler.assemble([
    new CritiqueFindings({ findings: ["missed a case"] }),
    new PhaseInstructions({ body: "Plan it." }),
    new SystemInstructions({ text: "SYS" }),
    new ResponseContract(),
  ]);
  expect(prompt.indexOf("CURRENT PHASE")).toBeLessThan(prompt.indexOf("UNRESOLVED FINDINGS"));
});

test("empty components vanish and the join adds no separator", () => {
  const assembler = new PromptAssembler();
  const lean = assembler.assemble([
    new Soul({ text: "S" }),
    new SystemInstructions({ text: "" }),
    new SkillCatalog(),
    new ResponseContract(),
  ]);
  expect(lean).not.toContain("SKILLS");
  expect(lean).toBe("S\n\n[ASSISTANT]:");
});

test("a component that applies but renders empty contributes nothing", () => {
  class Silent extends SkillCatalog {
    static NAME = "Silent";
    applies() {
      return true;
    }
  }
  const assembler = new PromptAssembler();
  const prompt = assembler.assemble([new Soul({ text: "S" }), new Silent(), new ResponseContract()]);
  expect(prompt).toBe("S\n\n[ASSISTANT]:");
});

// ── memoization ──────────────────────────────────────────────────────────

test("memo is reused, bytes are stable, and context is never cached", () => {
  const assembler = new PromptAssembler();
  const parts = [
    new SystemInstructions({ text: "stable" }),
    new ContextBlock({ facts: { t: "1" } }),
    new ResponseContract({ instructions: "INSTR" }),
  ];
  const first = assembler.assemble(parts);
  const missesAfterFirst = assembler.misses;
  const second = assembler.assemble(parts);

  expect(assembler.misses).toBe(missesAfterFirst);
  expect(assembler.hits).toBeGreaterThanOrEqual(2);
  expect(first).toBe(second);

  const changed = assembler.assemble([
    new SystemInstructions({ text: "stable" }),
    new ContextBlock({ facts: { t: "2" } }),
    new ResponseContract({ instructions: "INSTR" }),
  ]);
  expect(changed).toContain("t: 2");
  expect(changed).not.toContain("t: 1");
});

test("a cacheable component renders once across turns", () => {
  systemRenders = 0;
  const assembler = new PromptAssembler();
  const system = new CountedSystem({ text: "stable" });
  const response = new ResponseContract();
  assembler.assemble([system, response]);
  assembler.assemble([system, response]);
  assembler.assemble([system, response]);
  expect(systemRenders).toBe(1);
});

test("equal keys from distinct instances share the memo", () => {
  const assembler = new PromptAssembler();
  assembler.assemble([new CountedSystem({ text: "same" }), new ResponseContract()]);
  systemRenders = 0;
  assembler.assemble([new CountedSystem({ text: "same" }), new ResponseContract()]);
  expect(systemRenders).toBe(0);
});

test("MEMO_LIMIT drops the whole memo rather than growing without bound", () => {
  expect(MEMO_LIMIT).toBe(512);
  systemRenders = 0;
  const assembler = new PromptAssembler();
  const seed = new CountedSystem({ text: "seed" });
  const response = new ResponseContract();
  const before = assembler.assemble([seed, response]);
  expect(systemRenders).toBe(1);

  // Every turn's History gets a new key; past the limit the memo is dropped whole.
  for (let i = 0; i < MEMO_LIMIT + 2; i += 1) {
    assembler.assemble([seed, new History({ lines: [`[USER]: ${i}`] }), response]);
  }
  const after = assembler.assemble([seed, response]);
  expect(after).toBe(before);
  expect(systemRenders).toBeGreaterThan(1); // the seed had to render again
});

// ── key() through the assembler ──────────────────────────────────────────

test("the same key means the same bytes, a different key does not", () => {
  expect(new SystemInstructions({ text: "a" }).key()).toBe(new SystemInstructions({ text: "a" }).key());
  expect(new SystemInstructions({ text: "a" }).key()).not.toBe(new SystemInstructions({ text: "b" }).key());
});
