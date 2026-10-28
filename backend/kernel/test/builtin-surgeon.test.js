// Surgeon (2026-10-26 owner: "an LLM surgeon live artifact … pause it at steps to understand … like the intellij
// debug"): a model run under a debugger in the holder's terminal. The runtime is faked here: every cmd.json the
// artifact writes is answered with a state.json, the way custom/lab's lab/askklab/surgeon.py answers it.

import { describe, expect, test } from "bun:test"
import { BUILTIN, Surgeon, checkVisual } from "../index.js"
import { fakeHost } from "./fake-host.js"

const now = () => new Date("2026-10-26T21:00:00Z")
const agent = (host) => ({ name: "lab", config: { writes: ["surgeon/**", "lab/views/**"] }, context: { host } })
const cmd = (s, name) => s.commands().find((t) => t.name === `surgeon.${name}`)

const firstState = (pid) => ({ run: { script: "experiments/tiny-gpt/run.py", pid, started: "2026-10-26T17:00:00", phase: "train" }, status: "paused", heartbeat: Date.now() / 1000, ack: 0, step: 1, phase: "train", frame: { kind: "step", point: null, step: 1, phase: "train", call: 0, reason: "stepped to train step 1", tensors: [{ name: "tok.weight", shape: [96, 128], mean: 0.01, std: 1, nan: 0 }], tokens: ["d", "e", "f"] }, flow: [], points: ["tok", "pos", "blocks.0.attn", "head"], breakpoints: [], patches: [], metrics: { loss: [[1, 4.6]] }, views: [], log: ["debugger attached: 4 debug points"], error: null })

// A fake runtime: paused at start; answers each new command by rewriting state.json (answer: false — it never does).
function rig({ pid = 4242, answer = true } = {}) {
  const raw = fakeHost()
  const rt = firstState(pid)
  const save = () => raw.post("fs/write", { path: "surgeon/state.json", text: JSON.stringify({ ...rt, heartbeat: Date.now() / 1000 }) })
  const seen = []
  const host = {
    get: (p, o) => raw.get(p, o),
    async post(path, body, o) {
      const r = await raw.post(path, body, o)
      if (path === "term/start") await save()
      if (answer && path === "fs/write" && body.path === "surgeon/cmd.json") {
        for (const c of JSON.parse(body.text).cmds.filter((c) => c.n > rt.ack)) {
          seen.push(c)
          rt.ack = c.n
          if (c.do === "break") rt.breakpoints.push({ id: `b${rt.breakpoints.length + 1}`, at: c.at, ...(c.every != null ? { every: c.every } : {}) })
          if (c.do === "continue") Object.assign(rt, { status: "paused", step: 50, frame: { kind: "forward", point: "blocks.0.attn", step: 50, phase: "train", call: 9, reason: "b1 at blocks.0.attn step 50", tensors: [{ name: "out", shape: [32, 64, 128], mean: 0, std: 0.4, nan: 0 }, { name: "attn", shape: [32, 4, 64, 64], mean: 0.03, std: 0.1, nan: 0 }], tokens: ["a", "b"] }, flow: [{ point: "tok", calls: 50, absmean: 0.8 }, { point: "blocks.0.attn", calls: 50, absmean: 0.2 }], metrics: { loss: [[50, 2.6]] } })
          if (c.do === "inspect") {
            const id = c.id ?? "v1"
            await raw.post("fs/write", { path: `surgeon/views/${id}.json`, text: JSON.stringify({ kind: "matrix", title: "attn at blocks.0.attn", values: [[0.5, 0.5], [0, 1]] }) })
            rt.views.push({ id, title: "attn at blocks.0.attn", point: "blocks.0.attn", step: 50, phase: "train", target: c.target ?? "attn", view: c.script ? "script:feat" : "attn", at: "17:01:00" })
          }
          if (c.do === "stop") Object.assign(rt, { status: "ended", frame: null })
        }
        await save()
      }
      return r
    },
  }
  return { host, raw, rt, seen, save }
}

describe("surgeon: a model run under the debugger", () => {
  test("start runs the script in debug in the holder's long terminal session with the gpu lease, and reads the first pause", async () => {
    const { host, raw } = rig()
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 200 })
    const out = await cmd(s, "start").run({ script: "experiments/tiny-gpt/run.py", args: "--mode train --steps 300 --pause-at-start", why: "see attention form" }, { agent: agent(host) })
    const start = raw.calls.find((c) => c.path === "term/start").body
    expect(start).toMatchObject({ command: "uv run --frozen --no-sync python -B experiments/tiny-gpt/run.py --mode train --steps 300 --pause-at-start --debug --folder surgeon", slot: "long", lease: "gpu", replace: true, agent: "lab", writes: ["surgeon/**", "lab/views/**"] })
    expect(out).toContain("started: PAUSED at the step boundary (train step 1) — stepped to train step 1")
    expect(s.state.session).toMatchObject({ script: "experiments/tiny-gpt/run.py", by: "lab", why: "see attention form" })
    expect(s.state.runtime.points).toEqual(["tok", "pos", "blocks.0.attn", "head"])
  })

  test("refuses a script outside the workspace and args that are not plain words", async () => {
    const { host } = rig()
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 50 })
    await expect(cmd(s, "start").run({ script: "../x.py" }, { agent: agent(host) })).rejects.toThrow("script: the run script")
    await expect(cmd(s, "start").run({ script: "a.py", args: "--prompt 'hi there'" }, { agent: agent(host) })).rejects.toThrow(`args: "'hi"`)
    await expect(cmd(s, "start").run({ script: "a.py", args: "--folder elsewhere" }, { agent: agent(host) })).rejects.toThrow("--debug and --folder are added here")
    await expect(cmd(s, "continue").run({}, { agent: agent(host) })).rejects.toThrow("no run: surgeon.start")
  })

  test("break, continue, inspect: commands numbered in cmd.json, each answered with where the run stopped; the view drawn inline", async () => {
    const { host, seen } = rig()
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 200 })
    const ctx = { agent: agent(host) }
    await cmd(s, "start").run({ script: "experiments/tiny-gpt/run.py" }, ctx)
    await expect(cmd(s, "break").run({ at: "blocks.9.attn" }, ctx)).rejects.toThrow('at: "blocks.9.attn" is not a debug point — tok, pos, blocks.0.attn, head, step, *')
    expect(await cmd(s, "break").run({ at: "blocks.0.attn", every: "50" }, ctx)).toStartWith("break → PAUSED")
    expect(await cmd(s, "continue").run({}, ctx)).toBe("continue → PAUSED at blocks.0.attn (train step 50) — b1 at blocks.0.attn step 50 · loss 2.60")
    expect(await cmd(s, "inspect").run({ target: "attn", id: "a50" }, ctx)).toContain("view a50: attn at blocks.0.attn (in the surgeon pane)")
    expect(seen.map((c) => [c.n, c.do])).toEqual([[1, "break"], [2, "continue"], [3, "inspect"]])
    expect(seen[0]).toMatchObject({ at: "blocks.0.attn", every: 50 })
    expect(s.state.views).toHaveLength(1)
    expect(s.state.views[0].visual).toEqual(checkVisual({ kind: "matrix", title: "attn at blocks.0.attn", values: [[0.5, 0.5], [0, 1]] }))
    const prompt = s.render()
    expect(prompt).toContain("FRAME forward blocks.0.attn call 9: out [32,64,128] mean 0 std 0.400 · attn [32,4,64,64]")
    expect(prompt).toContain("FLOW (forward order, |act| mean): tok 0.800 › blocks.0.attn 0.200 ◀")
    expect(prompt).toContain("BREAKPOINTS b1 blocks.0.attn every 50")
    expect(prompt).toContain("VIEWS a50 attn of attn at blocks.0.attn step 50")
    expect(s.brief()).toBe("paused at blocks.0.attn · step 50 · 1 breakpoints · 1 views")
  })

  test("inspect only where it stopped; a script view must be a workspace .py; compare names views it has", async () => {
    const { host, rt, save } = rig()
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 200 })
    const ctx = { agent: agent(host) }
    await cmd(s, "start").run({ script: "experiments/tiny-gpt/run.py" }, ctx)
    await expect(cmd(s, "inspect").run({ script: "/etc/x.py" }, ctx)).rejects.toThrow("script: a workspace .py path")
    await expect(cmd(s, "inspect").run({ view: "spectrum" }, ctx)).rejects.toThrow("view: auto | attn | lens")
    await cmd(s, "inspect").run({ script: "lab/views/feat.py", target: "out", id: "f1" }, ctx)
    await cmd(s, "inspect").run({ target: "attn", id: "f2" }, ctx)
    await expect(cmd(s, "compare").run({ a: "f1", b: "nope" })).rejects.toThrow('"nope" is not a view — f1, f2')
    expect(await cmd(s, "compare").run({ a: "f1", b: "f2", note: "before vs after" })).toBe("comparing f1 and f2 side by side in the surgeon pane")
    expect(s.state.compare).toEqual({ a: "f1", b: "f2", note: "before vs after" })
    Object.assign(rt, { status: "running", frame: null })
    await save()
    await s.refresh(agent(host))
    await expect(cmd(s, "inspect").run({}, ctx)).rejects.toThrow("the run is running: inspect works where it stopped")
  })

  test("the owner drives the same run from the view: break, continue, stop — never a run of an agent", async () => {
    const { host, seen } = rig()
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 200, ownerWaitMs: 200 })
    s.attach(agent(host))
    await cmd(s, "start").run({ script: "experiments/tiny-gpt/run.py" }, { agent: agent(host) })
    expect(await s.ownerCall("break", [{ id: "surgeon", at: "blocks.0.attn" }])).toMatchObject({ sent: "break" })
    expect((await s.ownerCall("continue", [{ id: "surgeon" }])).text).toContain("PAUSED at blocks.0.attn")
    expect((await s.ownerCall("stop", [{ id: "surgeon" }])).text).toStartWith("stop → ended")
    expect(s.state.session.status).toBe("ended")
    expect(seen.map((c) => c.do)).toEqual(["break", "continue", "stop"])
    expect(() => s.ownerCall("start", [{}])).toThrow("the owner can continue, step, next, pause, stop, break, clear, inspect, unpatch, compare, timeline, replay, source, diff or ask (not start)")
  })

  test("a run whose heartbeat stopped reads stale; a command it never takes says it waits", async () => {
    const { host, rt } = rig({ answer: false })
    const s = new Surgeon({ clock: now, pollMs: 1, waitMs: 30 })
    await cmd(s, "start").run({ script: "experiments/tiny-gpt/run.py" }, { agent: agent(host) })
    await host.post("fs/write", { path: "surgeon/state.json", text: JSON.stringify({ ...rt, heartbeat: Date.now() / 1000 - 60 }) })
    await s.refresh(agent(host))
    expect(s.state.stale).toBe(true)
    expect(s.brief()).toContain("no heartbeat")
    expect(s.render()).toContain("NO HEARTBEAT for 15 s")
    expect(await cmd(s, "pause").run({}, { agent: agent(host) })).toBe("pause sent (command 1) — the runtime has not taken it yet (no heartbeat: is the run alive? terminal.read its session)")
  })

  // 2026-10-26 owner ("the lead should be able to visual code the last run and show me the live replay … relating
  // between procedure and observation … change the code run the training"): every run is recorded by the runtime.
  const MODEL_V1 = "class Attention(nn.Module):\n    def forward(self, x):\n        att = q @ k\n        return self.proj(att @ v)\n\nclass Block(nn.Module):\n    def forward(self, x):\n        x = x + self.attn(self.ln1(x))\n        return x + self.mlp(self.ln2(x))\n"
  const MODEL_V2 = MODEL_V1.replace("att = q @ k", "att = (q @ k) / 8")
  const record = (id, over = {}) => ({ id, script: "experiments/tiny-gpt/run.py", args: { mode: "train", steps: 300, lr: 0.003 }, config: { d: 128 }, phase: "train", status: "ended", step: 300, total: 300, final: { loss: 2.1, val_loss: 2.3 }, series: { loss: [[1, 4.6], [150, 2.6], [300, 2.1]], val_loss: [[100, 2.9], [300, 2.3]] }, flow: { points: ["tok", "blocks.0.attn"], steps: [1, 150, 300], values: [[0.8, 0.8, 0.8], [0.1, 0.3, 0.6]] }, snaps: [1, 10, 100, 300], files: ["experiments/tiny-gpt/model.py"], code_map: { "blocks.0.attn": { cls: "Attention", def: { file: "experiments/tiny-gpt/model.py", line: 2, end: 4 }, call: { file: "experiments/tiny-gpt/model.py", line: 8, text: "x = x + self.attn(self.ln1(x))" } }, "blocks.0.ln1": { cls: "LayerNorm", def: null, call: { file: "experiments/tiny-gpt/model.py", line: 8, text: "x = x + self.attn(self.ln1(x))" } } }, parent: null, ...over })
  const recorded = (onStart) =>
    fakeHost({
      onStart,
      files: {
        "surgeon/runs/index.json": JSON.stringify({ runs: [{ id: "r1", script: "experiments/tiny-gpt/run.py", status: "ended", step: 300, total: 300, final: { loss: 2.1 }, snaps: 4, args: "--mode=train --steps=300" }, { id: "r2", script: "experiments/tiny-gpt/run.py", phase: "train", status: "ended", step: 300, total: 300, final: { loss: 1.9 }, snaps: 4, parent: "r1", args: "--mode=train --steps=300 --lr=0.006" }] }),
        "surgeon/runs/r1/run.json": JSON.stringify(record("r1")),
        "surgeon/runs/r2/run.json": JSON.stringify(record("r2", { parent: "r1", args: { mode: "train", steps: 300, lr: 0.006 }, final: { loss: 1.9, val_loss: 2.0 } })),
        "surgeon/runs/r1/code/experiments/tiny-gpt/model.py": MODEL_V1,
        "surgeon/runs/r2/code/experiments/tiny-gpt/model.py": MODEL_V2,
      },
    })

  test("runs and timeline: the recorded runs listed, a run's whole course put in the pane", async () => {
    const host = recorded()
    const s = new Surgeon({ clock: now })
    await s.refresh(agent(host))
    expect(s.state.runs.map((r) => r.id)).toEqual(["r1", "r2"])
    expect(await cmd(s, "runs").run({})).toContain("r2 ended train step 300/300 --mode=train --steps=300 --lr=0.006 · loss 1.90 · 4 snapshots · after r1")
    const out = await cmd(s, "timeline").run({ run: "r1" }, { agent: agent(host) })
    expect(out).toContain("timeline r1 (ended, step 300/300) in the surgeon pane")
    expect(out).toContain("grew most: blocks.0.attn 0.100→0.600")
    expect(s.state.timeline).toMatchObject({ run: "r1", snaps: [1, 10, 100, 300], flow: { points: ["tok", "blocks.0.attn"], steps: [1, 150, 300] } })
    await expect(cmd(s, "timeline").run({ run: "r9" }, { agent: agent(host) })).rejects.toThrow("run r9: not recorded here — r1, r2")
    expect(s.render()).toContain("RUNS (recorded) r1 ended step 300 loss 2.10 4 snaps · r2 ended step 300 loss 1.90 4 snaps")
    expect(s.render()).toContain("TIMELINE r1 in the pane (4 snapshots)")
  })

  test("replay: the run's own --replay mode in the replay terminal slot; the view checked and kept with the numbers per step", async () => {
    let host
    host = recorded((body) => {
      host.post("fs/write", { path: "surgeon/views/rp1.json", text: JSON.stringify({ kind: "matrix", title: "r2 replay — attn", frames: [{ label: "step 1", values: [[1, 0], [0.5, 0.5]] }, { label: "step 300", values: [[1, 0], [0.9, 0.1]] }] }) })
      return { status: "exited", exit: 0, lines: ["replay r2: attn at blocks.0.attn, 2 snapshots", "step 1: entropy 0.7 nats", "step 300: entropy 0.2 nats", "wrote surgeon/views/rp1.json"] }
    })
    const s = new Surgeon({ clock: now })
    const out = await cmd(s, "replay").run({ view: "attn", at: "blocks.0.attn", head: "2" }, { agent: agent(host) })
    const start = host.calls.find((c) => c.path === "term/start").body
    expect(start).toMatchObject({ command: "uv run --frozen --no-sync python -B experiments/tiny-gpt/run.py --folder surgeon --replay r2 --view attn --at blocks.0.attn --head 2 --id rp1", slot: "replay:rp1", agent: "lab", writes: ["surgeon/**", "lab/views/**"], wait: 300 })
    expect(out).toContain("replay rp1: r2 replay — attn — 4 frames (steps 1…300), playing in the surgeon pane")
    expect(out).toContain("step 300: entropy 0.2 nats")
    expect(s.state.replays[0]).toMatchObject({ id: "rp1", run: "r2", view: "attn", at: "blocks.0.attn", lines: ["step 1: entropy 0.7 nats", "step 300: entropy 0.2 nats"] })
    expect(s.state.replays[0].visual.frames).toHaveLength(2)
    await expect(cmd(s, "replay").run({ view: "attn", at: "blocks.9.attn" }, { agent: agent(host) })).rejects.toThrow('at: "blocks.9.attn" is not a debug point of r2')
    await expect(cmd(s, "replay").run({ view: "attn" }, { agent: agent(host) })).rejects.toThrow("at: the debug point to replay")
    await expect(cmd(s, "replay").run({ view: "spectrum" }, { agent: agent(host) })).rejects.toThrow("view: auto | attn | lens")
    expect(await cmd(s, "compare").run({ a: "rp1", b: "rp1" })).toContain("comparing rp1 and rp1")
  })

  test("a replay that fails keeps the reason; the owner's replay writes only the surgeon folder", async () => {
    const host = recorded(() => ({ status: "exited", exit: 1, lines: ["Traceback …", "replay: target 'weight' — out | in | attn | a parameter of blocks.0.attn: qkv.weight"] }))
    const s = new Surgeon({ clock: now })
    s.attach(agent(host))
    const r = await s.ownerCall("replay", [{ id: "surgeon", run: "r1", view: "matrix", at: "blocks.0.attn", target: "weight" }])
    expect(r.text).toContain("replay failed (exit 1): replay: target 'weight'")
    expect(host.calls.find((c) => c.path === "term/start").body).toMatchObject({ agent: null, writes: ["surgeon/**"] })
    expect(s.state.replays[0].error).toContain("a parameter of blocks.0.attn: qkv.weight")
  })

  test("source: the procedure behind a point from that run's copy of the code — its forward, or the line that calls a library module", async () => {
    const host = recorded()
    const s = new Surgeon({ clock: now })
    const own = await cmd(s, "source").run({ point: "blocks.0.attn", run: "r1" }, { agent: agent(host) })
    expect(own).toContain("SOURCE blocks.0.attn (Attention) — r1's experiments/tiny-gpt/model.py:2-4; called at experiments/tiny-gpt/model.py:8: x = x + self.attn(self.ln1(x))")
    expect(own).toContain("   3           att = q @ k")
    expect(s.state.source).toMatchObject({ run: "r1", point: "blocks.0.attn", from: 2, to: 4, mark: null })
    const lib = await cmd(s, "source").run({ point: "blocks.0.ln1", run: "r1" }, { agent: agent(host) })
    expect(lib).toContain("   8 ▶         x = x + self.attn(self.ln1(x))")
    expect(s.state.source).toMatchObject({ point: "blocks.0.ln1", mark: 8, from: 2 })
    await expect(cmd(s, "source").run({ point: "nope", run: "r1" }, { agent: agent(host) })).rejects.toThrow('"nope" is not a debug point of r1')
  })

  test("diff: two runs' code change and metrics side by side — after the code was changed and the model retrained", async () => {
    const host = recorded()
    const s = new Surgeon({ clock: now })
    const out = await cmd(s, "diff").run({ a: "r1", b: "r2" }, { agent: agent(host) })
    expect(out).toContain("DIFF r1 → r2 (in the surgeon pane)")
    expect(out).toContain("args --lr 0.003 → 0.006")
    expect(out).toContain("final loss 2.10 → 1.90 · val_loss 2.30 → 2")
    expect(out).toContain("-        att = q @ k\n+        att = (q @ k) / 8")
    expect(s.state.diff.files).toMatchObject([{ file: "experiments/tiny-gpt/model.py", added: 1, removed: 1 }])
    expect(s.state.diff.series.series.map((x) => x.name)).toEqual(["loss r1", "loss r2", "val_loss r1", "val_loss r2"])
    expect(s.render()).toContain("DIFF shown: r1 → r2 (1 files changed)")
  })

  test("the owner asks about what the pane shows: the question goes to the run's starter with where they were looking", async () => {
    const host = recorded()
    const s = new Surgeon({ clock: now })
    await cmd(s, "timeline").run({ run: "r2" }, { agent: agent(host) })
    const r = await s.ownerCall("ask", [{ id: "surgeon", text: "why does blocks.0.attn grow?" }])
    expect(r.ask).toMatchObject({ id: "q1", on: "timeline r2" })
    expect(r.deliver).toContain("The owner asks in the surgeon pane (looking at: timeline r2): why does blocks.0.attn grow?")
    expect(r.keeper).toBeNull()
    expect(s.render()).toContain("OWNER ASKED q1 (timeline r2): why does blocks.0.attn grow?")
    expect(() => s.ownerCall("ask", [{ id: "surgeon", text: " " }])).toThrow("text: the question")
  })

  test("the kit makes one per desk; its twin is the view surgeon", () => {
    const make = BUILTIN.artifacts.surgeon({ clock: now })
    const a = make({ name: "lab" })
    expect(make({ name: "engineer" })).toBe(a)
    expect(a.twin()).toMatchObject({ id: "surgeon", kind: "surgeon", view: "surgeon", keep: "always", state: { folder: "surgeon", session: null, views: [] } })
    expect(a.render()).toStartWith("SURGEON (surgeon/): no run — start a run: surgeon.start")
  })
})
