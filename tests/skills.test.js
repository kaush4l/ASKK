import { test, expect } from "bun:test";

import { memoryFs } from "../core/ports/memory-fs.js";
import { catalog, loaded, loadSkills, select, Skill } from "../core/skills.js";

/** A log that keeps what it was told, so a test can prove a skip was announced. */
function collector() {
  /** @type {string[]} */
  const lines = [];
  return { warn: (/** @type {string} */ message) => void lines.push(message), lines };
}

/** @param {string} name @param {string} description @param {string} [body] @param {string} [tools] */
function skillFile(name, description, body = "Do the thing.", tools = "") {
  return `---\nname: ${name}\ndescription: ${description}\n${tools}---\n${body}\n`;
}

test("the example skill loads from the repository's own skills folder", async () => {
  const text = await Bun.file(new URL("../skills/summarize-file/SKILL.md", import.meta.url)).text();
  const fs = memoryFs({ files: { "skills/summarize-file/SKILL.md": text } });

  const found = await loadSkills(fs);

  expect(found.map((skill) => skill.name)).toEqual(["summarize-file"]);
  expect(found[0].description).toBe("Use when the user asks to condense or summarize a document or file.");
  expect(found[0].path).toBe("skills/summarize-file/SKILL.md");
  expect(found[0].body.startsWith("Read the file in full before summarizing")).toBe(true);
  expect(found[0].tools).toEqual([]);
});

test("both spellings load, and the list is sorted by name", async () => {
  const fs = memoryFs({
    files: {
      "skills/zebra/SKILL.md": skillFile("zebra", "Last alphabetically."),
      "skills/apple.md": skillFile("apple", "A bare file needs no folder."),
      "skills/middle/SKILL.md": skillFile("middle", "In between."),
    },
  });

  const found = await loadSkills(fs);

  expect(found.map((skill) => skill.name)).toEqual(["apple", "middle", "zebra"]);
  expect(found[0].path).toBe("skills/apple.md");
  expect(found[2].path).toBe("skills/zebra/SKILL.md");
});

test("a missing skills folder is an empty list, not an error", async () => {
  expect(await loadSkills(memoryFs())).toEqual([]);
});

test("a broken skill costs itself and never the load", async () => {
  const log = collector();
  const fs = memoryFs({
    files: {
      "skills/good/SKILL.md": skillFile("good", "Survives its neighbours."),
      "skills/empty-folder/README.md": "no skill here",
      "skills/nofence/SKILL.md": "name: nofence\n\nbody without frontmatter",
      "skills/unterminated/SKILL.md": "---\nname: unterminated\ndescription: no closing fence",
      "skills/nameless/SKILL.md": "---\ndescription: has no name\n---\nbody",
      "skills/undescribed/SKILL.md": skillFile("undescribed", ""),
      "skills/notes.txt": "a stray file next to the skills is not a skill",
    },
  });

  const found = await loadSkills(fs, "skills", log);

  expect(found.map((skill) => skill.name)).toEqual(["good"]);
  expect(log.lines).toContain("Skipping skill folder skills/empty-folder: no SKILL.md inside");
  expect(log.lines).toContain("Skipping skill skills/nameless/SKILL.md: frontmatter needs 'name' and 'description'");
  expect(log.lines).toContain("Skipping skill skills/undescribed/SKILL.md: frontmatter needs 'name' and 'description'");
  expect(log.lines.some((line) => line.startsWith("Skipping skill skills/nofence/SKILL.md:"))).toBe(true);
  expect(log.lines.some((line) => line.startsWith("Skipping skill skills/unterminated/SKILL.md:"))).toBe(true);
  // The stray .txt is not a skill and not a complaint either.
  expect(log.lines.some((line) => line.includes("notes.txt"))).toBe(false);
});

test("a skill may declare the tools it keeps active", async () => {
  const fs = memoryFs({ files: { "skills/t.md": skillFile("t", "Has tools.", "Body.", "tools: [read_file, write_file]\n") } });

  const [skill] = await loadSkills(fs);

  expect(skill.tools).toEqual(["read_file", "write_file"]);
});

test("select returns the chosen skills in catalog order and drops the unknown", async () => {
  const log = collector();
  const fs = memoryFs({
    files: {
      "skills/alpha.md": skillFile("alpha", "First."),
      "skills/beta.md": skillFile("beta", "Second."),
    },
  });
  const found = await loadSkills(fs);

  // Asked for in reverse; returned in catalog order.
  expect(select(found, ["beta", "alpha"]).map((skill) => skill.name)).toEqual(["alpha", "beta"]);
  // The ported check: an unknown name changes nothing about the outcome.
  expect(select(found, ["alpha", "nope"], log)).toEqual(select(found, ["alpha"]));
  expect(log.lines).toEqual(["Dropping unknown skill name(s): nope"]);
  expect(select(found, [])).toEqual([]);
});

test("catalog is one cheap line per skill and loaded is the bodies in full", () => {
  const skills = [
    new Skill({ name: "alpha", description: "First.", body: "\n  Alpha body.  \n", path: "skills/alpha.md" }),
    new Skill({ name: "beta", description: "Second.", body: "Beta body.", path: "skills/beta.md" }),
  ];

  const menu = catalog(skills);
  expect(menu.render()).toBe("## AVAILABLE SKILLS\n\n- alpha: First.\n- beta: Second.\n\n");
  expect(menu.render().includes("Alpha body.")).toBe(false);

  const full = loaded(select(skills, ["beta"]));
  expect(full.render()).toBe("## LOADED SKILLS\n\n### SKILL: beta\n\nBeta body.\n\n");
});

test("both components vanish when nothing is there", () => {
  expect(catalog([]).applies()).toBe(false);
  expect(loaded([]).applies()).toBe(false);
  expect(catalog([]).render()).toBe("");
  expect(loaded([]).render()).toBe("");
});
