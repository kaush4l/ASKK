// The stage artifact (backend/kernel/builtin/stage.js, 2026-10-17) over a fake host: a page goes on stage only after
// the preview opened it clean, the story is scenes in order, the owner's questions come in through ownerCall and gate
// the keeper's answer until stage.reply answers them; the prompt and the twin as the spec says.

import { describe, expect, test } from "bun:test"
import { Agent } from "../index.js"
import { Stage, stageUrl } from "../builtin/stage.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T23:30:00Z")
function holder(name, stage, host, hold = {}) {
  const agent = new Agent({ name, report: false }, { infer: async () => "", context: { host } }).addArtifact(stage, hold)
  const run = (cmd, input = {}) => agent.tools.get(`${stage.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}
const story = async (lead) => {
  await lead.run("scene", { id: "training", title: "Loss falls", view: "training", says: "val_bpb 0.7636 → 0.6755 over 18 runs" })
  await lead.run("scene", { id: "attention", title: "Heads", view: "attention", says: "head 2.1 attends to the previous token (82%)", params: { layer: 2, head: 1 } })
}

describe("stage", () => {
  test("stageUrl: only http(s) pages on this computer with a port; the #view is dropped", () => {
    expect(stageUrl("http://127.0.0.1:8077/#attention")).toBe("http://127.0.0.1:8077/")
    expect(() => stageUrl("https://example.org:8077/")).toThrow("only pages on this computer")
    expect(() => stageUrl("http://localhost/")).toThrow("name the page's port")
    expect(() => stageUrl("file:///tmp/x.html")).toThrow("only http(s) pages")
    expect(() => stageUrl("dashboard")).toThrow("is not a URL")
  })

  test("show: refused until the preview has the page open with no console error; then on stage", async () => {
    const host = fakeHost()
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, host)
    await expect(lead.run("show", { url: "http://127.0.0.1:8077/" })).rejects.toThrow("is not open in the preview: preview.open")
    await host.post("browser/open", { url: "http://localhost:8077/#training", by: "coder" })
    host.pages[0].errors = 2
    await expect(lead.run("show", { url: "http://127.0.0.1:8077/" })).rejects.toThrow("has 2 console errors in the preview")
    host.pages[0].errors = 0
    expect(await lead.run("show", { url: "http://127.0.0.1:8077/", title: "sample-app story" })).toBe('on stage: http://127.0.0.1:8077/ "sample-app story"; no scenes yet — stage.scene {id, title, view, says} writes the story')
    expect(stage.state.page).toEqual({ url: "http://127.0.0.1:8077/", title: "sample-app story", by: "lead", at: "2026-10-17T23:30:00.000Z" })
    expect(lead.agent.tools.get("stage.show").type).toBe("dev")
    expect(lead.agent.tools.get("stage.scene").view).toBe("stage")
  })

  test("scene adds in order (the first becomes current), the same id replaces; go, cut; bad input is refused", async () => {
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, fakeHost())
    await story(lead)
    expect(stage.state.scenes.map((s) => s.id)).toEqual(["training", "attention"])
    expect(stage.state.current).toBe("training")
    expect(stage.state.scenes[1]).toEqual({ id: "attention", title: "Heads", view: "attention", says: "head 2.1 attends to the previous token (82%)", params: { layer: 2, head: 1 }, visual: null, by: "lead", at: "2026-10-17T23:30:00.000Z" })
    expect(await lead.run("scene", { id: "training", title: "Loss", view: "training", says: "now 0.6700", params: '{"run": "r17"}' })).toBe("scene training replaced — the owner is on it")
    expect(stage.state.scenes[0].params).toEqual({ run: "r17" })
    const before = stage.state.revision
    expect(await lead.run("go", { id: "attention" })).toBe('the owner is taken to scene attention "Heads" (#attention)')
    expect(stage.state.revision).toBe(before + 1)
    await expect(lead.run("go", { id: "latent" })).rejects.toThrow("no scene latent; scenes: training, attention")
    await expect(lead.run("scene", { id: "x y", says: "s" })).rejects.toThrow('id: "x y"')
    await expect(lead.run("scene", { id: "w", says: "" })).rejects.toThrow("says: what the owner should see")
    await expect(lead.run("scene", { id: "w", says: "s", params: "[1]" })).rejects.toThrow("params: an object")
    expect(await lead.run("cut", { id: "attention" })).toBe("scene attention cut; 1 left")
    expect(stage.state.current).toBe("training")
  })

  test("the owner asks: an open question for the keeper, its delivery text names the scene and what was pointed at", async () => {
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, fakeHost())
    holder("coder", stage, fakeHost(), { commands: ["show", "scene"] })
    await story(lead)
    expect(stage.keeper()).toBe("lead")
    const r = stage.ownerCall("ask", [{ text: "why the previous token?", scene: "attention", context: { layer: 2, head: 1, step: 800 } }])
    expect(r.keeper).toBe("lead")
    expect(r.ask).toEqual({ id: "q1", text: "why the previous token?", scene: "attention", context: { layer: 2, head: 1, step: 800 }, from: "owner", at: "2026-10-17T23:30:00.000Z", answer: null })
    expect(r.deliver).toBe('On the stage the owner asks (q1, scene attention "Heads" (#attention, layer 2, head 1), pointing at layer 2, head 1, step 800): "why the previous token?"\nAnswer it on the stage: stage.reply {ask: "q1", text, scene?} — a scene that shows the answer (stage.scene, then reply with its id) says more than words.')
    expect(stage.ownerCall("ask", [{ text: "and the loss?", scene: "nope" }]).ask).toMatchObject({ id: "q2", scene: null })
    expect(() => stage.ownerCall("ask", [{ text: " " }])).toThrow("text: the question")
    expect(() => stage.ownerCall("go", [{}])).toThrow("the owner can ask (not go)")
  })

  test("gate: the keeper's answer waits for stage.reply; a reply with a scene takes the owner there; others are not gated", async () => {
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, fakeHost())
    const coder = holder("coder", stage, fakeHost(), { commands: ["scene"] })
    await story(lead)
    stage.ownerCall("ask", [{ text: "why the previous token?", scene: "attention" }])
    expect(stage.gate(lead.agent)).toBe('the owner asked on the stage: q1 "why the previous token?" — stage.reply {ask, text, scene?} each first')
    expect(stage.gate(coder.agent)).toBeNull()
    await expect(lead.run("reply", { ask: "q9", text: "x" })).rejects.toThrow("no question q9; open: q1")
    await expect(lead.run("reply", { ask: "q1", text: "" })).rejects.toThrow("text: the answer")
    expect(await lead.run("reply", { ask: "q1", text: "an induction head: 82% of its weight on t-1 at step 800", scene: "attention" })).toBe("q1 answered; the owner is taken to scene attention")
    expect(stage.state.current).toBe("attention")
    expect(stage.state.asks[0].answer).toEqual({ text: "an induction head: 82% of its weight on t-1 at step 800", scene: "attention", by: "lead", at: "2026-10-17T23:30:00.000Z" })
    expect(stage.gate(lead.agent)).toBeNull()
  })

  test("past 40 questions answered ones go first, open ones stay", () => {
    const stage = new Stage({ clock })
    for (let i = 0; i < 39; i++) stage.ownerCall("ask", [{ text: `open ${i}` }])
    stage.state.asks[0].answer = { text: "done", scene: null, by: "lead", at: null }
    stage.ownerCall("ask", [{ text: "q40" }])
    stage.ownerCall("ask", [{ text: "q41" }])
    expect(stage.state.asks.length).toBe(40)
    expect(stage.state.asks.some((a) => a.answer)).toBe(false)
    expect(stage.state.asks.at(-1).id).toBe("q41")
  })

  test("prompt: the commands the holder has, the page, the story with ▶, open and answered questions", async () => {
    const host = fakeHost()
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, host)
    const coder = holder("coder", stage, host, { commands: ["scene"] })
    expect(stage.render(lead.agent)).toContain("PAGE: none yet")
    await host.post("browser/open", { url: "http://127.0.0.1:8077/" })
    await lead.run("show", { url: "http://127.0.0.1:8077/", title: "story" })
    await story(lead)
    stage.ownerCall("ask", [{ text: "why?", scene: "attention", context: { head: 1 } }])
    stage.ownerCall("ask", [{ text: "loss?" }])
    await lead.run("reply", { ask: "q2", text: "0.6755 at r17", scene: "training" })
    expect(stage.render(lead.agent)).toBe(
      [
        "the owner's stage — the page they watch and the story over it: stage.show {url, title?} puts a page on it (open and check it in the preview first); stage.scene {id, title, view, says, params?} adds or replaces a scene; stage.go {id} takes the owner there; stage.reply {ask, text, scene?} answers a question asked on it; stage.cut {id}",
        'PAGE: http://127.0.0.1:8077/ "story" (shown by lead at 2026-10-17T23:30:00.000Z)',
        "STORY (▶ = where the owner is taken):",
        '▶ training "Loss falls" #training — val_bpb 0.7636 → 0.6755 over 18 runs',
        '  attention "Heads" #attention {layer 2, head 1} — head 2.1 attends to the previous token (82%)',
        "OWNER ASKED (open — stage.reply each):",
        '  q1 at attention {head 1}: "why?"',
        "ANSWERED (latest):",
        '  q2 "loss?" → 0.6755 at r17 [training]',
      ].join("\n"),
    )
    expect(stage.render(coder.agent).split("\n")[0]).toBe("the owner's stage — the page they watch and the story over it: stage.scene {id, title, view, says, params?} adds or replaces a scene")
    expect(stage.render(coder.agent)).toContain("OWNER ASKED (open):")
    expect(stage.brief()).toBe("story · 2 scenes · ▶ training · 1 question open")
  })

  test("a visual the agent builds: inline (checked now) or a file (read now, again as it changes, last kept on error)", async () => {
    const loss = (n) => JSON.stringify({ kind: "line", series: [{ name: "r17", points: Array.from({ length: n }, (_, i) => [i * 10, 8 - i]) }] })
    const host = fakeHost({ files: { "projects/sample-app/out/story/visuals/loss.json": loss(2), ".env.json": "{}" } })
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, host)
    expect(await lead.run("scene", { id: "arch", title: "Two ways", says: "same 14M params", visual: { kind: "compare", sides: [{ title: "encoder-decoder", visual: { kind: "steps", steps: ["encode", "cross-attend"] } }, { title: "decoder-only", visual: { kind: "steps", steps: ["attend causally"] } }] } })).toBe("scene arch added (1 of 16) — the owner is on it")
    expect(stage.state.scenes[0].visual.sides[1]).toEqual({ title: "decoder-only", visual: { kind: "steps", steps: [{ title: "attend causally" }] } })
    await expect(lead.run("scene", { id: "bad", says: "x", visual: { kind: "pie" } })).rejects.toThrow('visual.kind: "pie"')
    await expect(lead.run("scene", { id: "bad", says: "x", visual: { file: "projects/sample-app/out/none.json" } })).rejects.toThrow("projects/sample-app/out/none.json: not found")
    await expect(lead.run("scene", { id: "bad", says: "x", visual: { file: "projects/x/notes.md" } })).rejects.toThrow("a .json file holding a visual spec")

    await lead.run("scene", { id: "loss", title: "Loss", says: "falls", visual: "projects/sample-app/out/story/visuals/loss.json" })
    const shown = stage.state.scenes[1].visual
    expect(shown).toMatchObject({ kind: "line", file: "projects/sample-app/out/story/visuals/loss.json", read_at: "2026-10-17T23:30:00.000Z" })
    expect(shown.series[0].points.length).toBe(2)
    expect(stage.render(lead.agent)).toContain('  loss "Loss" #loss [visual line 1 series, 2 points from projects/sample-app/out/story/visuals/loss.json] — falls')

    const rev = stage.state.revision
    stage.pulled = 0
    await stage.refresh(lead.agent)
    expect(stage.state.revision).toBe(rev) // the same text: nothing to stream
    host.fs.set("projects/sample-app/out/story/visuals/loss.json", loss(5))
    stage.pulled = 0
    await stage.refresh(lead.agent)
    expect(stage.state.scenes[1].visual.series[0].points.length).toBe(5)
    host.fs.set("projects/sample-app/out/story/visuals/loss.json", "{broken")
    stage.pulled = 0
    await stage.refresh(lead.agent)
    expect(stage.state.scenes[1].visual.series[0].points.length).toBe(5)
    expect(stage.state.scenes[1].visual.error).toBe("projects/sample-app/out/story/visuals/loss.json: visual: not JSON — an object such as {\"kind\": \"flow\", \"nodes\": [...], \"edges\": [...]}")
    expect(stage.render(lead.agent)).toContain("— ERROR projects/sample-app/out/story/visuals/loss.json: visual: not JSON")

    // Saved: a file visual as its path only, read again after a restart; an inline one whole.
    const saved = stage.snapshot()
    expect(saved.scenes[1].visual).toEqual({ file: "projects/sample-app/out/story/visuals/loss.json" })
    expect(saved.scenes[0].visual.kind).toBe("compare")
    const back = new Stage({ clock })
    holder("lead", back, host)
    back.restore(saved)
    expect(back.state.scenes[1].visual).toEqual({ file: "projects/sample-app/out/story/visuals/loss.json", error: "not read yet" })
    host.fs.set("projects/sample-app/out/story/visuals/loss.json", loss(3))
    await back.refresh(holder("lead2", back, host).agent)
    expect(back.state.scenes[1].visual.series[0].points.length).toBe(3)
  })

  test("a visual file outside the holder's reads: lane is refused", async () => {
    const host = fakeHost({ files: { "projects/x/src/v.json": '{"kind": "steps", "steps": ["a"]}' } })
    const stage = new Stage({ clock })
    const critic = new Agent({ name: "critic", report: false, reads: ["projects/*/out/**"] }, { infer: async () => "", context: { host } }).addArtifact(stage)
    await expect(critic.tools.get("stage.scene").run({ id: "v", says: "x", visual: { file: "projects/x/src/v.json" } }, { ...critic.context, agent: critic })).rejects.toThrow("visual.file: projects/x/src/v.json is outside critic's reads: lane")
  })

  test("twin, snapshot and restore: keep always, view stage; restore drops what does not fit", async () => {
    const stage = new Stage({ clock })
    const lead = holder("lead", stage, fakeHost())
    await story(lead)
    stage.ownerCall("ask", [{ text: "why?" }])
    const twin = stage.twin()
    expect(twin).toMatchObject({ element: "artifact", id: "stage", kind: "stage", view: "stage", keep: "always", brief: "no page · 2 scenes · ▶ training · 1 question open" })
    expect(twin.state.scenes.length).toBe(2)
    const copy = new Stage({ clock })
    copy.restore({ ...stage.snapshot(), scenes: [...stage.snapshot().scenes, { id: "bad id!", says: "x" }], current: "gone" })
    expect(copy.state.scenes.map((s) => s.id)).toEqual(["training", "attention"])
    expect(copy.state.current).toBeNull()
    expect(copy.state.asks[0]).toMatchObject({ id: "q1", text: "why?", answer: null })
    copy.restore({ nope: true })
    expect(copy.state.scenes.length).toBe(2)
    expect(new Stage({ clock }).brief()).toBe("nothing on stage yet")
  })
})
