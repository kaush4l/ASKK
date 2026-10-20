// Practice (backend/kernel/builtin/practice.js, 2026-10-20): an agent's standing orders it keeps and improves — the run
// checklist from its file, a gate while an item is open, edits with a changelog, the retro that refuses an unbacked
// "changed", the file written through its store.

import { describe, expect, test } from "bun:test"
import { buildDesk, builtinKit, parsePractice, Practice, renderPractice } from "../index.js"

const clock = () => new Date("2026-10-20T13:00:00Z")
const cmd = (p, name, input, agent = "lead") => p.commands().find((t) => t.name === `${p.name}.${name}`)._run(input, { agent: { name: agent } })

// A store over one text in memory, with the retro log and a seed.
function memStore(text = null, seed = null) {
  const s = { text, retros: [], writes: 0, where: "memory/desk/practice/lead.md" }
  return Object.assign(s, { read: () => s.text, write: (t) => ((s.text = t), s.writes++), seed: () => seed, retro: (e) => s.retros.push(e) })
}

const SEED = "# lead practice\n\n## Checklist\n- !outlook: desk.outlook written from today's tools\n- board: five rows set\n\n## Quality\n- every number names its tool\n\n## Instructions\n\n## Lessons\n- 2026-10-19 a stale outlook cost a row\n\n## Tools\n\n## Changelog\n"

describe("Practice", () => {
  test("the run checklist comes from the file, reflect last; the gate waits while one is open", () => {
    const p = new Practice({ id: "lead.practice", owner: "lead", store: memStore(SEED), clock })
    expect(p.state.run.map((i) => [i.id, i.required, i.status])).toEqual([["outlook", true, "open"], ["board", false, "open"], ["reflect", true, "open"]])
    expect(p.gate()).toContain("practice checklist open: outlook, board, reflect")
    expect(() => cmd(p, "skip", { id: "outlook", reason: "x" })).toThrow("outlook is required")
    expect(() => cmd(p, "tick", { id: "outlook" })).toThrow("evidence is required")
    expect(cmd(p, "tick", { id: "outlook", evidence: "view at 08:45, p 0.6" })).toBe("outlook ticked; 2 open: board, reflect")
    expect(cmd(p, "skip", { id: "board", reason: "after the close" })).toBe("board skipped; 1 open: reflect")
    expect(() => cmd(p, "tick", { id: "reflect", evidence: "x" })).toThrow("reflect closes with lead.practice.reflect")
    expect(p.brief()).toBe("2/3 done · 1 lessons · rev 0")
  })

  test("edit: add, replace, remove — each with why, logged; checklist ids unique; a full section refuses", () => {
    const store = memStore(SEED)
    const p = new Practice({ id: "lead.practice", owner: "lead", store, clock })
    expect(() => cmd(p, "edit", { section: "quality", new: "x" })).toThrow("why is required")
    expect(() => cmd(p, "edit", { section: "nope", new: "x", why: "y" })).toThrow('section "nope"')
    expect(cmd(p, "edit", { section: "quality", new: "a catalyst due today has an if-then", why: "CPI landed unplanned" })).toBe('lead.practice: quality + "a catalyst due today has an if-then"')
    expect(cmd(p, "edit", { section: "checklist", old: "board", new: "!board: five rows, each with trigger and p", why: "rows came without p" })).toContain("checklist ~")
    expect(() => cmd(p, "edit", { section: "checklist", new: "outlook: again", why: "w" })).toThrow("checklist id outlook exists")
    expect(() => cmd(p, "edit", { section: "checklist", new: "reflect: twice", why: "w" })).toThrow("reflect is every run's last item already")
    expect(cmd(p, "edit", { section: "lessons", new: "flow surges without a trigger fade", why: "3 of 3 faded" })).toContain('lessons + "2026-10-20 flow surges')
    expect(cmd(p, "edit", { section: "lessons", old: "stale outlook", why: "superseded" })).toContain("lessons -")
    expect(() => cmd(p, "edit", { section: "lessons", old: "nothing like this", why: "w" })).toThrow("no line")
    // The checklist edit waits for the next run; the file has it now, with the changelog.
    expect(p.state.run.find((i) => i.id === "board").required).toBe(false)
    const file = parsePractice(store.text)
    expect(file.checklist).toEqual(["!outlook: desk.outlook written from today's tools", "!board: five rows, each with trigger and p"])
    expect(file.quality).toEqual(["every number names its tool", "a catalyst due today has an if-then"])
    expect(file.lessons).toEqual(["2026-10-20 flow surges without a trigger fade"])
    expect(file.changelog).toHaveLength(4)
    expect(file.changelog[0]).toBe('2026-10-20T13:00 lead: quality + "a catalyst due today has an if-then" — CPI landed unplanned')
    expect(p.state.revision).toBe(4)
    p.onRunStart()
    expect(p.state.run.find((i) => i.id === "board")).toMatchObject({ required: true, status: "open" })
    for (let k = 0; k < 12; k++) cmd(p, "edit", { section: "tools", new: `tool ${k}`, why: "w" })
    expect(() => cmd(p, "edit", { section: "tools", new: "one more", why: "w" })).toThrow("tools is full (12 lines)")
  })

  test("reflect: all three fields; 'changed' without an edit refused; the retro log gets the entry and reflect ticks", () => {
    const store = memStore(SEED)
    const p = new Practice({ id: "lead.practice", owner: "lead", store, clock })
    expect(() => cmd(p, "reflect", { worked: "x", missed: "y" })).toThrow("worked, missed and changes are all required")
    expect(() => cmd(p, "reflect", { worked: "x", missed: "no catalyst plan", changes: "added a quality line" })).toThrow("none were made this run")
    expect(() => cmd(p, "reflect", { worked: "x", missed: "y", changes: "none" })).toThrow('"none: <why nothing changes>"')
    expect(cmd(p, "reflect", { worked: "outlook held", missed: "none", changes: "none: the run met every bar" })).toBe("reflected (0 edits this run); 2 open: outlook, board")
    expect(store.retros[0]).toContain("## 2026-10-20T13:00 lead\n- worked: outlook held\n- missed: none\n- changes: none: the run met every bar (0 edits)")
    cmd(p, "edit", { section: "quality", new: "q", why: "w" })
    expect(cmd(p, "reflect", { worked: "a", missed: "b", changes: "added q" })).toContain("reflected (1 edit this run)")
    expect(p.state.run.at(-1)).toMatchObject({ id: "reflect", status: "ticked" })
    expect(p.state.retros).toHaveLength(2)
  })

  test("a write the store refuses: the edit says NOT SAVED and holds this run; the next save writes it", () => {
    const store = memStore(SEED)
    let full = true
    const write = store.write
    store.write = (t) => {
      if (full) throw new Error("storage full")
      return write(t)
    }
    const p = new Practice({ id: "lead.practice", owner: "lead", store, clock })
    expect(cmd(p, "edit", { section: "quality", new: "cite the tool", why: "w" })).toContain("NOT SAVED (storage full): it holds for this run only")
    expect(p.unsaved).toBe(true)
    expect(p.sections.quality).toContain("cite the tool")
    full = false
    expect(p.save()).toBe(true)
    expect(store.text).toContain("cite the tool")
  })

  test("seed: the store's seed, else the spec's lines; the file is written at the first run start", () => {
    const store = memStore(null, SEED)
    const p = new Practice({ id: "lead.practice", owner: "lead", store, clock })
    expect(store.writes).toBe(0)
    expect(p.state.run.map((i) => i.id)).toEqual(["outlook", "board", "reflect"])
    p.onRunStart()
    expect(store.writes).toBe(1)
    expect(parsePractice(store.text).checklist).toHaveLength(2)
    const q = new Practice({ id: "x.practice", owner: "x", seed: { checklist: ["!a: one"], quality: ["sourced"] }, reflect: false, clock })
    expect(q.state.run.map((i) => i.id)).toEqual(["a"])
    expect(q.state.sections.quality).toEqual(["sourced"])
    // The owner edits the file by hand between runs: the next run reads it.
    store.text = store.text.replace("- board: five rows set", "- board: five rows set\n- risk: open risk under the rail")
    p.onRunStart()
    expect(p.state.run.map((i) => i.id)).toEqual(["outlook", "board", "risk", "reflect"])
  })

  test("render: head, run checklist, quality, instructions, lessons; twin view practice; renderPractice round-trips", () => {
    const p = new Practice({ id: "lead.practice", owner: "lead", store: memStore(SEED), clock })
    const text = p.render()
    expect(text).toContain("your standing orders, kept in memory/desk/practice/lead.md")
    expect(text).toContain("RUN CHECKLIST\n[ ] !outlook: desk.outlook written from today's tools\n[ ] board: five rows set\n[ ] !reflect:")
    expect(text).toContain("QUALITY BAR\n- every number names its tool")
    expect(text).toContain("INSTRUCTIONS (learned)\n(none yet)")
    expect(text).not.toContain("TOOLS WANTED")
    const twin = p.twin()
    expect(twin).toMatchObject({ id: "lead.practice", kind: "practice", view: "practice", keep: "file", owner: "lead" })
    expect(twin.state.sections.lessons).toEqual(["2026-10-19 a stale outlook cost a row"])
    expect(parsePractice(renderPractice(parsePractice(SEED), "lead"))).toEqual(parsePractice(SEED))
  })

  test("by name from the kit: one per agent, gating its holder's answer until the run's items close", async () => {
    const kit = builtinKit({ clock, practiceStore: () => memStore(SEED) })
    const replies = [
      { thought: "answer early", calls: [], answer: "done" },
      { thought: "tick", calls: [{ tool: "lead.practice.tick", input: { id: "outlook", evidence: "written" } }, { tool: "lead.practice.skip", input: { id: "board", reason: "closed" } }, { tool: "lead.practice.reflect", input: { worked: "w", missed: "none", changes: "none: fine" } }] },
      { thought: "now", calls: [], answer: "done" },
    ]
    const desk = buildDesk({ name: "lead", report: false, artifacts: ["practice"], tools: [] }, { infer: async () => JSON.stringify(replies.shift()), artifacts: kit.artifacts })
    const p = desk.lead.artifacts.find((a) => a.kind === "practice")
    expect(p.name).toBe("lead.practice")
    expect(await desk.ask("run")).toBe("done")
    expect(replies).toHaveLength(0) // the first answer was refused by the gate
    expect(p.open()).toHaveLength(0)
  })
})
