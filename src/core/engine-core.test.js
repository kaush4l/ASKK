import { describe, expect, test } from "bun:test";
import { loadEngineByName } from "./engine-by-name.js";
import {
  ENGINE_ELEMENTS,
  defineEngineElements,
  resolveEngineElement,
  validateEngine,
} from "./engine-core.js";

const EXPECTED_IDS = [
  "agent",
  "instructions",
  "tools",
  "artifacts",
  "goal",
  "state",
  "history",
  "skills",
  "scripts",
  "watchers",
  "children",
  "activity",
];

describe("engine-core schema", () => {
  test("developer engine lists every element with attributes", () => {
    const engine = loadEngineByName("developer");
    const elements = defineEngineElements(engine);
    expect(elements.map((element) => element.id)).toEqual(EXPECTED_IDS);
    for (const element of elements) {
      expect(element.attributes.length).toBeGreaterThan(0);
      expect(typeof element.source).toBe("string");
      expect(element.source.length).toBeGreaterThan(0);
    }
    const tools = elements.find((element) => element.id === "tools");
    expect(tools.present).toBe(true);
    expect(resolveEngineElement(engine, "tools").length).toBe(8);
  });

  test("schema is the single list: same ids for an engine-object-shaped engine", () => {
    const engine = {
      agent: { name: "default", role: "desk agent" },
      elementStrings: () => ({ instructions: "do the work" }),
      tools: [{ name: "tool-a", description: "a" }],
      artifacts: [{ id: "art-1" }],
      goal: { snapshot: () => ({ id: "g1", statement: "ship it", status: "open" }) },
      state: { snapshot: () => ({ activity: "idle" }) },
      history: ["did a thing"],
      skills: [],
      children: [],
    };
    const elements = defineEngineElements(engine);
    expect(elements.map((element) => element.id)).toEqual(EXPECTED_IDS);
    expect(validateEngine(engine)).toBe(true);
    expect(resolveEngineElement(engine, "instructions").text).toBe("do the work");
    expect(resolveEngineElement(engine, "goal").snapshot().statement).toBe("ship it");
  });

  test("optional elements are listed even when absent, required ones validate", () => {
    const engine = {
      name: "plain",
      instructions: "be helpful",
      tools: [],
      liveState: { state: "", history: "" },
    };
    const elements = defineEngineElements(engine);
    expect(elements.find((e) => e.id === "artifacts").present).toBe(false);
    expect(elements.find((e) => e.id === "children").present).toBe(false);
    expect(validateEngine(engine)).toBe(true);
  });

  test("validateEngine throws plainly on a missing required element", () => {
    expect(() => validateEngine({})).toThrow(/missing required element "agent"/);
    expect(() =>
      validateEngine({ name: "x", tools: [], liveState: {} }),
    ).toThrow(/missing required element "instructions"/);
    expect(() =>
      validateEngine({ name: "x", instructions: "y", liveState: {} }),
    ).toThrow(/missing required element "tools"/);
    expect(() =>
      validateEngine({ name: "x", instructions: "y", tools: [] }),
    ).toThrow(/missing required element "state"/);
    expect(() => validateEngine(null)).toThrow(/needs an engine object/);
    expect(() => defineEngineElements(null)).toThrow(/needs an engine object/);
  });

  test("ENGINE_ELEMENTS carries no tool names or model defaults", () => {
    const text = JSON.stringify(ENGINE_ELEMENTS);
    expect(text).not.toContain("files.");
    expect(text).not.toContain("terminal.");
    expect(text).not.toContain("model");
  });
});
