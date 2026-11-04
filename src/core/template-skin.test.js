import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplateAgentSkin, readSoulText } from "./template-skin.js";

describe("template agent skin", () => {
  test("creates agent file + empty state/history/snapshots + script folders, soul untouched", () => {
    const base = mkdtempSync(join(tmpdir(), "skin-"));
    const memory = join(base, "memory");
    mkdirSync(memory, { recursive: true });
    writeFileSync(
      join(memory, "soul.md"),
      "Original soul, do not touch.",
      "utf8",
    );
    const out = createTemplateAgentSkin({
      name: "developer",
      baseDir: base,
      role: "builds features",
      goal: "build a feature",
      tools: ["files.read"],
      keep: "desk",
    });
    expect(out.agentFile).toBe("memory/developer.agent.md");
    expect(out.soulTouched).toBe(false);
    expect(out.soulCreated).toBe(false);
    expect(readSoulText(base)).toBe("Original soul, do not touch.");
    expect(readFileSync(join(memory, "developer.agent.md"), "utf8")).toContain(
      "- name: developer",
    );
    expect(existsSync(join(memory, "agent", "developer", "state.md"))).toBe(
      true,
    );
    expect(existsSync(join(memory, "agent", "developer", "history.md"))).toBe(
      true,
    );
    expect(existsSync(join(memory, "agent", "developer", "snapshots"))).toBe(
      true,
    );
    expect(existsSync(join(memory, "scripts", "developer"))).toBe(true);
    expect(() =>
      createTemplateAgentSkin({ name: "developer", baseDir: base }),
    ).toThrow(/already exists/);
  });

  test("bad agent name refused, soul created only if absent", () => {
    const base = mkdtempSync(join(tmpdir(), "skin-"));
    expect(() =>
      createTemplateAgentSkin({ name: "Bad Name", baseDir: base }),
    ).toThrow();
    const out = createTemplateAgentSkin({ name: "reviewer", baseDir: base });
    expect(out.soulCreated).toBe(true);
    expect(readSoulText(base)).toContain("template");
  });
});
