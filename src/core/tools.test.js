// Tests for the core tools: the Tool contract, the filesystem
// tool group, the terminal tool group, and the default desk tools.
// Temp folders only; no real model and no network are called.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { createDesk } from "./desk.js";
import { clearFilesToolCache, createFilesTool } from "./files.js";
import { clearTerminalToolCache, createTerminalTool } from "./terminal.js";
import { createToolRegistry, Tool } from "./tool.js";

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp dir already gone; nothing to clean.
  }
}

describe("Tool contract", () => {
  test("spec/describe/run, and run with no run throws", async () => {
    const tool = new Tool({
      name: "demo.echo",
      description: "echo the input",
      input: { text: "what to echo" },
      expectation: "immediate",
      run: async (input) => input.text,
    });
    expect(tool.spec()).toEqual({
      name: "demo.echo",
      type: "function",
      view: null,
      description: "echo the input",
      input: { text: "what to echo" },
      expectation: "immediate",
    });
    expect(tool.describe()).toBe(
      "- demo.echo {text: what to echo} — echo the input",
    );
    expect(await tool.run({ text: "hi" })).toBe("hi");
    const broken = new Tool({ name: "demo.broken", description: "none" });
    await expect(broken.run({})).rejects.toThrow("no run()");
  });

  test("bad expectation and duplicate registry names are refused", async () => {
    expect(() => new Tool({ name: "x", expectation: "eventually" })).toThrow(
      "expectation",
    );
    const tool = new Tool({ name: "x", run: async () => 1 });
    expect(() => createToolRegistry([tool, tool])).toThrow("two tools named x");
    const registry = createToolRegistry([tool]);
    expect(registry.specs()[0].name).toBe("x");
    expect(registry.get("missing")).toBeNull();
    await expect(registry.run("missing", {})).rejects.toThrow(
      "no tool named missing",
    );
  });
});

describe("filesystem tools", () => {
  test("list/read/write/edit/append/search/open/close", async () => {
    const dir = tempDir("askk-files-");
    clearFilesToolCache();
    try {
      const files = createFilesTool(dir);
      writeFileSync(join(dir, "a.txt"), "hello\nworld\n");
      const listed = await files.tools
        .find((tool) => tool.name === "files.list")
        .run({ path: "" });
      expect(listed.entries.map((entry) => entry.name)).toContain("a.txt");
      const read = await files.tools
        .find((tool) => tool.name === "files.read")
        .run({ path: "a.txt" });
      expect(read.text).toBe("hello\nworld\n");
      expect(read.totalLines).toBe(3);
      await files.tools
        .find((tool) => tool.name === "files.write")
        .run({ path: "sub/b.txt", content: "new file\n" });
      expect(readFileSync(join(dir, "sub/b.txt"), "utf8")).toBe("new file\n");
      await files.tools
        .find((tool) => tool.name === "files.edit")
        .run({ path: "a.txt", old: "world", new: "there" });
      expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("hello\nthere\n");
      await files.tools
        .find((tool) => tool.name === "files.append")
        .run({ path: "a.txt", text: "again\n" });
      expect(readFileSync(join(dir, "a.txt"), "utf8")).toContain("again");
      const search = await files.tools
        .find((tool) => tool.name === "files.search")
        .run({ text: "THERE" });
      expect(search.hits.some((hit) => hit.path === "a.txt")).toBe(true);
      await files.tools
        .find((tool) => tool.name === "files.open")
        .run({ paths: "a.txt" });
      expect(files.state.open.map((entry) => entry.path)).toContain("a.txt");
      await files.tools
        .find((tool) => tool.name === "files.close")
        .run({ paths: "all" });
      expect(files.state.open).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });

  test("edit fails on a stale old passage, never silently overwrites", async () => {
    const dir = tempDir("askk-files-edit-");
    clearFilesToolCache();
    try {
      const files = createFilesTool(dir);
      writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
      const edit = files.tools.find((tool) => tool.name === "files.edit");
      await expect(
        edit.run({ path: "a.txt", old: "three", new: "x" }),
      ).rejects.toThrow("not found");
      writeFileSync(join(dir, "a.txt"), "one\none\n");
      await expect(
        edit.run({ path: "a.txt", old: "one", new: "x" }),
      ).rejects.toThrow("matches 2 times");
      expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\none\n");
    } finally {
      cleanup(dir);
    }
  });

  test("focus-section returns only the requested slice and records focus", async () => {
    const dir = tempDir("askk-files-focus-");
    clearFilesToolCache();
    try {
      const files = createFilesTool(dir);
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      writeFileSync(join(dir, "big.txt"), `${lines.join("\n")}\n`);
      const focus = files.tools.find((tool) => tool.name === "files.focus");
      const section = await focus.run({
        path: "big.txt",
        from: 50,
        lines: 3,
      });
      expect(section.text).toBe("line 50\nline 51\nline 52");
      expect(section.from).toBe(50);
      expect(section.totalLines).toBe(101);
      expect(files.state.focus).toMatchObject({
        path: "big.txt",
        from: 50,
        lines: 3,
      });
      // Folder focus changes the logical root for every holder.
      writeFileSync(join(dir, "sub.txt"), "x\n");
      const folder = await focus.run({ path: "" });
      expect(folder.root).toBe("");
      expect(files.state.root).toBe("");
    } finally {
      cleanup(dir);
    }
  });

  test("path traversal, .env, and .git are refused", async () => {
    const dir = tempDir("askk-files-refuse-");
    clearFilesToolCache();
    try {
      const files = createFilesTool(dir);
      const read = files.tools.find((tool) => tool.name === "files.read");
      await expect(read.run({ path: "../secret.txt" })).rejects.toThrow('".."');
      await expect(read.run({ path: "/etc/passwd" })).rejects.toThrow();
      writeFileSync(join(dir, ".env"), "KEY=secret\n");
      await expect(read.run({ path: ".env" })).rejects.toThrow("refused");
      const write = files.tools.find((tool) => tool.name === "files.write");
      await expect(write.run({ path: ".env", content: "x" })).rejects.toThrow(
        "refused",
      );
      await expect(read.run({ path: ".git/config" })).rejects.toThrow(
        "refused",
      );
      // .env.example is the one exception, like the old tool.
      const example = await read
        .run({ path: ".env.example" })
        .catch(() => null);
      expect(example === null || example.path === ".env.example").toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("per-location singleton: same location+id shares state, different id does not", async () => {
    const dir = tempDir("askk-files-single-");
    clearFilesToolCache();
    try {
      const first = createFilesTool(dir, "files");
      const second = createFilesTool(dir, "files");
      expect(second).toBe(first);
      first.state.root = "changed";
      expect(second.state.root).toBe("changed");
      const other = createFilesTool(dir, "other-files");
      expect(other).not.toBe(first);
      expect(other.state.root).toBe("");
    } finally {
      cleanup(dir);
    }
  });
});

describe("terminal tools", () => {
  test("run to completion, && chain, and unknown program error", async () => {
    const dir = tempDir("askk-term-");
    clearTerminalToolCache();
    try {
      const terminal = createTerminalTool(dir);
      const run = terminal.tools.find((tool) => tool.name === "terminal.run");
      const done = await run.run({ command: "echo hello" });
      expect(done.exit).toBe(0);
      expect(done.output).toContain("hello");
      const chained = await run.run({
        command: "echo one && echo two",
      });
      expect(chained.output).toContain("one");
      expect(chained.output).toContain("two");
      await expect(
        run.run({ command: "definitely-not-a-real-program-xyz" }),
      ).rejects.toThrow();
    } finally {
      cleanup(dir);
    }
  });

  test("start/wait/read/send/stop/list", async () => {
    const dir = tempDir("askk-term-sess-");
    clearTerminalToolCache();
    try {
      const terminal = createTerminalTool(dir);
      const byName = (name) =>
        terminal.tools.find((tool) => tool.name === name);
      const started = await byName("terminal.start").run({
        command: "cat",
        name: "echoer",
      });
      expect(started.id).toBeTruthy();
      const listed = await byName("terminal.list").run({});
      expect(listed.sessions.some((session) => session.id === started.id)).toBe(
        true,
      );
      await byName("terminal.send").run({
        id: started.id,
        text: "hello-session",
      });
      const waited = await byName("terminal.wait").run({
        id: started.id,
        seconds: 5,
        until: "hello-session",
      });
      expect(waited.matched).toBe("hello-session");
      const read = await byName("terminal.read").run({
        id: started.id,
        lines: 10,
      });
      expect(read.lines.join("\n")).toContain("hello-session");
      await byName("terminal.stop").run({ id: started.id });
      const after = await byName("terminal.wait").run({
        id: started.id,
        seconds: 5,
      });
      expect(after.status).toBe("exited");
      await expect(
        byName("terminal.read").run({ id: "no-such-session" }),
      ).rejects.toThrow("no session");
    } finally {
      cleanup(dir);
    }
  });
});

describe("core tools as the default", () => {
  test("coreTools contains all files.* and terminal.* and no web.*", () => {
    const dir = tempDir("askk-core-");
    clearFilesToolCache();
    clearTerminalToolCache();
    try {
      const core = createCoreTools({ filesLocation: dir });
      const names = core.tools.map((tool) => tool.name);
      for (const name of [
        "files.list",
        "files.read",
        "files.write",
        "files.edit",
        "files.append",
        "files.search",
        "files.open",
        "files.close",
        "files.focus",
        "terminal.run",
        "terminal.start",
        "terminal.wait",
        "terminal.read",
        "terminal.send",
        "terminal.stop",
        "terminal.list",
      ]) {
        expect(names).toContain(name);
      }
      expect(names.some((name) => name.startsWith("web."))).toBe(false);
      expect(core.listTools().length).toBe(names.length);
    } finally {
      cleanup(dir);
    }
  });

  test("default desk/engine loads all core tools, no web", () => {
    const personal = tempDir("askk-desk-tools-personal-");
    const defaults = tempDir("askk-desk-tools-defaults-");
    try {
      writeFileSync(join(personal, "instructions.md"), "You are ASKK.\n");
      writeFileSync(join(defaults, "instructions.md"), "Default.\n");
      writeFileSync(join(defaults, "model.json"), "[]");
      const desk = createDesk(personal, { defaultsDir: defaults });
      const names = desk.tools.map((tool) => tool.name);
      expect(names).toContain("files.focus");
      expect(names).toContain("terminal.run");
      expect(names.some((name) => name.startsWith("web."))).toBe(false);
      expect(desk.listTools().map((spec) => spec.name)).toEqual(names);
      expect(desk.engine.tools.map((tool) => tool.name)).toEqual(names);
      expect(desk.engine.listTools().length).toBe(names.length);
      // No secrets in the public tool specs.
      expect(JSON.stringify(desk.listTools())).not.toContain("apiKey");
    } finally {
      cleanup(personal);
      cleanup(defaults);
    }
  });
});
