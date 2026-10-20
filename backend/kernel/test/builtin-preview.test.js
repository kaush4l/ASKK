// The preview artifact (backend/kernel/builtin/preview.js, 2026-10-17) over a fake host: the one pane the owner and the
// agents watch. Pages through browser/*, actions answered with the page's text outline, a prompt of text only; the
// visuals the agent draws (a spec, a workspace file read again as it changes, a terminal session) and the one in
// the pane (current); the owner's questions in through ownerCall, gating the keeper's answer until preview.answer; the
// twin, snapshot and restore. 2026-10-17: the stage folded in here — every behaviour its tests covered is tested below.

import { describe, expect, test } from "bun:test"
import { Agent, Preview, Terminal } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
function holder(name, preview, host, hold = {}, config = {}) {
  const agent = new Agent({ name, report: false, ...config }, { infer: async () => "", context: { host } }).addArtifact(preview, hold)
  const run = (cmd, input = {}) => agent.tools.get(`${preview.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}
const block = (agent) => agent.render({ text: "x", from: "owner" }, []).split("# preview — preview — the pane the owner watches\n")[1].split("\n\n# REQUEST")[0]
const flow = { kind: "flow", nodes: [{ id: "embed" }, { id: "attend" }, { id: "predict" }], edges: [{ from: "embed", to: "attend" }, { from: "attend", to: "predict" }] }
const loss = (n) => ({ kind: "line", series: [{ name: "r2", points: Array.from({ length: n }, (_, i) => [i * 10, 8 - i]) }] })

describe("preview: pages", () => {
  test("open: browser/open with the holder's name; the answer is the page's line and its text outline; the page goes in the pane", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    const out = await coder.run("open", { url: "http://localhost:8001/" })
    expect(host.calls[0]).toEqual({ method: "POST", path: "browser/open", body: { url: "http://localhost:8001/", by: "coder" } })
    expect(host.calls[1]).toMatchObject({ method: "POST", path: "browser/text" })
    expect(out).toMatch(/^▶ page-x-\d+ http:\/\/localhost:8001\/ — "Dashboard" \(opened by coder\) · shot 1\n {2}# Dashboard\n {2}loss 3\.10\n {2}\[button\] Train$/)
    expect(preview.state.current).toEqual({ kind: "page", id: preview.state.pages[0].id })
    // A #view in the URL is the page's view in the pane (the stage's #view, 2026-10-17).
    await coder.run("open", { url: "http://127.0.0.1:8077/#attention" })
    expect(preview.state.current).toEqual({ kind: "page", id: preview.state.pages[0].id, view: "attention" })
    expect(preview.state.pages[0].url).toBe("http://127.0.0.1:8077/#attention")
    // Only pages on this computer: the host refuses the rest, its reason passed on.
    await expect(coder.run("open", { url: "https://example.org" })).rejects.toThrow("browser/open: HTTP 403: only pages on this computer")
    await expect(coder.run("open", { url: " " })).rejects.toThrow("url: the app's page on this computer")
  })

  test("the page is the newest open one unless id; click, type, press, scroll, goto act on it and shoot", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await expect(coder.run("click", { selector: "button" })).rejects.toThrow("no page open: preview.open {url} first")
    await coder.run("open", { url: "http://localhost:8001/" })
    const id = preview.state.pages[0].id
    expect(await coder.run("click", { selector: "button#train" })).toContain("· shot 2")
    expect(host.calls.find((c) => c.path === "browser/click").body).toEqual({ id, selector: "button#train" })
    await coder.run("type", { text: "0.01", selector: "#lr" })
    await coder.run("press", { key: "Enter" })
    await coder.run("scroll", { dy: 400 })
    await coder.run("goto", { url: "http://localhost:8001/runs" })
    expect(host.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["browser/open", "browser/text", "browser/click", "browser/text", "browser/type", "browser/text", "browser/press", "browser/text", "browser/scroll", "browser/text", "browser/navigate", "browser/text"])
    expect(preview.state.pages[0]).toMatchObject({ id, url: "http://localhost:8001/runs", shot: { n: 6 } })
    expect(await coder.run("eval", { expression: "document.title" })).toBe('{"expression":"document.title"}')
    expect(await coder.run("shot")).toBe(`shot 7 of ${id} (1280×800) — the owner sees it in the preview, and it is attached to your next step: look at it there`)
    expect(await coder.run("console")).toBe("no console lines")
    expect(await coder.run("close")).toBe(`closed ${id}`)
    expect(preview.state.pages[0].status).toBe("closed")
    expect(preview.state.current).toEqual({ kind: "page", id }) // a closed page stays in the pane: its last screenshot
  })

  test("the prompt is text only: url, title, console errors, the last text outline (≤ 40 lines) — no image, no shot URL", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await coder.run("open", { url: "http://localhost:8001/" })
    const page = host.pages[0]
    page.text = Array.from({ length: 70 }, (_, i) => `row ${i + 1}`).join("\n")
    page.console.push({ level: "log", text: "booted", at: "2026-10-17T14:00:01Z" }, { level: "error", text: "TypeError: x is undefined", at: "2026-10-17T14:00:02Z" })
    page.errors = 1
    await coder.run("text")
    preview.pulled = 0
    await preview.refresh(coder.agent)
    const lines = block(coder.agent).split("\n")
    expect(lines[0]).toBe(
      "the one pane the owner watches with you: the app's pages (apps on this computer — you read their text, and after you act on a page its new screenshot is attached to your next step; the owner watches the same page) and the visuals you draw; the owner asks about what is in it: preview.open, preview.goto, preview.click, preview.type, preview.press, preview.scroll, preview.text, preview.eval, preview.console, preview.shot, preview.close, preview.show, preview.focus, preview.answer, preview.drop",
    )
    expect(lines[1]).toMatch(/^▶ page-x-\d+ http:\/\/localhost:8001\/ — "Dashboard" \(opened by coder\) · shot 1 · 1 console error$/)
    expect(lines[2]).toBe("  console errors (1, the last 1):")
    expect(lines[3]).toBe("    TypeError: x is undefined")
    expect(lines[4]).toBe("  text (read 14:00:00):")
    expect(lines.filter((l) => /^ {4}row \d+$/.test(l))).toHaveLength(40)
    expect(lines[45]).toBe("    … 30 more lines: preview.text")
    expect(lines[46]).toMatch(/^IN THE PANE: the page page-x-\d+ http:\/\/localhost:8001\/ "Dashboard"$/)
    expect(lines).toHaveLength(47)
    const text = lines.join("\n")
    expect(text).not.toContain("/__askk/browser/shot")
    expect(text).not.toMatch(/data:image|base64|\.png/)
  })

  test("the twin: {pages, visuals, current, asks, revision}, console ≤ 20; changed() only when it changed; a separate preview lists its own", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await coder.run("open", { url: "http://localhost:8001/" })
    for (let i = 0; i < 30; i++) host.pages[0].console.push({ level: "log", text: `line ${i}`, at: "2026-10-17T14:00:00Z" })
    let changes = 0
    preview.onChange(() => changes++)
    const rev = preview.state.revision
    preview.pulled = 0
    await preview.refresh(coder.agent)
    const s = preview.twin().state
    expect(Object.keys(s)).toEqual(["pages", "visuals", "current", "trail", "asks", "revision"])
    expect(Object.keys(s.pages[0])).toEqual(["id", "url", "title", "status", "by", "at", "shot", "console", "errors"])
    expect(Object.keys(s.pages[0].shot)).toEqual(["n", "at", "width", "height", "url"])
    expect(s.pages[0].shot.url).toBe(`/__askk/browser/shot?id=${s.pages[0].id}&n=1`)
    expect(s.pages[0].console).toHaveLength(20)
    expect(Object.keys(s.pages[0].console[0])).toEqual(["level", "text", "at"])
    expect(changes).toBe(1)
    expect(s.revision).toBe(rev + 1) // every change moves the revision
    preview.pulled = 0
    await preview.refresh(coder.agent)
    expect(changes).toBe(1) // nothing new: no change, no revision
    expect(preview.state.revision).toBe(rev + 1)
    expect(preview.twin()).toMatchObject({ element: "artifact", id: "preview", kind: "preview", view: "preview", keep: "always" })
    expect(preview.poll).toBe(3000) // the host refreshes it while a tab watches
    const own = new Preview({ id: "lab", separate: true, clock })
    const helper = holder("helper", own, host)
    await helper.run("open", { url: "http://localhost:8002/" })
    own.pulled = 0
    await own.refresh(helper.agent)
    expect(own.state.pages.map((p) => p.url)).toEqual(["http://localhost:8002/"])
    preview.pulled = 0
    await preview.refresh(coder.agent)
    expect(preview.state.pages.map((p) => p.url)).toEqual(["http://localhost:8002/", "http://localhost:8001/"])
    expect(helper.agent.tools.get("lab.open")).toMatchObject({ type: "dev", view: "preview" })
    expect(helper.agent.tools.get("lab.show")).toMatchObject({ type: "dev", view: "preview" })
  })
})

describe("preview: visuals and the pane", () => {
  test("show draws (the shown one goes in the pane), the same id redraws; focus, drop; revision moves on every command", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host)
    expect(await lead.run("show", { id: "pipeline", title: "The line", says: "embed → attend → predict", visual: flow })).toBe("visual pipeline added (1 of 16) [flow 3 nodes, 2 edges] — in the owner's pane")
    expect(await lead.run("show", { id: "loss", title: "Loss", says: "val_bpb 0.7636 → 0.6755", visual: JSON.stringify(loss(3)) })).toBe("visual loss added (2 of 16) [line 1 series, 3 points] — in the owner's pane")
    expect(preview.state.visuals.map((v) => v.id)).toEqual(["pipeline", "loss"])
    expect(preview.state.current).toEqual({ kind: "visual", id: "loss" })
    expect(preview.state.visuals[0]).toEqual({ id: "pipeline", title: "The line", says: "embed → attend → predict", visual: { kind: "flow", nodes: [{ id: "embed", label: "embed" }, { id: "attend", label: "attend" }, { id: "predict", label: "predict" }], edges: [{ from: "embed", to: "attend" }, { from: "attend", to: "predict" }], direction: "right" }, by: "lead", at: "2026-10-17T14:00:00.000Z" })
    expect(await lead.run("show", { id: "loss", visual: loss(5) })).toBe("visual loss redrawn [line 1 series, 5 points] — in the owner's pane")
    expect(preview.state.visuals[1]).toMatchObject({ id: "loss", title: "loss", says: "" })

    // focus: a visual, a page with its #view; the same item again still moves the revision (a follower's pane moves).
    let rev = preview.state.revision
    expect(await lead.run("focus", { id: "pipeline" })).toBe('the owner\'s pane shows the visual pipeline "The line" [flow 3 nodes, 2 edges]')
    expect(preview.state.revision).toBe(rev + 1)
    expect(await lead.run("focus", { id: "pipeline" })).toContain("pipeline")
    expect(preview.state.revision).toBe(rev + 2)
    await lead.run("open", { url: "http://localhost:8001/" })
    const page = preview.state.pages[0].id
    await lead.run("focus", { id: "pipeline" })
    host.pages[0].errors = 2
    preview.pulled = 0
    await preview.refresh(lead.agent)
    expect(await lead.run("focus", { id: page, view: "#runs" })).toBe(`the owner's pane shows the page ${page} http://localhost:8001/ #runs "Dashboard" — it has 2 console errors: preview.console`)
    expect(preview.state.current).toEqual({ kind: "page", id: page, view: "runs" })
    await expect(lead.run("focus", { id: "latent" })).rejects.toThrow(`no page or visual "latent" in the preview — pages: ${page} (http://localhost:8001/); visuals: pipeline, loss`)
    await expect(lead.run("focus", { id: "pipeline", view: "x" })).rejects.toThrow("view: a visual has no views")
    await expect(lead.run("focus", { id: page, view: "two words" })).rejects.toThrow('view: "two words"')
    await expect(new Preview({ clock }).commands().find((t) => t.name === "preview.focus").run({ id: "x" }, { host: fakeHost() })).rejects.toThrow("nothing in the preview yet: preview.open {url} opens a page, preview.show {id, title, says, visual} draws a visual")

    // drop: the visual in the pane leaves it for the newest visual left, else the newest open page.
    await lead.run("focus", { id: "loss" })
    expect(await lead.run("drop", { id: "loss" })).toBe('visual loss dropped; 1 left; the owner\'s pane shows the visual pipeline "The line" [flow 3 nodes, 2 edges]')
    expect(await lead.run("drop", { id: "pipeline" })).toBe(`visual pipeline dropped; 0 left; the owner's pane shows the page ${page} http://localhost:8001/ "Dashboard"`)
    await expect(lead.run("drop", { id: page })).rejects.toThrow(`${page} is a page: preview.close {id: "${page}"} closes it`)
    await expect(lead.run("drop", { id: "loss" })).rejects.toThrow("no visuals to drop")
    rev = preview.state.revision
    await lead.run("show", { id: "loss", visual: loss(2) })
    expect(preview.state.revision).toBe(rev + 1)
  })

  test("bad input is refused with what to write: the id, the visual, each kind's shape", async () => {
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, fakeHost())
    await expect(lead.run("show", { id: "x y", visual: flow })).rejects.toThrow('id: "x y" — a short word for the visual')
    await expect(lead.run("show", { id: "w" })).rejects.toThrow("visual: what to draw — a spec {kind: flow | steps | matrix | line | bars | tokens | scatter | compare, title?, caption?, meta?, …}, {file: \"<workspace>.json\", params?} holding one or {terminal: \"<session id or name>\"}")
    await expect(lead.run("show", { id: "w", visual: { kind: "pie" } })).rejects.toThrow('visual.kind: "pie" — one of flow, steps, matrix, line, bars, tokens, scatter, compare — a visual is a spec {kind:')
    await expect(lead.run("show", { id: "w", visual: { kind: "flow", nodes: "a" } })).rejects.toThrow("visual: nodes: a list — a flow visual is {kind: flow, nodes: [{id, label?, group?, note?, value?}] ≤ 120, edges: [{from, to, label?, weight?}] ≤ 300, direction?: right | down, order?: [node ids]}")
    await expect(lead.run("show", { id: "w", visual: { kind: "line", series: [] } })).rejects.toThrow("visual: series: at least one — a line visual is {kind: line, series: [{name, points: [[x, y], …] ≤ 1000}] ≤ 12")
    await expect(lead.run("show", { id: "w", visual: { kind: "compare", sides: [{ visual: flow }] } })).rejects.toThrow("visual: sides: 1 — two or three ideas side by side — a compare visual is {kind: compare, sides: [{title, visual: a spec of another kind, note?}] (2 or 3), verdict?}")
    await expect(lead.run("show", { id: "w", visual: "{oops" })).rejects.toThrow("visual: not JSON — a spec {kind:")
    await expect(lead.run("show", { id: "w", visual: [1] })).rejects.toThrow("visual: a spec {kind:")
    await expect(lead.run("show", { id: "w", visual: { file: "a.json", terminal: "long" } })).rejects.toThrow("visual: one source — file or terminal, not both")
    // 2026-10-18 owner: no charts — a dashboard is a page, a curve a line spec
    await expect(lead.run("show", { id: "w", visual: { chart: "loss" } })).rejects.toThrow("visual.chart: there are no charts — open the live dashboard as a page (preview.open {url}) or draw a {kind: line} spec")
    await expect(lead.run("show", { id: "w", visual: { terminal: "a\nb" } })).rejects.toThrow("visual.terminal: \"a\nb\" — a terminal session's id or name")
    await expect(lead.run("show", { id: "w", visual: { terminal: "long" } })).rejects.toThrow("visual.terminal: this desk has no terminal artifact")
    for (let i = 0; i < 16; i++) await lead.run("show", { id: `v${i}`, visual: { kind: "steps", steps: ["a"] } })
    await expect(lead.run("show", { id: "v16", visual: { kind: "steps", steps: ["a"] } })).rejects.toThrow("the preview holds 16 visuals: preview.drop one first (v0, v1,")
    expect(await lead.run("show", { id: "v3", visual: { kind: "steps", steps: ["b"] } })).toStartWith("visual v3 redrawn")
  })

  test("a file visual: read now, again as it changes (≤ every 3 s, coalesced), the last kept with an error line; lanes and secrets refused", async () => {
    const file = "projects/sample-app/out/visuals/loss.json"
    const host = fakeHost({ files: { [file]: JSON.stringify(loss(2)), ".env.json": "{}", "projects/.mcp.json": "{}", "projects/x/src/v.json": '{"kind": "steps", "steps": ["a"]}' } })
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host)
    expect(await lead.run("show", { id: "loss", title: "Loss", says: "falls", visual: file })).toBe(`visual loss added (1 of 16) [line 1 series, 2 points from ${file}] — in the owner's pane; ${file} is read again as it changes`)
    const shown = preview.state.visuals[0]
    expect(Object.keys(shown)).toEqual(["id", "title", "says", "visual", "by", "at", "read_at"])
    expect(shown).toMatchObject({ visual: { file, kind: "line" }, read_at: "2026-10-17T14:00:00.000Z" })
    expect(shown.visual.series[0].points.length).toBe(2)
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/sample-app/out/none.json" } })).rejects.toThrow("projects/sample-app/out/none.json: not found")
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/x/notes.md" } })).rejects.toThrow("visual.file: projects/x/notes.md — a .json file in the workspace holding a visual spec")
    await expect(lead.run("show", { id: "bad", visual: { file: ".env.json" } })).rejects.toThrow("visual.file: .env.json is ASKK's configuration — never read")
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/.mcp.json" } })).rejects.toThrow("visual.file: projects/.mcp.json is ASKK's configuration — never read")
    await expect(lead.run("show", { id: "bad", visual: { file: "../x.json" } })).rejects.toThrow('".." is not a workspace path')
    const critic = holder("critic", preview, host, {}, { reads: ["projects/*/out/**"] })
    await expect(critic.run("show", { id: "v", visual: { file: "projects/x/src/v.json" } })).rejects.toThrow("visual.file: projects/x/src/v.json is outside critic's reads: lane")

    const reads = () => host.calls.filter((c) => c.path.startsWith("fs/read")).length
    const rev = preview.state.revision
    const before = reads()
    preview.filesPulled = 0
    await Promise.all([preview.refresh(lead.agent), preview.refresh(critic.agent)])
    expect(reads()).toBe(before + 1) // coalesced across holders
    expect(preview.state.revision).toBe(rev) // the same text: nothing to stream
    await preview.refresh(lead.agent)
    expect(reads()).toBe(before + 1) // not again within 3 s
    host.fs.set(file, JSON.stringify(loss(5)))
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].visual.series[0].points.length).toBe(5)
    expect(preview.state.revision).toBe(rev + 1)
    host.fs.set(file, "{broken")
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].visual.series[0].points.length).toBe(5)
    expect(preview.state.visuals[0].error).toBe(`${file}: visual: not JSON — an object such as {"kind": "flow", "nodes": [...], "edges": [...]} — a visual is ${"a spec {kind: flow | steps | matrix | line | bars | tokens | scatter | compare, title?, caption?, meta?, …}"}, {file: "<workspace>.json", params?} holding one or {terminal: "<session id or name>"}`)
    expect(block(lead.agent)).toContain(`▶ loss "Loss" [line 1 series, 5 points from ${file}] — ERROR ${file}: visual: not JSON`)
    host.fs.set(file, JSON.stringify({ kind: "line", series: "x" }))
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].error).toBe(`${file}: visual: series: a list — a line visual is {kind: line, series: [{name, points: [[x, y], …] ≤ 1000}] ≤ 12, x?: name, y?: name, marks?: [{x, label}]} — one x and one y (two quantities: a compare)`)
    host.fs.set(file, JSON.stringify(loss(5)))
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].error).toBeUndefined() // back to good: the error line goes
    expect(preview.state.visuals[0].visual.series[0].points.length).toBe(5)
    host.fs.delete(file)
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].error).toBe(`${file}: not found`)

    // Saved: a file visual as its path only, read again after a restart.
    host.fs.set(file, JSON.stringify(loss(3)))
    const saved = preview.snapshot()
    expect(saved.visuals[0]).toEqual({ id: "loss", title: "Loss", says: "falls", visual: { file }, by: "lead", at: "2026-10-17T14:00:00.000Z" })
    const back = new Preview({ clock })
    const lead2 = holder("lead", back, host)
    back.restore(saved)
    expect(back.state.visuals[0]).toMatchObject({ visual: { file }, error: "not read yet" })
    await back.refresh(lead2.agent)
    expect(back.state.visuals[0].visual.series[0].points.length).toBe(3)
    expect(back.state.visuals[0].error).toBeUndefined()
  })

  test("a terminal session: checked when shown, described live in the prompt; an old {chart} visual is dropped on restore", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const agent = new Agent({ name: "lead", report: false }, { infer: async () => "", context: { host } }).addArtifact(preview).addArtifact(new Terminal())
    const run = (tool, input) => agent.tools.get(tool).run(input, { ...agent.context, agent })
    await run("terminal.start", { command: "sleep 600", name: "train" })
    const id = agent.artifacts.find((a) => a.kind === "terminal").state.sessions[0].id
    expect(await run("preview.show", { id: "log", visual: { terminal: "long" } })).toBe(`visual log added (1 of 16) [terminal ${id}] — in the owner's pane`)
    expect(preview.state.visuals[0].visual).toEqual({ terminal: id }) // "long" (the holder's) resolved to its id
    await run("preview.show", { id: "log2", visual: '{"terminal": "train"}' })
    expect(preview.state.visuals[1].visual).toEqual({ terminal: "train" })
    await expect(run("preview.show", { id: "x", visual: { terminal: "nope" } })).rejects.toThrow(`visual.terminal: no session "nope" — sessions: ${id} "train" (lead, running)`)
    await expect(run("preview.show", { id: "x", visual: { terminal: "coder:main" } })).rejects.toThrow("visual.terminal: coder has no main session yet")
    const text = block(agent)
    expect(text).toContain(`  log "log" [terminal ${id} "train" running · sleep 600]`)
    expect(text).toContain(`▶ log2 "log2" [terminal ${id} "train" running · sleep 600]`)
    // a save from before 2026-10-18 holding a {chart} visual: that visual is dropped, the rest come back
    const saved = preview.snapshot()
    saved.visuals.push({ id: "bpb", title: "val_bpb", says: "", visual: { chart: "bpb" }, by: "lead", at: "2026-10-17T14:00:00.000Z" })
    const back = new Preview({ clock })
    back.restore(saved)
    expect(back.state.visuals.map((v) => v.id)).toEqual(["log", "log2"])
  })
})

describe("preview: the owner's questions", () => {
  async function scene() {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host)
    const coder = holder("coder", preview, host, { commands: ["show", "focus"] })
    await lead.run("open", { url: "http://localhost:8001/" })
    await lead.run("show", { id: "pipeline", title: "The line", says: "embed → attend → predict", visual: flow })
    await lead.run("show", { id: "loss", title: "Loss", says: "val_bpb 0.7636 → 0.6755", visual: loss(3) })
    return { host, preview, lead, coder, page: preview.state.pages[0].id }
  }

  test("ask: an open question for the keeper with what was in the pane (default: the current item) and what was pointed at", async () => {
    const { preview, page } = await scene()
    expect(preview.keeper()).toBe("lead") // the first holder of preview.answer — the coder holds show and focus only
    const r = preview.ownerCall("ask", [{ id: "preview", text: "why three stations?", on: { kind: "visual", id: "pipeline" }, context: { node: "attend" } }])
    expect(r.keeper).toBe("lead")
    expect(r.ask).toEqual({ id: "q1", text: "why three stations?", on: { kind: "visual", id: "pipeline" }, context: { node: "attend" }, from: "owner", at: "2026-10-17T14:00:00.000Z", answer: null })
    expect(r.deliver).toBe(
      'In the preview the owner asks (q1, about the visual pipeline "The line" [flow 3 nodes, 2 edges] — it says: "embed → attend → predict", pointing at node attend): "why three stations?"\nAnswer it in the preview: read the numbers, redraw pipeline (preview.show {id: "pipeline", …}) or draw the visual that answers, then preview.answer {ask: "q1", text, show: "<the visual or page id>"} — a visual says more than words.',
    )
    expect(preview.ownerCall("ask", [{ text: "and the loss?" }]).ask.on).toEqual({ kind: "visual", id: "loss" }) // the current item
    const onPage = preview.ownerCall("ask", [{ text: "the page?", on: page, context: { selector: "#loss" } }])
    expect(onPage.ask.on).toEqual({ kind: "page", id: page })
    expect(onPage.deliver).toBe(`In the preview the owner asks (q3, about the page ${page} http://localhost:8001/ "Dashboard", pointing at selector #loss): "the page?"\nAnswer it in the preview: read the numbers, read the page (preview.text {id: "${page}"}) and draw the visual that answers (preview.show), then preview.answer {ask: "q3", text, show: "<the visual or page id>"} — a visual says more than words.`)
    expect(preview.ownerCall("ask", [{ text: "gone?", on: { kind: "visual", id: "nope" } }]).ask).toMatchObject({ id: "q4", on: null })
    expect(preview.ownerCall("ask", [{ text: "blank?", on: null }], "telegram").ask).toMatchObject({ on: null, from: "telegram" })
    expect(preview.ownerCall("ask", [{ text: "x", on: null }]).deliver).toBe('In the preview the owner asks (q6, with nothing in the pane): "x"\nAnswer it in the preview: read the numbers, draw the visual that answers (preview.show), then preview.answer {ask: "q6", text, show: "<the visual or page id>"} — a visual says more than words.')
    expect(preview.ownerCall("ask", [{ text: "big", context: { note: "y".repeat(2000) } }]).ask.context.note.length).toBeLessThanOrEqual(1001)
    expect(() => preview.ownerCall("ask", [{ text: " " }])).toThrow("text: the question")
    expect(() => preview.ownerCall("ask", [{ text: "x".repeat(1501) }])).toThrow("text: 1501 chars — at most 1500")
    expect(() => preview.ownerCall("focus", [{}])).toThrow("preview: the owner can ask, open, back, rerun (not focus)")
    expect(preview.state.revision).toBeGreaterThan(0)
  })

  test("gate: the keeper's answer waits for preview.answer; an answer with show puts it in the pane; others are not gated", async () => {
    const { preview, lead, coder } = await scene()
    preview.ownerCall("ask", [{ text: "why three stations?", on: { kind: "visual", id: "pipeline" } }])
    expect(preview.gate(lead.agent)).toBe('the owner asked in the preview: q1 "why three stations?" — preview.answer {ask, text, show?} each first')
    expect(lead.agent.gates("done")).toEqual(['the owner asked in the preview: q1 "why three stations?" — preview.answer {ask, text, show?} each first'])
    expect(preview.gate(coder.agent)).toBeNull()
    await expect(lead.run("answer", { ask: "q9", text: "x" })).rejects.toThrow("no question q9 — open: q1")
    await expect(lead.run("answer", { ask: "q1", text: "" })).rejects.toThrow("text: the answer")
    await expect(lead.run("answer", { ask: "q1", text: "x", show: "nope" })).rejects.toThrow('show: no page or visual "nope" in the preview')
    const rev = preview.state.revision
    expect(await lead.run("answer", { ask: "q1", text: "embed, attend, predict: each a station, 2 edges", show: "pipeline" })).toBe('q1 answered; the owner\'s pane shows the visual pipeline "The line" [flow 3 nodes, 2 edges]')
    expect(preview.state.revision).toBe(rev + 1)
    expect(preview.state.current).toEqual({ kind: "visual", id: "pipeline" })
    expect(preview.state.asks[0].answer).toEqual({ text: "embed, attend, predict: each a station, 2 edges", on: { kind: "visual", id: "pipeline" }, by: "lead", at: "2026-10-17T14:00:00.000Z" })
    expect(preview.gate(lead.agent)).toBeNull()
    await expect(lead.run("answer", { ask: "q1", text: "again" })).rejects.toThrow('q1 is answered already (lead: "embed, attend, predict: each a station, 2 edges") — open: none')
    await expect(new Preview({ clock }).commands().find((t) => t.name === "preview.answer").run({ ask: "q1", text: "x" }, {})).rejects.toThrow("the owner has asked nothing in the preview")
    // An answer without show leaves the pane as it is.
    preview.ownerCall("ask", [{ text: "and?" }])
    await lead.run("focus", { id: "loss" })
    expect(await lead.run("answer", { ask: "q2", text: "that's all" })).toBe("q2 answered")
    expect(preview.state.current).toEqual({ kind: "visual", id: "loss" })
  })

  test("past 40 questions answered ones go first, open ones stay", () => {
    const preview = new Preview({ clock })
    for (let i = 0; i < 39; i++) preview.ownerCall("ask", [{ text: `open ${i}` }])
    preview.state.asks[0].answer = { text: "done", on: null, by: "lead", at: null }
    preview.ownerCall("ask", [{ text: "q40" }])
    preview.ownerCall("ask", [{ text: "q41" }])
    expect(preview.state.asks.length).toBe(40)
    expect(preview.state.asks.some((a) => a.answer)).toBe(false)
    expect(preview.state.asks.at(-1).id).toBe("q41")
    preview.ownerCall("ask", [{ text: "q42" }])
    expect(preview.state.asks.length).toBe(40) // none answered: the oldest open one goes
    expect(preview.state.asks[0].text).toBe("open 2")
  })

  test("prompt: the commands the holder has, the pages, the visuals with ▶, the pane, open questions in full and the last 3 answered", async () => {
    const { preview, lead, coder, page } = await scene()
    await lead.run("focus", { id: "pipeline" })
    preview.ownerCall("ask", [{ text: "why three\nstations?", context: { node: "attend" } }])
    preview.ownerCall("ask", [{ text: "loss?", on: page }])
    await lead.run("answer", { ask: "q2", text: "0.6755 at r2", show: "loss" })
    expect(block(lead.agent)).toBe(
      [
        "the one pane the owner watches with you: the app's pages (apps on this computer — you read their text, and after you act on a page its new screenshot is attached to your next step; the owner watches the same page) and the visuals you draw; the owner asks about what is in it: preview.open, preview.goto, preview.click, preview.type, preview.press, preview.scroll, preview.text, preview.eval, preview.console, preview.shot, preview.close, preview.show, preview.focus, preview.answer, preview.drop",
        `▶ ${page} http://localhost:8001/ — "Dashboard" (opened by lead) · shot 1`,
        "  text (read 14:00:00):",
        "    # Dashboard",
        "    loss 3.10",
        "    [button] Train",
        "VISUALS (▶ = in the pane):",
        '  pipeline "The line" [flow 3 nodes, 2 edges] — embed → attend → predict',
        '▶ loss "Loss" [line 1 series, 3 points] — val_bpb 0.7636 → 0.6755',
        'IN THE PANE: the visual loss "Loss" [line 1 series, 3 points]',
        "OWNER ASKED (open — preview.answer each):",
        '  q1 on visual pipeline {node attend}: "why three stations?"',
        "ANSWERED (latest):",
        `  q2 "loss?" → 0.6755 at r2 [visual loss]`,
      ].join("\n"),
    )
    expect(block(coder.agent).split("\n")[0]).toBe(
      "the one pane the owner watches with you: the app's pages (apps on this computer — you read their text, and after you act on a page its new screenshot is attached to your next step; the owner watches the same page) and the visuals you draw; the owner asks about what is in it: preview.show, preview.focus",
    )
    expect(block(coder.agent)).toContain("OWNER ASKED (open):")
    expect(preview.brief()).toBe("1 page open · 2 visuals · ▶ loss · 1 question open")
    expect(new Preview({ clock }).brief()).toBe("nothing in the pane yet")
    expect(new Preview({ clock }).render()).toContain("IN THE PANE: nothing — preview.open {url} puts a page there, preview.show {id, title, says, visual} a visual")
  })

  test("prompt ≤ 60 lines: the pages' outlines fill what is left; past it the answered, then the visuals are cut — the open questions stay in full", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host)
    for (const port of [8001, 8002]) {
      await lead.run("open", { url: `http://localhost:${port}/` })
      host.pages.at(-1).text = Array.from({ length: 70 }, (_, i) => `row ${i + 1}`).join("\n")
      await lead.run("text")
    }
    let lines = block(lead.agent).split("\n")
    expect(lines).toHaveLength(60) // two pages: 40 lines of the first, what is left of the second
    expect(lines.filter((l) => /^ {4}row \d+$/.test(l))).toHaveLength(52)
    expect(lines.filter((l) => l.includes("more lines: preview.text"))).toEqual([`    … 30 more lines: preview.text {id: "${preview.state.pages[0].id}"}`, `    … 58 more lines: preview.text {id: "${preview.state.pages[1].id}"}`])
    await lead.run("open", { url: "http://localhost:8003/" })
    lines = block(lead.agent).split("\n")
    expect(lines).toHaveLength(60)
    // Three pages, newest first: the new one's 3 lines, the next its 40, the oldest what is left (a line is kept for it).
    expect(lines.filter((l) => /^▶ page-x-\d+ /.test(l)).map((l) => l.split(" ")[2])).toEqual(["http://localhost:8003/", "http://localhost:8002/", "http://localhost:8001/"])
    expect(lines.filter((l) => /more lines/.test(l))).toEqual([`    … 30 more lines: preview.text {id: "${host.pages[1].id}"}`, `    … 63 more lines: preview.text {id: "${host.pages[0].id}"}`])
    expect(lines.at(-1)).toBe(`IN THE PANE: the page ${host.pages[2].id} http://localhost:8003/ "Dashboard"`)
    for (let i = 0; i < 16; i++) await lead.run("show", { id: `v${i}`, title: `step ${i}`, visual: { kind: "steps", steps: ["a"] } })
    for (let i = 0; i < 40; i++) preview.ownerCall("ask", [{ text: `question ${i} ${"why ".repeat(30)}` }])
    lines = block(lead.agent).split("\n")
    expect(lines.length).toBeLessThanOrEqual(60)
    expect(lines.filter((l) => /^ {2}q\d+ on visual v15: "question \d+ (why ){29}why"$/.test(l))).toHaveLength(40) // in full, with what was in the pane
    expect(lines).toContain("  … 4 more visuals: v0, v1, v2, v3") // the newest stay
    expect(lines).toContain('▶ v15 "step 15" [steps 1]')
    expect(lines.some((l) => l.startsWith("IN THE PANE: the visual v15"))).toBe(true)
    expect(lines.filter((l) => /^▶ page-x-\d+ /.test(l))).toHaveLength(3)
    // The visual in the pane stays when the list is cut.
    await lead.run("focus", { id: "v0" })
    lines = block(lead.agent).split("\n")
    expect(lines.length).toBeLessThanOrEqual(60)
    expect(lines).toContain("  … 4 more visuals: v1, v2, v3, v4")
    expect(lines).toContain('▶ v0 "step 0" [steps 1]')
    // Answered questions are the first to go; with room they show (the last 3).
    for (let i = 0; i < 38; i++) await lead.run("answer", { ask: `q${i + 1}`, text: `answer ${i}` })
    lines = block(lead.agent).split("\n")
    expect(lines.length).toBeLessThanOrEqual(60)
    expect(lines.filter((l) => /^ {2}q\d+ "question/.test(l))).toHaveLength(3)
    expect(lines.filter((l) => /^ {2}q(39|40) on visual v15: "question/.test(l))).toHaveLength(2)
  })

  // 2026-10-17: the cap counts each entry as one line, so what an agent, a page or the owner wrote is flat in the block
  // (a framed page's bridge hands the owner's context on as the element's text, line breaks and all).
  test("prompt ≤ 60 lines with line breaks in what it prints: visual titles and errors, a page's title and console text, the owner's questions and context — one line each", async () => {
    const host = fakeHost()
    let broken = false
    const adapter = {
      read: async () => {
        if (broken) throw new Error("disk\nfull\n  now")
        return { text: JSON.stringify({ kind: "steps", steps: ["a", "b"] }) }
      },
    }
    const preview = new Preview({ clock, adapter })
    const lead = holder("lead", preview, host)
    await lead.run("open", { url: "http://localhost:8001/" })
    Object.assign(host.pages[0], { title: "Dash\nboard\r\nnow", console: [{ level: "error", text: "TypeError: x\n    at a (app.js:1)\n    at b (app.js:2)", at: null }], errors: 1 })
    await lead.run("shot") // the page as the host has it now
    await lead.run("show", { id: "loss", title: "loss\ncurve", visual: { file: "out/loss.json" } })
    for (let i = 1; i < 16; i++) await lead.run("show", { id: `v${i}`, title: `t${i}\na\nb\nc\nd`, says: "x\ny", visual: { kind: "steps", steps: ["a"] } })
    broken = true
    preview.restore(preview.snapshot()) // the file is read again at the next refresh — and fails
    await preview.refresh(lead.agent)
    expect(preview.state.visuals[0].error).toBe("out/loss.json: disk\nfull\n  now")
    expect(preview.state.visuals.slice(0, 2).map((v) => v.title)).toEqual(["loss curve", "t1 a b c d"]) // flat when written
    let lines = block(lead.agent).split("\n")
    expect(lines.length).toBeLessThanOrEqual(60)
    expect(lines.some((l) => /^▶ page-x-\d+ http:\/\/localhost:8001\/ — "Dash board now" \(opened by lead\)/.test(l))).toBe(true)
    expect(lines).toContain("    TypeError: x at a (app.js:1) at b (app.js:2)")
    expect(lines).toContain('  loss "loss curve" [visual from out/loss.json] — ERROR out/loss.json: disk full now')
    expect(lines).toContain('▶ v15 "t15 a b c d" [steps 1] — x y')
    expect(lines).toContain('IN THE PANE: the visual v15 "t15 a b c d" [steps 1]')
    // 40 open questions, each with what the owner pointed at (the element's text as the page had it).
    const first = preview.ownerCall("ask", [{ text: "q0\nwhy\nnow", on: null, context: { note: "a\nb\nc", "k\ney": "v" } }])
    expect(first.deliver).toContain("pointing at note a b c, k ey v)")
    for (let i = 1; i < 40; i++) preview.ownerCall("ask", [{ text: `q${i}\nwhy\nnow`, on: null, context: { note: "a\nb\nc", "k\ney": "v" } }])
    expect(preview.state.asks[0].context).toEqual({ note: "a\nb\nc", "k\ney": "v" }) // the twin keeps it as given
    lines = block(lead.agent).split("\n")
    expect(lines.length).toBeLessThanOrEqual(60)
    expect(lines.filter((l) => /^ {2}q\d+ \{note a b c, k ey v\}: "q\d+ why now"$/.test(l))).toHaveLength(40) // in full
    // A save with line breaks in a title comes back flat.
    const copy = new Preview({ clock })
    copy.restore({ visuals: [{ id: "x", title: "a\n\nb", visual: { kind: "steps", steps: ["a"] } }] })
    expect(copy.state.visuals[0].title).toBe("a b")
  })
})

describe("preview: save", () => {
  test("snapshot and restore keep visuals, asks and current; the pages are the host's; what does not fit is dropped", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host)
    await lead.run("open", { url: "http://localhost:8001/" })
    await lead.run("show", { id: "pipeline", title: "The line", visual: flow })
    preview.ownerCall("ask", [{ text: "why?", context: { node: "attend" } }])
    const saved = preview.snapshot()
    expect(Object.keys(saved)).toEqual(["visuals", "current", "trail", "asks", "revision"])
    const copy = new Preview({ clock })
    copy.restore({ ...saved, visuals: [...saved.visuals, { id: "bad id!", visual: flow }, { id: "pie", visual: { kind: "pie" } }, { id: "pipeline", visual: flow }] })
    expect(copy.state.visuals.map((v) => v.id)).toEqual(["pipeline"])
    expect(copy.state.visuals[0]).toEqual(preview.state.visuals[0])
    expect(copy.state.current).toEqual({ kind: "visual", id: "pipeline" })
    expect(copy.state.asks[0]).toMatchObject({ id: "q1", text: "why?", on: { kind: "visual", id: "pipeline" }, context: { node: "attend" }, answer: null })
    expect(copy.state.revision).toBe(preview.state.revision)
    expect(copy.state.pages).toEqual([])
    copy.restore({ nope: true })
    expect(copy.state.visuals.length).toBe(1)
    copy.restore({ ...saved, current: { kind: "visual", id: "gone" } })
    expect(copy.state.current).toBeNull()
    // The whole state as the host saves it (kernel-team writes state): its pages are not taken; a current page the host
    // no longer lists leaves the pane at the first pull.
    const restarted = new Preview({ clock })
    const lead2 = holder("lead", restarted, fakeHost())
    restarted.restore({ ...preview.state, current: { kind: "page", id: preview.state.pages[0].id, view: "runs" } })
    expect(restarted.state.pages).toEqual([])
    expect(restarted.state.current).toEqual({ kind: "page", id: preview.state.pages[0].id, view: "runs" })
    await restarted.refresh(lead2.agent)
    expect(restarted.state.current).toBeNull()
    expect(restarted.state.visuals.map((v) => v.id)).toEqual(["pipeline"])
  })
})

describe("preview: drill-down (P3) and bound scripts (P4), 2026-10-17", () => {
  const trace = () => ({ kind: "tokens", color: "surprisal", tokens: [{ text: "a", p: 0.5, open: { id: "tok", params: { t: 0 } } }, { text: "b", p: 0.25, open: { id: "tok", params: { t: 1 } } }] })
  const tok = (t) => ({ kind: "matrix", values: [[t, 1]], cells: [["x", "y"]], meta: { t } })

  test("a templated file: params fill it (never a path), the resolved file in the lane; the owner opens links, goes back; the trail holds 8; saved", async () => {
    const host = fakeHost({
      files: {
        "projects/x/out/viz/trace/r1.json": JSON.stringify(trace()),
        "projects/x/out/viz/tok/r1/0.json": JSON.stringify(tok(0)),
        "projects/x/out/viz/tok/r1/1.json": JSON.stringify(tok(1)),
        "projects/y/out/0.json": JSON.stringify(tok(0)),
      },
    })
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host, {}, { reads: ["projects/x/**"] })
    await lead.run("show", { id: "trace", title: "Tokens", visual: { file: "projects/x/out/viz/trace/{run}.json", params: { run: "r1" } } })
    expect(preview.state.visuals[0]).toMatchObject({ template: "projects/x/out/viz/trace/{run}.json", params: { run: "r1" }, reads: ["projects/x/**"], visual: { file: "projects/x/out/viz/trace/r1.json", kind: "tokens" } })
    expect(preview.state.visuals[0].visual.tokens[1]).toMatchObject({ surprisal: 2, open: { id: "tok", params: { t: "1" } } })
    expect(preview.state.current).toEqual({ kind: "visual", id: "trace", params: { run: "r1" } })
    await lead.run("show", { id: "tok", title: "Token", visual: { file: "projects/x/out/viz/tok/{run}/{t}.json", params: { run: "r1", t: 0 } } })
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/x/out/{run}/{t}.json", params: { run: "r1" } } })).rejects.toThrow("visual.file: {t} has no value")
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/x/out/{t}.json", params: { t: "../../y" } } })).rejects.toThrow('visual.params.t: "../../y" — letters, digits')
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/x/out/{t}.json", params: { t: ".." } } })).rejects.toThrow('visual.params.t: ".."')
    await expect(lead.run("show", { id: "bad", visual: { file: "projects/{p}/out/0.json", params: { p: "y" } } })).rejects.toThrow("visual.file: projects/y/out/0.json is outside lead's reads: lane")

    // The owner clicks token 2 of the trace: tok for t=1 (run kept from its own params); the trace goes on the trail.
    await lead.run("focus", { id: "trace" })
    const r = await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: 1 } }])
    expect(r).toEqual({ current: { kind: "visual", id: "tok", params: { run: "r1", t: "1" } }, trail: [{ kind: "visual", id: "trace", params: { run: "r1" } }] })
    const shown = () => preview.state.visuals.find((v) => v.id === "tok")
    expect(shown().visual).toMatchObject({ file: "projects/x/out/viz/tok/r1/1.json", kind: "matrix", cells: [["x", "y"]], meta: { t: 1 } })
    expect(block(lead.agent)).toContain('IN THE PANE: the visual tok (run=r1, t=1) "Token" [matrix 1×2 from projects/x/out/viz/tok/r1/1.json (t 1)] · drilled: trace (run=r1) › tok (run=r1, t=1)')
    // A file missing for these params: in the pane with its error (nothing bound makes it).
    await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: 9 } }])
    expect(shown()).toMatchObject({ visual: { file: "projects/x/out/viz/tok/r1/9.json" }, error: "projects/x/out/viz/tok/r1/9.json: not found" })
    expect(preview.state.trail.map((t) => t.params?.t ?? t.id)).toEqual(["trace", "1"])
    expect(await preview.ownerCall("back", [{ id: "preview" }])).toEqual({ current: { kind: "visual", id: "tok", params: { run: "r1", t: "1" } }, trail: [{ kind: "visual", id: "trace", params: { run: "r1" } }] })
    expect(shown().visual.kind).toBe("matrix")
    await preview.ownerCall("back", [{ id: "preview" }])
    expect(preview.state.current).toEqual({ kind: "visual", id: "trace", params: { run: "r1" } })
    await expect(preview.ownerCall("back", [{ id: "preview" }])).rejects.toThrow("nothing to go back to")
    for (let i = 0; i < 12; i++) await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: i % 2 } }])
    expect(preview.state.trail).toHaveLength(8)
    await expect(preview.ownerCall("open", [{ id: "preview", visual: "nope" }])).rejects.toThrow('no page or visual "nope"')
    await expect(preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: "a/b" } }])).rejects.toThrow('params.t: "a/b"')
    await expect(preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: "{x}" } }])).rejects.toThrow('params.t: "{x}"')
    expect(preview.state.asks).toEqual([]) // opening never asks, never runs the keeper

    // An agent drills too; a new place (show of another visual, a plain focus) starts the trail again.
    expect(await lead.run("focus", { id: "tok", params: { t: 0 } })).toContain("the owner's pane shows the visual tok (run=r1, t=0)")
    await expect(lead.run("focus", { id: "trace", params: { run: "../x" } })).rejects.toThrow('params.run: "../x"')
    const saved = preview.snapshot()
    const back = new Preview({ clock })
    back.restore(saved)
    expect(back.state.visuals.find((v) => v.id === "tok")).toMatchObject({ template: "projects/x/out/viz/tok/{run}/{t}.json", params: { run: "r1", t: "0" }, reads: ["projects/x/**"], visual: { file: "projects/x/out/viz/tok/r1/0.json" } })
    expect(back.state.trail).toEqual(preview.state.trail)
    expect(back.state.current).toEqual(preview.state.current)
    await lead.run("focus", { id: "trace" })
    expect(preview.state.trail).toEqual([])
    await lead.run("drop", { id: "trace" })
    expect(preview.state.trail.some((t) => t.id === "trace")).toBe(false)
  })

  test("bind: the script that writes a file visual runs again when a watched file changes — one at a time, the error kept with the last good visual, the owner's Re-run", async () => {
    const arch = (n) => ({ kind: "flow", nodes: Array.from({ length: n }, (_, i) => `b${i}`), meta: { n_layer: n } })
    let mode = { status: "running" }
    const host = fakeHost({ files: { "projects/x/out/model/arch.json": JSON.stringify(arch(2)), "projects/x/llm/architecture/gpt.py": "#", "projects/x/04_training/configs/base.json": "{}" }, onStart: () => mode })
    let now = Date.parse("2026-10-17T14:00:00Z")
    const preview = new Preview({ clock: () => new Date(now) })
    const lead = holder("lead", preview, host, {}, { writes: ["projects/x/out/**"], reads: ["projects/x/**"] })
    const critic = holder("critic", preview, host, {}, { reads: ["projects/x/**"] })
    const bind = { command: "python -B 03_architecture/arch.py --config 04_training/configs/{cfg}.json --out out/model/arch.json", cwd: "projects/x", watch: ["projects/x/llm/architecture/**", "projects/x/04_training/configs/*.json"] }
    const visual = { file: "projects/x/out/model/arch.json", params: { cfg: "base" } }
    await expect(lead.run("show", { id: "a", visual: arch(1), bind })).rejects.toThrow("bind: only with a {file} visual")
    await expect(lead.run("show", { id: "a", visual: { file: visual.file }, bind })).rejects.toThrow("bind.command: {cfg} has no value")
    await expect(critic.run("show", { id: "a", visual, bind })).rejects.toThrow("bind: critic has no writes: lane")
    await expect(lead.run("show", { id: "a", visual: { file: "projects/x/llm/v.json" }, bind: { ...bind, command: "python x.py" } })).rejects.toThrow("bind: projects/x/llm/v.json is outside lead's writes: lane")
    await expect(lead.run("show", { id: "a", visual, bind: { ...bind, watch: ["projects/x/out/**"] } })).rejects.toThrow("bind.watch[0]: projects/x/out/** holds the visual's own file")
    await expect(lead.run("show", { id: "a", visual, bind: { ...bind, watch: ["projects/z/**"] } })).rejects.toThrow("bind.watch[0]: projects/z/** is outside lead's reads: lane")
    await expect(lead.run("show", { id: "a", visual, bind: { ...bind, watch: [] } })).rejects.toThrow("bind.watch: the files whose change runs it again")
    await expect(lead.run("show", { id: "a", visual, bind: { ...bind, lease: "GPU!" } })).rejects.toThrow("bind.lease")
    await expect(lead.run("show", { id: "a", visual, bind: { ...bind, timeout: 900 } })).rejects.toThrow("bind.timeout: seconds, 1 to 600")

    // Shown: its file is newer than what it reads — nothing runs.
    const out = await lead.run("show", { id: "arch", title: "The model", visual, bind })
    expect(out).toContain(`; bound: ${bind.command} ← projects/x/llm/architecture/**, projects/x/04_training/configs/*.json · not run yet`)
    const starts = () => host.calls.filter((c) => c.path === "term/start")
    expect(starts()).toHaveLength(0)
    expect(Object.keys(preview.state.visuals[0])).toEqual(["id", "title", "says", "visual", "by", "at", "params", "bind", "read_at"])
    expect(preview.state.visuals[0].bind).toEqual({ command: bind.command, watch: bind.watch, cwd: "projects/x", lease: null, timeout: 120, by: "lead", writes: ["projects/x/out/**"], running: false, session: null, ran_at: null, ran: null, inputs_at: null, exit: null, ms: null, error: null, waiting: null, reads: ["projects/x/**"] })

    // A watched file changes: one start — the binder's name and writes, slot viz, its params filled in.
    let t = 1_700_000_100_000
    const pass = async () => {
      preview.filesPulled = 0
      await preview.refresh(lead.agent)
    }
    host.touch("projects/x/llm/architecture/gpt.py", (t += 5000))
    await pass()
    expect(starts()).toHaveLength(1)
    const filled = "python -B 03_architecture/arch.py --config 04_training/configs/base.json --out out/model/arch.json"
    expect(starts()[0].body).toEqual({ command: filled, cwd: "projects/x", name: "viz:arch", agent: "lead", writes: ["projects/x/out/**"], wait: 0, slot: "viz" })
    expect(preview.state.visuals[0].bind).toMatchObject({ running: true, ran: filled, ran_at: "2026-10-17T14:00:00.000Z", inputs_at: t })
    expect(block(lead.agent)).toContain(`· bound: ${bind.command} ← projects/x/llm/architecture/**, projects/x/04_training/configs/*.json · running since 14:00 (0 s)`)
    // Running: no second start, even on another change.
    host.touch("projects/x/llm/architecture/gpt.py", (t += 5000))
    await pass()
    expect(starts()).toHaveLength(1)
    // It ends well, having rewritten the file: read again in the same pass, the flow redraws.
    const session = host.sessions.at(-1)
    host.fs.set("projects/x/out/model/arch.json", JSON.stringify(arch(3)))
    host.touch("projects/x/out/model/arch.json", (t += 5000))
    Object.assign(session, { status: "exited", exit: 0, endedAt: new Date(Date.parse(session.startedAt) + 2100).toISOString(), lines: ["wrote out/model/arch.json"] })
    await pass()
    expect(preview.state.visuals[0].visual).toMatchObject({ meta: { n_layer: 3 } })
    expect(preview.state.visuals[0].visual.nodes).toHaveLength(3)
    expect(preview.state.visuals[0].bind).toMatchObject({ running: false, exit: 0, ms: 2100, error: null })
    expect(block(lead.agent)).toContain("· ran 14:00 exit 0 (2.1 s)")
    await pass()
    expect(starts()).toHaveLength(1) // nothing changed since: nothing starts

    // A failing run keeps the last good visual, with the error; it runs again only when an input changes.
    mode = { status: "exited", exit: 1, lines: ["Traceback (most recent call last):", "ValueError: n_head must divide d_model"] }
    host.touch("projects/x/04_training/configs/base.json", (t += 5000))
    await pass()
    expect(starts()).toHaveLength(1) // within 10 s of its last start: the backstop waits
    now += 11000
    await pass()
    expect(starts()).toHaveLength(2)
    expect(preview.state.visuals[0].visual.nodes).toHaveLength(3)
    expect(preview.state.visuals[0].bind).toMatchObject({ running: false, exit: 1, error: "python -B exited 1: ValueError: n_head must divide d_model" })
    expect(block(lead.agent)).toContain("exit 1 (1.5 s) — ERROR python -B exited 1: ValueError: n_head must divide d_model")
    await pass()
    expect(starts()).toHaveLength(2)

    // The owner's Re-run: now, whatever changed.
    mode = { status: "exited", exit: 0, lines: ["ok"] }
    const rr = await preview.ownerCall("rerun", [{ id: "preview", visual: "arch" }])
    expect(starts()).toHaveLength(3)
    expect(rr).toMatchObject({ visual: "arch", bind: { exit: 0, error: null } })
    await expect(preview.ownerCall("rerun", [{ id: "preview", visual: "nope" }])).rejects.toThrow('no page or visual "nope"')

    // Saved with its history (never as running); a redraw with the same script keeps it, another script starts fresh.
    expect(preview.snapshot().visuals[0].bind).toMatchObject({ command: bind.command, ran: filled, exit: 0, running: false, session: null })
    await lead.run("show", { id: "arch", title: "The model", visual, bind })
    expect(preview.state.visuals[0].bind).toMatchObject({ ran: filled, exit: 0 })
    await lead.run("show", { id: "arch", title: "The model", visual, bind: { ...bind, command: `${bind.command} --vs` } })
    // never run, and its inputs are newer than its file (the config changed after it was last written): it runs now
    expect(starts()).toHaveLength(4)
    expect(preview.state.visuals[0].bind).toMatchObject({ ran: `${filled} --vs`, exit: 0 })
  })

  test("bind with params: a file missing for params never run runs its script once; a held lease waits", async () => {
    let host
    host = fakeHost({
      files: { "projects/x/out/viz/tok/r1/0.json": JSON.stringify(tok(0)), "projects/x/runs/r1/ckpt/step10.safetensors": "w", "projects/x/observe/probes/trace.py": "#" },
      onStart: (body) => {
        const t = /--t (\S+)/.exec(body.command)?.[1]
        if (t == null) return undefined // sleep: the fake host's default (running)
        host.fs.set(`projects/x/out/viz/tok/r1/${t}.json`, JSON.stringify(tok(Number(t))))
        host.touch(`projects/x/out/viz/tok/r1/${t}.json`)
        return { status: "exited", exit: 0, lines: ["ok"] }
      },
    })
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host, {}, { writes: ["projects/x/out/**"], reads: ["projects/x/**"] })
    const bind = { command: "python -B observe/probes/trace.py --run {run} --t {t} --out out/observe/viz", cwd: "projects/x", watch: ["projects/x/runs/{run}/ckpt/*.safetensors", "projects/x/observe/probes/trace.py"] }
    await lead.run("show", { id: "tok", title: "Token", visual: { file: "projects/x/out/viz/tok/{run}/{t}.json", params: { run: "r1", t: 0 } }, bind })
    const starts = () => host.calls.filter((c) => c.path === "term/start")
    expect(starts()).toHaveLength(0)
    await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: 3 } }])
    expect(starts().map((c) => c.body.command)).toEqual(["python -B observe/probes/trace.py --run r1 --t 3 --out out/observe/viz"])
    expect(preview.state.visuals[0].visual).toMatchObject({ file: "projects/x/out/viz/tok/r1/3.json", kind: "matrix", meta: { t: 3 } })
    await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: 0 } }])
    await preview.ownerCall("open", [{ id: "preview", visual: "tok", params: { t: 3 } }])
    expect(starts()).toHaveLength(1) // their files are there: nothing to make

    // Another run holds the GPU lease: a bind with lease gpu waits, and starts when it is free.
    await host.post("term/start", { command: "sleep 600", agent: "trainer", slot: "long", lease: "gpu" })
    await lead.run("show", { id: "evo", title: "Through training", visual: { file: "projects/x/out/viz/evo/{run}.json", params: { run: "r1" } }, bind: { ...bind, command: "python -B observe/views/evo.py --run {run}", lease: "gpu" } })
    const evo = () => preview.state.visuals.find((v) => v.id === "evo")
    expect(evo()).toMatchObject({ visual: { file: "projects/x/out/viz/evo/r1.json" }, error: "projects/x/out/viz/evo/r1.json: not made yet — its bound script makes it" })
    expect(evo().bind.waiting).toMatch(/^HTTP 409: gpu is held by term-\d+ \(trainer: sleep 600\)/)
    expect(block(lead.agent)).toContain("· waiting: HTTP 409: gpu is held by")
    host.sessions.find((x) => x.lease === "gpu").status = "exited"
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(starts().at(-1).body).toMatchObject({ command: "python -B observe/views/evo.py --run r1", lease: "gpu", slot: "viz", name: "viz:evo" })
    expect(evo().bind.waiting).toBeNull()
  })

  test("bind watch lanes (critic): each glob covered by one of the binder's reads: globs, starting at a folder; matches outside the lane never seen; checked again when params change them", async () => {
    const host = fakeHost({ files: { "projects/x/out/a.json": JSON.stringify(tok(0)), "projects/x/src/m.py": "#", "projects/y/secret.py": "#", "projects/x/out/r1/0.json": JSON.stringify(tok(0)) } })
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, host, {}, { writes: ["projects/x/out/**"], reads: ["projects/x/**", "!projects/x/src/private/**"] })
    const show = (watch, extra = {}) => lead.run("show", { id: "a", visual: { file: "projects/x/out/a.json" }, bind: { command: "python m.py", watch }, ...extra })
    await expect(show(["**/*.py"])).rejects.toThrow("bind.watch[0]: **/*.py — a watch starts at a folder (projects/<slug>/…), never a glob at the top")
    await expect(show(["*/x/m.py"])).rejects.toThrow("bind.watch[0]: */x/m.py — a watch starts at a folder")
    await expect(show(["projects/*/m.py"])).rejects.toThrow("bind.watch[0]: projects/*/m.py is outside lead's reads: lane (projects/x/**, !projects/x/src/private/**)")
    await expect(show(["projects/**/*.py"])).rejects.toThrow("is outside lead's reads: lane")
    await expect(show(["projects/y/secret.py"])).rejects.toThrow("bind.watch[0]: projects/y/secret.py is outside lead's reads: lane")
    await show(["projects/x/src/**"])
    expect(preview.state.visuals[0].bind.reads).toEqual(["projects/x/**", "!projects/x/src/private/**"])
    // a file the lane excludes is never seen: its change starts nothing
    host.fs.set("projects/x/src/private/k.py", "#")
    host.touch("projects/x/src/private/k.py", 1_800_000_000_000)
    preview.filesPulled = 0
    await preview.refresh(lead.agent)
    expect(host.calls.filter((c) => c.path === "term/start")).toHaveLength(0)
    // params that change the globs are checked again on open
    await expect(lead.run("show", { id: "t", visual: { file: "projects/x/out/{run}/0.json", params: { run: "r1" } }, bind: { command: "python t.py --run {run}", watch: ["projects/{p}/src/*.py"] }, title: "t" })).rejects.toThrow("bind.watch[0]: {p} has no value")
    await lead.run("show", { id: "t", title: "t", visual: { file: "projects/x/out/{run}/0.json", params: { run: "r1", p: "x" } }, bind: { command: "python t.py --run {run}", watch: ["projects/{p}/src/*.py"] } })
    await expect(preview.ownerCall("open", [{ id: "preview", visual: "t", params: { p: "y" } }])).rejects.toThrow("bind.watch[0]: projects/y/src/*.py is outside lead's reads: lane")
    expect(preview.state.visuals.find((v) => v.id === "t").params).toEqual({ run: "r1", p: "x" }) // refused: nothing moved
  })

  test("bind loops (critic): a watch never holds another bound visual's file, nor is held by another bind's watch; a watched change starts the same bind at most every 10 s", async () => {
    let now = Date.parse("2026-10-17T14:00:00Z")
    const host = fakeHost({ files: { "projects/x/out/a.json": JSON.stringify(tok(0)), "projects/x/out/b.json": JSON.stringify(tok(1)), "projects/x/in/c.txt": "c" } })
    const preview = new Preview({ clock: () => new Date(now) })
    const lead = holder("lead", preview, host, {}, { writes: ["projects/x/out/**"], reads: ["projects/x/**"] })
    await lead.run("show", { id: "a", title: "A", visual: { file: "projects/x/out/a.json" }, bind: { command: "python a.py", watch: ["projects/x/in/*.txt"] } })
    // B watching A's file: refused
    await expect(lead.run("show", { id: "b", title: "B", visual: { file: "projects/x/out/b.json" }, bind: { command: "python b.py", watch: ["projects/x/out/a.json"] } })).rejects.toThrow("bind.watch[0]: projects/x/out/a.json holds projects/x/out/a.json, the file a's bound script writes — each script would start the other")
    await expect(lead.run("show", { id: "b", title: "B", visual: { file: "projects/x/out/b.json" }, bind: { command: "python b.py", watch: ["projects/x/out/a*"] } })).rejects.toThrow("holds projects/x/out/a.json, the file a's bound script writes")
    // B written where A's watch looks: refused too (the other direction)
    await lead.run("show", { id: "a", title: "A", visual: { file: "projects/x/out/a.json" }, bind: { command: "python a.py", watch: ["projects/x/in/*", "projects/x/out/sub/*"] } })
    await expect(lead.run("show", { id: "b", title: "B", visual: { file: "projects/x/out/sub/b.json" }, bind: { command: "python b.py", watch: ["projects/x/in/c.txt"] } })).rejects.toThrow("bind: a's bound script watches projects/x/out/sub/*, which holds projects/x/out/sub/b.json — each script would start the other")
    // the backstop: a watched file that keeps changing starts the bind at most every 10 s
    const starts = () => host.calls.filter((c) => c.path === "term/start").length
    let mtime = 1_800_000_000_000
    const change = async () => {
      host.touch("projects/x/in/c.txt", (mtime += 5000))
      preview.filesPulled = 0
      await preview.refresh(lead.agent)
    }
    await change()
    expect(starts()).toBe(1)
    now += 3000
    await change()
    expect(starts()).toBe(1)
    now += 8000
    await change()
    expect(starts()).toBe(2)
    // the owner's Re-run is never held back
    await preview.ownerCall("rerun", [{ id: "preview", visual: "a" }])
    expect(starts()).toBe(3)
  })
})


// 2026-10-18 owner: "the screenshot will be included along with the next request and the agent can iterate over in
// order to complete a live artifact and I can also observe it".
describe("preview: the screenshot goes with the next model call", () => {
  test("images(agent): the newest shot of the page that holder last acted on, once per shot; none for another holder", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    const critic = holder("critic", preview, host)
    expect(await preview.images(coder.agent)).toEqual([])
    await coder.run("open", { url: "http://localhost:8090/model.html" })
    const id = preview.state.pages[0].id
    const [img] = await preview.images(coder.agent)
    expect(img).toMatchObject({ media_type: "image/jpeg", data: btoa(`${id}#1`), ref: { source: "preview", page: id, n: 1, width: 1280, height: 800, url: `/__askk/browser/shot?id=${id}&n=1` } })
    expect(img.caption).toContain(`screenshot 1 of preview page ${id} — http://localhost:8090/model.html`)
    expect(await preview.images(coder.agent)).toEqual([]) // seen
    expect(await preview.images(critic.agent)).toEqual([]) // it did not act on the page
    await coder.run("click", { selector: "#block-2" })
    expect((await preview.images(coder.agent)).map((i) => i.ref.n)).toEqual([2])
    await critic.run("shot")
    expect((await preview.images(critic.agent)).map((i) => i.ref.n)).toEqual([3])
    expect((await preview.images(coder.agent)).map((i) => i.ref.n)).toEqual([3]) // the page it acted on has a newer shot
  })

  test("a host that cannot give the image: no images, the step goes on", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await coder.run("open", { url: "http://localhost:8090/" })
    const get = host.get
    host.get = (path, o) => (path.startsWith("browser/image") ? Promise.reject(new Error("HTTP 404")) : get(path, o))
    coder.agent.context.host = host
    expect(await preview.images(coder.agent)).toEqual([])
  })

  test("the agent's step: the image goes to infer and its ref to the step event; the next step sends none", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const seen = []
    const replies = ['{"thought":"open it","calls":[{"tool":"preview.open","input":{"url":"http://localhost:8090/model.html"}}]}', '{"thought":"fix the legend","calls":[{"tool":"preview.shot","input":{}}]}', '{"answer":"done"}']
    const agent = new Agent(
      { name: "coder", report: false },
      {
        infer: async (prompt, _agent, options) => {
          seen.push(options?.images ?? null)
          return replies.shift()
        },
        context: { host },
      },
    ).addArtifact(preview)
    const steps = []
    agent.on("step", (e) => steps.push(e.images ?? null))
    await agent.ask("build the model page")
    expect(seen[0]).toBeNull() // no page yet
    expect(seen[1].map((i) => [i.media_type, i.ref.n])).toEqual([["image/jpeg", 1]])
    expect(seen[2].map((i) => i.ref.n)).toEqual([2]) // preview.shot: a new one
    expect(steps[1]).toEqual([{ caption: seen[1][0].caption, source: "preview", page: seen[1][0].ref.page, n: 1, width: 1280, height: 800, url: seen[1][0].ref.url }])
    expect(JSON.stringify(steps)).not.toContain(seen[1][0].data) // the event carries no image data
  })
})

// 2026-10-18: the lead's two refused preview.show calls for one owner answer — a spec as indented text, and the reply
// format's reading of it as a list.
describe("preview.show: a spec written as text", () => {
  const TEXT = "kind: bars\ntitle: embedding share of params\ncaption: V × d\nbars:\n- label: ours r04-base (32,256×256, tied)\n  value: 8257536\n- label: ours non-embedding\n  value: 4820224"
  test("indented key: value text is read as the spec", async () => {
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, fakeHost())
    expect(await lead.run("show", { id: "embed-share", title: "embedding share", visual: TEXT })).toContain("embed-share")
    expect(preview.state.visuals[0].visual).toMatchObject({ kind: "bars", title: "embedding share of params", frames: [{ bars: [{ label: "ours r04-base (32,256×256, tied)", value: 8257536 }, { label: "ours non-embedding", value: 4820224 }] }] })
  })
  test("the list form (spec first, its empty key's entries after) is folded back", async () => {
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, fakeHost())
    const list = [{ kind: "bars", title: "share (%)", bars: "" }, { label: "r04-base", value: 63.1 }, { label: "T5Gemma 2 270M", value: 45.7 }]
    await lead.run("show", { id: "embed-share", title: "share", visual: list })
    expect(preview.state.visuals[0].visual).toMatchObject({ kind: "bars", frames: [{ bars: [{ label: "r04-base", value: 63.1 }, { label: "T5Gemma 2 270M", value: 45.7 }] }] })
  })
  test("text that is no spec: an error that shows both ways to write it; a one-line path stays a file", async () => {
    const preview = new Preview({ clock })
    const lead = holder("lead", preview, fakeHost())
    await expect(lead.run("show", { id: "x", title: "x", visual: "kind: bars\nthis line is prose" })).rejects.toThrow('write it as JSON on one line (visual: {"kind": "bars"')
  })
})
