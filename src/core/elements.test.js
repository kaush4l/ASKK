import { describe, expect, test } from "bun:test";
import {
  artifactElement,
  elementsToSnapshot,
  historyElement,
  modelsElement,
  renderPrompt,
  scriptsElement,
  soulElement,
  toolsElement,
  watchersElement,
} from "./elements.js";

describe("abstract elements", () => {
  test("toString converts each element to its string as it is now", () => {
    expect(soulElement("Be plain.").toString()).toBe("Be plain.");
    const tools = toolsElement([
      {
        name: "files.read",
        description: "read a file",
        input: { path: "the file" },
        expectation: "immediate",
      },
    ]);
    expect(tools.toString()).toContain("files.read {path: the file}");
    // Milestone 4: the single reader is Tool.describe(), whose
    // exact string (asserted in tools.test.js) has NO
    // [expectation] suffix — the old toolSpecToString suffix
    // was the second format, and it is gone. Expectation lives
    // in the tool spec object, not in the string.
    expect(tools.toString()).toBe(
      "- files.read {path: the file} — read a file",
    );
  });

  test("cache: unchanged object returns cached string, changed data re-renders", () => {
    const el = soulElement("One.");
    const first = el.toString();
    expect(el.toString()).toBe(first);
    el.data.text = "Two.";
    expect(el.toString()).toBe("Two.");
    el.invalidate();
    expect(el.toString()).toBe("Two.");
  });

  test("artifact, watchers, scripts, models, history render their own context only", () => {
    expect(
      artifactElement({
        id: "dev",
        open: ["a.js"],
        focus: "a.js",
        modified: [],
      }).toString(),
    ).toContain("open: a.js");
    expect(
      watchersElement([{ name: "build", status: "running" }]).toString(),
    ).toContain("build");
    expect(watchersElement([]).toString()).toContain("none");
    expect(
      scriptsElement([
        { name: "test-all", scope: "agent", kind: "shortcut" },
      ]).toString(),
    ).toContain("test-all");
    expect(modelsElement([]).toString()).toContain("none added");
    expect(historyElement(["did x"]).toString()).toContain("did x");
  });

  test("renderPrompt joins elements in order, snapshot captures all strings", () => {
    const els = [soulElement("Soul."), toolsElement([])];
    expect(renderPrompt(els)).toBe("Soul.\n\nNo tools.");
    expect(elementsToSnapshot(els)).toEqual({
      soul: "Soul.",
      tools: "No tools.",
    });
  });
});
