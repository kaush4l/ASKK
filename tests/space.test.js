/** Spaces — the name guard, the note limit, the atomic save, and the three
 * tools that bind their author. Ported from `test_core.py`'s space checks, plus
 * the cases the port's own rulings created (a promise-keyed registry, an
 * unreadable file, a save that fails). */

import { expect, test } from "bun:test";

import { memoryFs } from "../core/ports/memory-fs.js";
import { NOTE_LIMIT, Space, clearSpaces, getSpace } from "../core/space.js";
import { Toolbox } from "../core/tools.js";

/** @param {object} [options] */
function fixture(options = {}) {
  const fs = memoryFs(options);
  return { fs, ports: { fs } };
}

test("a fresh space renders only its name and its folder", () => {
  const space = new Space("research");
  expect(space.context()).toEqual({ space: "research", workspace: "spaces/research" });
  expect(String(space)).toBe("Space('research', facts=0, notes=0)");
});

test("facts and notes render as indented blocks under their own headings", async () => {
  const { ports } = fixture();
  const space = new Space("research", null, null, { ports });
  await space.remember("scout", "target", "the harness");
  await space.post("scout", "starting  on\nthe   map");

  expect(space.context()).toEqual({
    space: "research",
    workspace: "spaces/research",
    "shared facts": "\n  target: the harness",
    // one line: the board is read inside a prompt
    "recent notes": "\n  [scout] starting on the map",
  });
});

test("context hands out copies, so a render cannot be edited into the space", () => {
  const space = new Space("research");
  const block = space.context();
  block.space = "elsewhere";
  expect(space.context().space).toBe("research");
});

test("the three writers return the exact strings the model reads", async () => {
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });

  expect(await space.remember("scout", "  target  ", "  the harness  ")).toBe(
    "Recorded in the lab space: target = the harness",
  );
  expect(await space.remember("scout", "   ", "x")).toBe("Nothing recorded: a fact needs a key.");
  expect(await space.post("scout", "  ")).toBe("Nothing posted: the note was empty.");
  expect(await space.post("scout", "found it")).toBe(
    "Posted to the lab space. Everyone working here will see it.",
  );
  expect(await space.forget("scout", "target")).toBe("Removed 'target' from the lab space.");
  expect(await space.forget("scout", "target")).toBe("No fact called 'target'. The space holds: nothing");

  await space.remember("scout", "a", "1");
  await space.remember("scout", "b", "2");
  expect(await space.forget("scout", "c")).toBe("No fact called 'c'. The space holds: a, b");
});

test("writing a key again replaces it, and does not move it", async () => {
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  await space.remember("scout", "a", "1");
  await space.remember("scout", "b", "2");
  await space.remember("scout", "a", "3");
  expect(space.context()["shared facts"]).toBe("\n  a: 3\n  b: 2");
});

test("numeric-looking fact keys keep the order they were written in", async () => {
  // The reason `facts` is a Map: a plain object hoists integer-like keys to the
  // front, which would rewrite the prompt behind the author's back.
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  await space.remember("scout", "zebra", "z");
  await space.remember("scout", "2024", "y");
  expect(space.context()["shared facts"]).toBe("\n  zebra: z\n  2024: y");
});

test("the board keeps the newest NOTE_LIMIT notes and drops the rest", async () => {
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  for (let i = 0; i < NOTE_LIMIT + 5; i += 1) await space.post("scout", `note ${i}`);

  expect(space.notes.length).toBe(NOTE_LIMIT);
  expect(space.notes[0]).toBe("[scout] note 5");
  expect(space.notes.at(-1)).toBe(`[scout] note ${NOTE_LIMIT + 4}`);
});

test("a write lands in spaces/<name>/space.json and reloads whole", async () => {
  const { fs, ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  await space.remember("scout", "target", "the harness");
  await space.post("scout", "found it");

  expect(JSON.parse(/** @type {string} */ (await fs.read("spaces/lab/space.json")))).toEqual({
    facts: { target: "the harness" },
    notes: ["[scout] found it"],
  });

  const again = await Space.load("lab", { ports });
  expect(again.facts.get("target")).toBe("the harness");
  expect(again.notes).toEqual(["[scout] found it"]);
});

test("a save that fails costs the record, not the conversation", async () => {
  /** @type {string[]} */
  const warnings = [];
  const { ports } = fixture({ fault: (/** @type {string} */ op) => (op === "rename" ? new Error("disk is full") : null) });
  const space = new Space("lab", null, null, { ports, log: { warning: (m) => warnings.push(m) } });

  expect(await space.remember("scout", "target", "the harness")).toBe(
    "Recorded in the lab space: target = the harness",
  );
  expect(space.facts.get("target")).toBe("the harness");
  expect(warnings).toEqual(["space lab: could not be saved: disk is full"]);
});

test("an unreadable or wrong-shaped space.json starts empty rather than failing", async () => {
  for (const body of ["{not json", "[1, 2]", "null", '"a string"']) {
    /** @type {string[]} */
    const errors = [];
    const { ports } = fixture({ files: { "spaces/lab/space.json": body } });
    const space = await Space.load("lab", { ports, log: { error: (m) => errors.push(m) } });
    expect(space.facts.size).toBe(0);
    expect(space.notes).toEqual([]);
    expect(errors.length).toBe(1);
  }
});

test("a stored facts value that is not an object costs the facts, not the load", async () => {
  // The Python called `.items()` on it outside the guarded block, so this took
  // the whole agent down with an AttributeError (FOUND-IN-THE-PYTHON).
  const { ports } = fixture({ files: { "spaces/lab/space.json": '{"facts": "x", "notes": "abc"}' } });
  const space = await Space.load("lab", { ports });
  expect(space.facts.size).toBe(0);
  expect(space.notes).toEqual([]);
});

test("a stored board is trimmed to the newest NOTE_LIMIT on the way in", async () => {
  const notes = Array.from({ length: NOTE_LIMIT + 3 }, (_, i) => `note ${i}`);
  const files = { "spaces/lab/space.json": JSON.stringify({ facts: { a: 1 }, notes }) };
  const space = await Space.load("lab", { ports: fixture({ files }).ports });
  expect(space.notes.length).toBe(NOTE_LIMIT);
  expect(space.notes[0]).toBe("note 3");
  expect(space.facts.get("a")).toBe("1"); // every stored value is text
});

test("a name that is not a name is refused before it becomes a path", () => {
  clearSpaces();
  for (const bad of ["../escape", "a/b", "spaces.json", "", "  ", "a b"]) {
    expect(() => getSpace(bad)).toThrow(/is not a usable space name/);
  }
  expect(() => getSpace("../escape")).toThrow(
    "'../escape' is not a usable space name — letters, digits, dashes and underscores only",
  );
});

test("every caller naming one space gets one object, even when they start together", async () => {
  clearSpaces();
  const { ports } = fixture();
  const [a, b] = await Promise.all([getSpace(" research ", { ports }), getSpace("research", { ports })]);
  expect(a).toBe(b);

  await a.remember("scout", "target", "the harness");
  expect((await getSpace("research", { ports })).context()["shared facts"]).toBe("\n  target: the harness");

  clearSpaces();
  expect(await getSpace("research", { ports })).not.toBe(a);
});

test("the three tools carry their author, their usage line and their description", async () => {
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  const box = Toolbox.of(...space.toolsFor("scout"));

  expect(box.names).toEqual(["remember", "forget", "post_note"]);
  expect(box.tools.map((t) => t.usage())).toEqual([
    'remember({"key": "<key>", "value": "<value>"}): Record a fact in the shared space, for every agent working here to see.',
    'forget({"key": "<key>"}): Remove a fact from the shared space once it is no longer true.',
    'post_note({"note": "<note>"}): Leave a note for the other agents working in this space.',
  ]);

  const posted = await box.call("post_note", { note: "found it" });
  expect(posted.ok).toBe(true);
  expect(space.notes).toEqual(["[scout] found it"]); // the author came from the binding, not the call
});

test("a tool called with the argument missing answers, rather than saying 'undefined'", async () => {
  const { ports } = fixture();
  const space = new Space("lab", null, null, { ports });
  const box = Toolbox.of(...space.toolsFor("scout"));

  expect((await box.call("remember", {})).output).toBe("Nothing recorded: a fact needs a key.");
  expect((await box.call("post_note", {})).output).toBe("Nothing posted: the note was empty.");
  expect(space.facts.size).toBe(0);
  expect(space.notes).toEqual([]);
});

test("a space with no ports still runs; it just remembers nothing across a load", async () => {
  const space = new Space("lab");
  expect(await space.remember("scout", "target", "the harness")).toBe(
    "Recorded in the lab space: target = the harness",
  );
  expect((await Space.load("lab")).facts.size).toBe(0);
});
