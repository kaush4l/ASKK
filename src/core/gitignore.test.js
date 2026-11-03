// Tests for gitignore filtering: the matcher, the files views
// (list/tree/search), and the live artifact's expand().
// Temp folders only; never the real personal/ folder.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveArtifact } from "./artifact.js";
import { clearFilesToolCache, createFilesTool } from "./files.js";
import { emptyGitignore, isIgnored, parseGitignore } from "./gitignore.js";

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

function write(dir, path, content = "x\n") {
  const file = join(dir, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
}

function toolFor(files, name) {
  return files.tools.find((tool) => tool.name === name);
}

describe("parseGitignore / isIgnored", () => {
  test("directory, file, glob, and root-anchored patterns", () => {
    const matcher = parseGitignore(
      [
        "# a comment",
        "",
        "personal/",
        "node_modules/",
        ".next/",
        "*.log",
        "/root-only.txt",
        "docs/**/*.md",
      ].join("\n"),
    );
    expect(isIgnored(matcher, "personal/memory/agent/x/state.md")).toBe(true);
    // A dir-only pattern matches a directory, not a file of that name.
    expect(isIgnored(matcher, "personal", true)).toBe(true);
    expect(isIgnored(matcher, "personal", false)).toBe(false);
    // No slash in "personal/" means it matches a directory named
    // personal at any depth (git's rule), not only at the root.
    expect(isIgnored(matcher, "src/personal/file.txt")).toBe(true);
    expect(isIgnored(matcher, "node_modules/pkg/index.js")).toBe(true);
    expect(isIgnored(matcher, "src/node_modules/pkg/index.js")).toBe(true);
    expect(isIgnored(matcher, ".next/server/app.js")).toBe(true);
    expect(isIgnored(matcher, "a.log")).toBe(true);
    expect(isIgnored(matcher, "deep/nested/b.log")).toBe(true);
    expect(isIgnored(matcher, "a.txt")).toBe(false);
    expect(isIgnored(matcher, "root-only.txt")).toBe(true);
    expect(isIgnored(matcher, "sub/root-only.txt")).toBe(false);
    expect(isIgnored(matcher, "docs/guide.md")).toBe(true);
    expect(isIgnored(matcher, "docs/deep/guide.md")).toBe(true);
    expect(isIgnored(matcher, "other/guide.md")).toBe(false);
  });

  test("** across segments, ? in a segment, later patterns win", () => {
    const matcher = parseGitignore(
      "src/**/generated/*.js\ndata/?.txt\n*.tmp\n!keep.tmp\n",
    );
    expect(isIgnored(matcher, "src/generated/a.js")).toBe(true);
    expect(isIgnored(matcher, "src/deep/generated/a.js")).toBe(true);
    expect(isIgnored(matcher, "src/other/a.js")).toBe(false);
    expect(isIgnored(matcher, "data/a.txt")).toBe(true);
    expect(isIgnored(matcher, "data/ab.txt")).toBe(false);
    expect(isIgnored(matcher, "keep.tmp")).toBe(false);
    expect(isIgnored(matcher, "other.tmp")).toBe(true);
  });

  test("negation cannot re-include a file under an ignored directory, but can under a globbed one", () => {
    const dirIgnored = parseGitignore("personal/\n!personal/keep.txt\n");
    expect(isIgnored(dirIgnored, "personal/keep.txt")).toBe(true);
    const globbed = parseGitignore("personal/*\n!personal/keep\n");
    expect(isIgnored(globbed, "personal/keep")).toBe(false);
    expect(isIgnored(globbed, "personal/other.txt")).toBe(true);
    expect(isIgnored(globbed, "personal")).toBe(false);
  });

  test("empty matcher and absent patterns ignore nothing", () => {
    expect(isIgnored(emptyGitignore(), "anything/at/all.txt")).toBe(false);
    expect(isIgnored(parseGitignore(""), "a.txt")).toBe(false);
    expect(isIgnored(parseGitignore("# only a comment\n\n"), "a.txt")).toBe(
      false,
    );
  });
});

describe("files views filter gitignored paths", () => {
  test("list/tree/search exclude ignored files and do not descend into ignored dirs", async () => {
    const dir = tempDir("askk-gitignore-");
    clearFilesToolCache();
    try {
      write(dir, ".gitignore", "personal/\nnode_modules/\n*.log\n");
      write(dir, "src/app.js", "hello marker\n");
      write(dir, "src/debug.log", "secret marker\n");
      write(dir, "personal/notes.md", "private marker\n");
      write(dir, "personal/memory/agent/default/state.md", "state marker\n");
      write(dir, "node_modules/pkg/index.js", "pkg marker\n");
      const files = createFilesTool(dir);
      const listed = await toolFor(files, "files.list").run({ path: "" });
      const names = listed.entries.map((entry) => entry.name);
      expect(names).toContain("src");
      expect(names).toContain(".gitignore");
      expect(names).not.toContain("personal");
      expect(names).not.toContain("node_modules");
      // Tree: list() refreshes it, and it must not contain ignored paths.
      expect(files.state.tree.map((entry) => entry.path)).not.toContain(
        "personal/notes.md",
      );
      expect(
        files.state.tree.some((entry) => entry.path.startsWith("node_modules")),
      ).toBe(false);
      expect(files.state.tree.map((entry) => entry.path)).toContain(
        "src/app.js",
      );
      const search = await toolFor(files, "files.search").run({
        text: "marker",
      });
      const hitPaths = search.hits.map((hit) => hit.path);
      expect(hitPaths).toContain("src/app.js");
      expect(hitPaths).not.toContain("src/debug.log");
      expect(hitPaths).not.toContain("personal/notes.md");
      expect(hitPaths).not.toContain("node_modules/pkg/index.js");
      // Explicit read by a named path is NOT gitignore-filtered.
      const explicit = await toolFor(files, "files.read").run({
        path: "src/debug.log",
      });
      expect(explicit.text).toContain("secret marker");
    } finally {
      cleanup(dir);
    }
  });

  test("absent .gitignore means no filtering and no error", async () => {
    const dir = tempDir("askk-gitignore-none-");
    clearFilesToolCache();
    try {
      write(dir, "personal/notes.md", "hi\n");
      write(dir, "a.txt", "hi\n");
      const files = createFilesTool(dir);
      const listed = await toolFor(files, "files.list").run({ path: "" });
      expect(listed.entries.map((entry) => entry.name)).toContain("personal");
      expect(files.stateForUI().gitignorePatterns).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test(".gitignore itself remains visible even when a pattern would match it", async () => {
    const dir = tempDir("askk-gitignore-self-");
    clearFilesToolCache();
    try {
      write(dir, ".gitignore", ".gitignore\npersonal/\n");
      write(dir, "a.txt", "hi\n");
      const files = createFilesTool(dir);
      const listed = await toolFor(files, "files.list").run({ path: "" });
      expect(listed.entries.map((entry) => entry.name)).toContain(".gitignore");
    } finally {
      cleanup(dir);
    }
  });
});

describe("live artifact expand filters gitignored files", () => {
  test("expand tree excludes personal/ and node_modules/, and no ignored path lands in state", async () => {
    const dir = tempDir("askk-gitignore-artifact-");
    const personalBase = tempDir("askk-gitignore-artifact-personal-");
    clearFilesToolCache();
    try {
      write(dir, ".gitignore", "personal/\nnode_modules/\n");
      write(dir, "src/app.js", "hello\n");
      write(dir, "personal/notes.md", "private\n");
      write(dir, "node_modules/pkg/index.js", "pkg\n");
      const artifact = createLiveArtifact({
        id: "default",
        location: dir,
        personalBase,
      });
      await artifact.open("src/app.js");
      const view = await artifact.expand();
      expect(view.tree.some((entry) => entry.path.startsWith("personal"))).toBe(
        false,
      );
      expect(
        view.tree.some((entry) => entry.path.startsWith("node_modules")),
      ).toBe(false);
      expect(view.tree.map((entry) => entry.path)).toContain("src/app.js");
      expect(view.openFiles.map((entry) => entry.path)).toEqual(["src/app.js"]);
    } finally {
      cleanup(dir);
      cleanup(personalBase);
    }
  });
});
