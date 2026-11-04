import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runLoop } from "./loop.js";
import { gatePassed, loadSkillPhase, parseSkill } from "./skills.js";
import { Tool } from "./tool.js";

describe("skills as a phase", () => {
  test("review skill loads from public defaults templates as a phase object", () => {
    const phase = loadSkillPhase(
      {
        personalDir: null,
        defaultsDir: join(process.cwd(), "public/defaults"),
      },
      "review",
    );
    expect(phase.id).toBe("review");
    expect(phase.duty).toContain("review a change");
    expect(phase.allowedTools).toEqual([
      "files.read",
      "files.list",
      "files.search",
    ]);
    expect(phase.exitGate).toBeNull();
    expect(phase.kind).toBe("skill-phase");
    expect(phase.instructions).toContain("Review only");
    expect(gatePassed(phase.exitGate)).toBe(true);
    expect(gatePassed({ passed: false })).toBe(false);
    expect(gatePassed(() => true)).toBe(true);
  });

  test("a skill phase runs through the loop with only its tools (mocked model)", async () => {
    const phase = loadSkillPhase(
      {
        personalDir: null,
        defaultsDir: join(process.cwd(), "public/defaults"),
      },
      "review",
    );
    const tools = [
      new Tool({
        name: "files.read",
        description: "read",
        input: {},
        run: async () => "content",
      }),
      new Tool({
        name: "files.edit",
        description: "edit",
        input: {},
        run: async () => "edited",
      }),
    ];
    const inference = {
      infer: async () => "verdict: change looks correct",
    };
    const { runPhase } = await import("./loop.js");
    const result = await runPhase(phase, {
      registry: tools,
      inference,
      prompt: "review this change",
    });
    expect(result.phase).toBe("review");
    expect(result.answer).toContain("verdict");
    expect(result.toolsAvailable).toEqual(["files.read"]);
    expect(result.toolsAvailable).not.toContain("files.edit");
  });

  test("parseSkill keeps absent fields absent, never invents behaviour", () => {
    const parsed = parseSkill("- id: minimal\n\nJust instructions.");
    expect(parsed.duty).toBe("");
    expect(parsed.allowedTools).toEqual([]);
    expect(parsed.exitGate).toBeNull();
    expect(parsed.body).toBe("Just instructions.");
  });
});
