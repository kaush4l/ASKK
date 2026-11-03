// Tests for the live artifact: create/expand/twin, delegation to
// files state, state.md round-trip, history.md append + parse
// round-trip, load-from-disk round-trip, and refusal inheritance.
// Temp folders only — never the real personal/ folder. No model,
// no network.
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistoryEntry,
  createLiveArtifact,
  loadLiveArtifact,
  parseHistoryEntries,
  parseStateMarkdown,
  stateToMarkdown,
} from "./artifact.js";
import { createFilesTool } from "./files.js";

let counter = 0;
function setup() {
  counter += 1;
  const location = mkdtempSync(join(tmpdir(), `askk-art-loc-${counter}-`));
  const personal = mkdtempSync(join(tmpdir(), `askk-art-per-${counter}-`));
  writeFileSync(
    join(location, "a.txt"),
    Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"),
  );
  writeFileSync(join(location, "b.txt"), "hello\nworld\n");
  const files = createFilesTool(location, `art-${counter}`);
  return { location, personal, files };
}

function cleanup({ location, personal }) {
  rmSync(location, { recursive: true, force: true });
  rmSync(personal, { recursive: true, force: true });
}

describe("create / expand / twin", () => {
  test("expand returns open files with bounded previews and live state", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("a.txt");
      const view = await artifact.expand();
      expect(view.id).toBe("default");
      expect(view.openFiles).toHaveLength(1);
      expect(view.openFiles[0].path).toBe("a.txt");
      expect(view.openFiles[0].preview).toContain("line 1");
      expect(view.openFiles[0].truncated).toBe(false);
      const twin = artifact.twin();
      expect(twin.element).toBe("artifact");
      expect(twin.kind).toBe("live-artifact");
      expect(twin.expectation).toBe("live-state");
      expect(twin.open).toEqual(["a.txt"]);
      expect(JSON.stringify(twin)).not.toContain(ctx.location);
      expect(typeof twin.state).toBe("undefined");
    } finally {
      cleanup(ctx);
    }
  });

  test("expand reflects an external file change on re-read", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("b.txt");
      writeFileSync(join(ctx.location, "b.txt"), "changed externally\n");
      const view = await artifact.expand();
      expect(view.openFiles[0].preview).toContain("changed externally");
    } finally {
      cleanup(ctx);
    }
  });

  test("expand bounds a very large file and says so", async () => {
    const ctx = setup();
    try {
      writeFileSync(
        join(ctx.location, "big.txt"),
        Array.from({ length: 500 }, (_, i) => `row ${i}`).join("\n"),
      );
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("big.txt");
      const view = await artifact.expand();
      expect(view.openFiles[0].totalLines).toBe(500);
      expect(view.openFiles[0].truncated).toBe(true);
      expect(view.openFiles[0].preview.split("\n").length).toBeLessThanOrEqual(
        120,
      );
    } finally {
      cleanup(ctx);
    }
  });
});

describe("delegation to files state", () => {
  test("open/close/focus change the shared files state", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("a.txt");
      expect(ctx.files.state.open.map((e) => e.path)).toEqual(["a.txt"]);
      await artifact.focus("a.txt", 3, 2);
      expect(ctx.files.state.focus.path).toBe("a.txt");
      expect(ctx.files.state.focus.from).toBe(3);
      await artifact.close("a.txt");
      expect(ctx.files.state.open).toEqual([]);
      const read = await artifact.read("b.txt");
      expect(read.text).toContain("hello");
      const listed = await artifact.list();
      expect(listed.entries.map((e) => e.name)).toContain("a.txt");
    } finally {
      cleanup(ctx);
    }
  });

  test("write/edit/append delegate and are recorded in modified", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.write("c.txt", "one\n");
      await artifact.edit("c.txt", "one", "two");
      await artifact.append("c.txt", "three\n");
      expect(readFileSync(join(ctx.location, "c.txt"), "utf8")).toBe(
        "two\nthree\n",
      );
      expect(ctx.files.state.modified.map((e) => e.path)).toContain("c.txt");
    } finally {
      cleanup(ctx);
    }
  });

  test("traversal and .env refusal are inherited from files", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await expect(artifact.open("../outside.txt")).rejects.toThrow();
      await expect(artifact.open(".env")).rejects.toThrow();
      await expect(artifact.open("/etc/passwd")).rejects.toThrow();
    } finally {
      cleanup(ctx);
    }
  });
});

describe("state.md round-trip", () => {
  test("stateToMarkdown -> parseStateMarkdown keeps id, root, open, focus, modified", () => {
    const state = {
      id: "default",
      root: "",
      tree: [],
      open: [
        { path: "a.txt", at: null, lines: 10 },
        { path: "b.txt", at: null, lines: 2 },
      ],
      focus: { path: "a.txt", from: 3, lines: 2 },
      modified: [{ path: "b.txt", op: "edit", at: null }],
    };
    const md = stateToMarkdown(state, { "a.txt": "line 1\nline 2\n" });
    expect(md).toContain("# Live artifact: default");
    expect(md).toContain("## Open files");
    expect(md).toContain("## Modified files");
    expect(md).toContain("## Open file previews");
    const parsed = parseStateMarkdown(md);
    expect(parsed.id).toBe("default");
    expect(parsed.root).toBe("");
    expect(parsed.open).toEqual([
      { path: "a.txt", lines: 10 },
      { path: "b.txt", lines: 2 },
    ]);
    expect(parsed.focus).toEqual({ path: "a.txt", from: 3, lines: 2 });
    expect(parsed.modified).toEqual([{ path: "b.txt", op: "edit" }]);
  });
});

describe("history.md append + parse round-trip", () => {
  test("appended entries parse back in order, exactly in the standard format", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-art-hist-"));
    try {
      appendHistoryEntry(dir, {
        action: "files.open",
        agent: "default",
        path: "src/core/tool.js",
        detail: "opened, 120 lines",
        timestamp: "2026-11-03T22:15:00.000Z",
      });
      appendHistoryEntry(dir, {
        action: "artifact.expand",
        agent: "default",
        detail: "expanded, 1 open files",
        timestamp: "2026-11-03T22:16:00.000Z",
      });
      const text = readFileSync(join(dir, "history.md"), "utf8");
      expect(text).toContain("## 2026-11-03T22:15:00.000Z · files.open");
      expect(text).toContain("- agent: default");
      expect(text).toContain("- path: src/core/tool.js");
      expect(text).toContain("- detail: opened, 120 lines");
      const entries = parseHistoryEntries(text);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        timestamp: "2026-11-03T22:15:00.000Z",
        action: "files.open",
        agent: "default",
        path: "src/core/tool.js",
        detail: "opened, 120 lines",
      });
      expect(entries[1].action).toBe("artifact.expand");
      expect(entries[1]).not.toHaveProperty("path");
      // Re-parsing the re-serialised entries is stable.
      expect(
        parseHistoryEntries(
          entries
            .map((e) => {
              const lines = [`## ${e.timestamp} · ${e.action}`];
              lines.push(`- agent: ${e.agent}`);
              if (e.path) lines.push(`- path: ${e.path}`);
              lines.push(`- detail: ${e.detail}`);
              return lines.join("\n");
            })
            .join("\n"),
        ),
      ).toEqual(entries);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("save -> fresh load round-trip", () => {
  test("a fresh files instance restores open/focus/history from disk", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("a.txt");
      await artifact.focus("a.txt", 2, 3);
      await artifact.expand();
      const stateMd = readFileSync(
        join(ctx.personal, "memory", "agent", "default", "state.md"),
        "utf8",
      );
      const historyMd = readFileSync(
        join(ctx.personal, "memory", "agent", "default", "history.md"),
        "utf8",
      );
      // Saved markdown carries logical paths only — never the
      // absolute temp location, never a key.
      expect(stateMd).not.toContain(ctx.location);
      expect(historyMd).not.toContain(ctx.location);
      expect(stateMd).not.toContain("API_KEY");
      expect(historyMd).not.toContain("API_KEY");
      expect(parseHistoryEntries(historyMd).map((e) => e.action)).toEqual([
        "artifact.create",
        "files.open",
        "files.focus",
        "artifact.expand",
      ]);
      // Fresh load: a DIFFERENT files instance over the same disk,
      // so nothing is shared in memory — only the saved md restores it.
      const freshFiles = createFilesTool(ctx.location, `art-${counter}-load`);
      const loaded = loadLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: freshFiles,
        personalBase: ctx.personal,
      });
      expect(loaded.state().open.map((e) => e.path)).toEqual(["a.txt"]);
      expect(loaded.state().focus.path).toBe("a.txt");
      expect(loaded.state().focus.from).toBe(2);
      expect(loaded.history().map((e) => e.action)).toEqual([
        "artifact.create",
        "files.open",
        "files.focus",
        "artifact.expand",
      ]);
      // Loading again writes no duplicate create entry.
      loadLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: freshFiles,
        personalBase: ctx.personal,
      });
      expect(
        parseHistoryEntries(
          readFileSync(
            join(ctx.personal, "memory", "agent", "default", "history.md"),
            "utf8",
          ),
        ).filter((e) => e.action === "artifact.create"),
      ).toHaveLength(1);
    } finally {
      cleanup(ctx);
    }
  });

  test("load with no saved state starts empty and writes nothing until a change", async () => {
    const ctx = setup();
    try {
      const loaded = loadLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      expect(loaded.state().open).toEqual([]);
      expect(loaded.history()).toEqual([]);
      expect(existsSync(join(ctx.personal, "memory", "agent", "default"))).toBe(
        false,
      );
      await loaded.open("b.txt");
      expect(
        existsSync(
          join(ctx.personal, "memory", "agent", "default", "state.md"),
        ),
      ).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  test("plain reads/lists are not recorded in history", async () => {
    const ctx = setup();
    try {
      const artifact = createLiveArtifact({
        id: "default",
        location: ctx.location,
        filesTool: ctx.files,
        personalBase: ctx.personal,
      });
      await artifact.open("a.txt");
      await artifact.read("b.txt");
      await artifact.list();
      const actions = artifact.history().map((e) => e.action);
      expect(actions).toEqual(["artifact.create", "files.open"]);
    } finally {
      cleanup(ctx);
    }
  });
});
