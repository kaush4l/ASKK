import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deskSnapshotTwin, readDeskSnapshot } from "./desk-reader.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "desk-reader-"));
}

describe("desk reader / snapshot version", () => {
  test("personal/memory wins, public/defaults/memory is the same structure", () => {
    const personal = tmp();
    const defaults = tmp();
    mkdirSync(join(personal, "memory"), { recursive: true });
    mkdirSync(join(defaults, "memory"), { recursive: true });
    writeFileSync(
      join(personal, "memory", "soul.md"),
      "Personal soul.",
      "utf8",
    );
    writeFileSync(join(defaults, "memory", "soul.md"), "Public soul.", "utf8");
    writeFileSync(
      join(personal, "memory", "developer.agent.md"),
      "- name: developer\n",
      "utf8",
    );
    const snap = readDeskSnapshot({
      personalDir: personal,
      defaultsDir: defaults,
      agent: "developer",
    });
    expect(snap.soul).toBe("Personal soul.");
    expect(snap.soulSource).toBe("personal");
    expect(snap.agentMeta.name).toBe("developer");
    expect(snap.agentFileSource).toBe("personal");
  });

  test("public fallback when personal is absent, legacy fallback when memory is absent", () => {
    const personal = tmp();
    const defaults = tmp();
    mkdirSync(join(defaults, "memory"), { recursive: true });
    writeFileSync(join(defaults, "memory", "soul.md"), "Public soul.", "utf8");
    const snap = readDeskSnapshot({
      personalDir: personal,
      defaultsDir: defaults,
      agent: "developer",
    });
    expect(snap.soul).toBe("Public soul.");
    expect(snap.soulSource).toBe("public");
    mkdirSync(join(personal), { recursive: true });
    writeFileSync(
      join(personal, "instructions.md"),
      "Legacy instructions.",
      "utf8",
    );
    const snap2 = readDeskSnapshot({
      personalDir: personal,
      defaultsDir: defaults,
      agent: "developer",
    });
    expect(snap2.instructions).toContain("Legacy instructions");
  });

  test("agent name is a variable, not hardcoded default", () => {
    const personal = tmp();
    const defaults = tmp();
    mkdirSync(join(personal, "memory"), { recursive: true });
    writeFileSync(
      join(personal, "memory", "reviewer.agent.md"),
      "- name: reviewer\n",
      "utf8",
    );
    const snap = readDeskSnapshot({
      personalDir: personal,
      defaultsDir: defaults,
      agent: "reviewer",
    });
    expect(snap.agent).toBe("reviewer");
    expect(snap.agentMeta.name).toBe("reviewer");
  });

  test("twin strips keys and paths", () => {
    const personal = tmp();
    const defaults = tmp();
    mkdirSync(join(personal, "memory"), { recursive: true });
    writeFileSync(
      join(personal, "memory", "model.json"),
      JSON.stringify([
        {
          id: "m1",
          provider: "p",
          endpoint: "e",
          model: "m",
          apiKey: "SECRET",
          apiKeyEnv: "K",
        },
      ]),
      "utf8",
    );
    const snap = readDeskSnapshot({
      personalDir: personal,
      defaultsDir: defaults,
      agent: "developer",
    });
    const twin = deskSnapshotTwin(snap);
    expect(JSON.stringify(twin)).not.toContain("SECRET");
    expect(JSON.stringify(twin)).not.toContain("apiKeyEnv");
    expect(JSON.stringify(twin)).not.toContain(personal);
  });
});
