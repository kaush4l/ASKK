// The terminal artifact (backend/kernel/builtin/terminal.js, 2026-10-17) over a fake host: sessions through term/*,
// the holder's name and writes lane passed on, two sessions per holder (main: its runs, long: its start), ≤ 50 lines
// per running session in the prompt, the twin as the spec says.

import { describe, expect, test } from "bun:test"
import { Agent, Terminal } from "../index.js"
import { fakeHost } from "./fake-host.js"

const lines = (n, word = "step") => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)
function holder(name, terminal, config = {}, host, hold = {}) {
  const agent = new Agent({ name, report: false, ...config }, { infer: async () => "", context: { host } }).addArtifact(terminal, hold)
  const run = (cmd, input = {}) => agent.tools.get(`${terminal.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}

describe("terminal", () => {
  test("run: term/start in the holder's main session with its name, its writes lane and the wait; the result is the exit and the last lines", async () => {
    const host = fakeHost({ onStart: (body) => (body.command.startsWith("pytest") ? { status: "exited", exit: 1, lines: ["F.", "1 failed"] } : null) })
    const terminal = new Terminal()
    const coder = holder("coder", terminal, { writes: ["projects/**"] }, host)
    const out = await coder.run("run", { command: "pytest -q", cwd: "projects/x", timeout: 30 })
    expect(host.calls.at(-1)).toEqual({ method: "POST", path: "term/start", body: { command: "pytest -q", cwd: "projects/x", agent: "coder", writes: ["projects/**"], wait: 30, slot: "main" } })
    expect(out).toMatch(/^■ term-\d+ main "pytest" \(coder\) exited exit 1 in 1\.5 s · pytest -q · cwd projects\/x\n {2}F\.\n {2}1 failed$/)
    // No writes: lane → [] (the sandbox lets it write nothing), never the whole workspace.
    const critic = holder("critic", terminal, {}, host)
    await critic.run("run", { command: "bun --version" })
    expect(host.calls.at(-1).body).toMatchObject({ agent: "critic", writes: [], wait: 120, slot: "main" })
    expect(terminal.twin().state.sessions.map((s) => s.command)).toEqual(["bun --version", "pytest -q"]) // newest first
  })

  test("start keeps it running; wait, read, send, stop and list reach term/*; the session is the holder's newest running one by default", async () => {
    const host = fakeHost({ onStart: (body) => (body.command.startsWith("bun run dev") ? { lines: ["ready on http://localhost:8001"], urls: ["http://localhost:8001"] } : null) })
    const terminal = new Terminal()
    const coder = holder("coder", terminal, { writes: ["projects/**"] }, host)
    const started = await coder.run("start", { command: "bun run dev", name: "dev server" })
    expect(host.calls.at(-1).body).toMatchObject({ command: "bun run dev", name: "dev server", agent: "coder", wait: 3, slot: "long", replace: true })
    expect(started).toContain('long "dev server" (coder) running')
    expect(started).toContain("http://localhost:8001")
    const id = terminal.state.sessions[0].id
    expect(await coder.run("wait", { until: "ready" })).toContain("matched: ready on http://localhost:8001")
    expect(host.calls.at(-1)).toEqual({ method: "POST", path: "term/wait", body: { id, seconds: 30, until: "ready" } })
    // 2026-10-17: until is literal text, or a list where any one is enough; a regex-looking text is looked for as is.
    expect(await coder.run("wait", { until: ["", "Error", "ready on"] })).toContain("matched: ready on http://localhost:8001")
    expect(host.calls.at(-1).body).toEqual({ id, seconds: 30, until: ["Error", "ready on"] })
    expect(await coder.run("wait", { until: "ready|listening", seconds: 1 })).toContain('still running after 1 s (no line held "ready|listening")')
    expect(await coder.run("wait", { until: ["Error", "^ready"], seconds: 1 })).toContain('(no line held "Error" or "^ready")')
    expect(await coder.run("send", { id: "dev server", text: "r" })).toContain(`sent to ${id}`)
    expect(host.calls.at(-1)).toEqual({ method: "POST", path: "term/write", body: { id, text: "r" } })
    expect(await coder.run("read", { lines: 5 })).toContain("  > r")
    expect(host.calls.at(-1)).toEqual({ method: "GET", path: `term/read?id=${id}&lines=5` })
    expect(await coder.run("stop", {})).toContain(`■ ${id} long "dev server" (coder) stopped`)
    expect(terminal.state.sessions[0]).toMatchObject({ id, status: "stopped" })
    expect(await coder.run("list")).toContain("programs: bun python uv")
    await expect(coder.run("wait", {})).rejects.toThrow("id: which session — none is running (terminal.list lists them)")
  })

  test("the prompt: every running session's header and its last 50 lines; a finished one in one line", async () => {
    const host = fakeHost({
      onStart: (body) => (body.command === "uv run train.py" ? { lines: lines(120, "epoch") } : body.command === "uv run eval.py" ? { status: "exited", exit: 0, lines: lines(80, "eval") } : null),
    })
    const terminal = new Terminal()
    const coder = holder("coder", terminal, { writes: ["projects/**"] }, host)
    await coder.run("start", { command: "uv run train.py", name: "train" })
    await coder.run("run", { command: "uv run eval.py" })
    await holder("tester", terminal, { writes: ["projects/**"] }, host).run("start", { command: "sleep 100" })
    terminal.pulled = 0
    await terminal.refresh(coder.agent)
    const train = terminal.twin().state.sessions.find((s) => s.name === "train")
    expect(train.tail).toHaveLength(50)
    expect(train.tail.at(-1)).toBe("epoch 120")
    const block = coder.agent.render({ text: "x", from: "owner" }, []).split("# terminal — the desk's sessions\n")[1].split("\n\n# REQUEST")[0].split("\n")
    expect(block[0]).toBe("the desk's terminal: sessions keep running between your steps (a server, a training run): terminal.run, terminal.start, terminal.wait, terminal.read, terminal.send, terminal.stop, terminal.list")
    expect(block[1]).toBe('your two sessions: main — terminal.run runs your commands there, one at a time; long — terminal.start runs the one that keeps going there (a server, a training run, a watcher; the next start replaces it) — terminal.read {id: "main" | "long"} reads one')
    expect(block[2]).toBe("your commands write only: projects/** (and a private temp folder)")
    const at = block.indexOf("RUNNING")
    const trainHead = block.findIndex((l) => l.includes('"train"'))
    expect(block[trainHead]).toMatch(/^▶ term-\d+ long "train" \(coder\) running .* · uv run train\.py · cwd \.$/)
    const trainLines = block.slice(trainHead + 1).filter((l, i, all) => l.startsWith("  ") && all.slice(0, i).every((x) => x.startsWith("  ")))
    expect(trainLines).toHaveLength(50)
    expect(trainLines[0]).toBe("  epoch 71")
    expect(at).toBeGreaterThan(0)
    const finished = block.slice(block.indexOf("FINISHED") + 1)
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatch(/^■ term-\d+ main "uv" \(coder\) exited exit 0 in 1\.5 s · uv run eval\.py · cwd \.$/)
    expect(block.join("\n")).not.toContain("eval 80")
  })

  test("the twin: ≤ 12 sessions newest first, the spec's fields, tails ≤ 50; changed() only when it changed", async () => {
    let t = Date.parse("2026-10-17T14:00:00Z")
    const host = fakeHost({ clock: () => (t += 60_000) })
    const terminal = new Terminal()
    let coder
    for (let i = 0; i < 15; i++) await (coder = holder(`coder${i}`, terminal, { writes: ["projects/**"] }, host)).run("run", { command: `bun test ${i}` })
    let changes = 0
    terminal.onChange(() => changes++)
    terminal.pulled = 0
    await terminal.refresh(coder.agent)
    const s = terminal.twin().state
    expect(Object.keys(s)).toEqual(["sessions"])
    expect(s.sessions).toHaveLength(12)
    expect(s.sessions[0].command).toBe("bun test 14")
    expect(Object.keys(s.sessions[0])).toEqual(["id", "name", "command", "cwd", "agent", "slot", "lease", "runs", "status", "exit", "startedAt", "endedAt", "urls", "tail"])
    expect(s.sessions[0]).toMatchObject({ name: "bun", agent: "coder14", slot: "main", runs: 1, status: "exited", exit: 0, tail: ["ran bun test 14"], urls: [] })
    expect(changes).toBe(0) // the host's list is what the commands already showed
    host.sessions.at(-1).lines.push("one more line")
    terminal.pulled = 0
    await terminal.refresh(coder.agent)
    expect(changes).toBe(1)
    terminal.pulled = 0
    await terminal.refresh(coder.agent)
    expect(changes).toBe(1)
  })

  test("a commands subset (a critic reads, never starts); commands are type dev; a separate terminal lists only its own sessions", async () => {
    const host = fakeHost()
    const shared = new Terminal()
    const critic = holder("critic", shared, { reads: ["shared/**"] }, host, { commands: ["read", "list", "wait"] })
    expect([...critic.agent.tools.keys()]).toEqual(["terminal.wait", "terminal.read", "terminal.list"])
    expect(critic.agent.tools.get("terminal.read")).toMatchObject({ type: "dev", view: "terminal" })
    expect(critic.agent.render({ text: "x", from: "owner" }, [])).toContain("terminal.wait, terminal.read, terminal.list\n(no sessions yet)")
    const coder = holder("coder", shared, { writes: ["**"] }, host)
    await coder.run("run", { command: "bun --version" })
    const own = new Terminal({ id: "scratch", separate: true })
    const helper = holder("helper", own, { writes: ["**"] }, host)
    await helper.run("run", { command: "uv --version" })
    own.pulled = 0
    await own.refresh(helper.agent)
    expect(own.state.sessions.map((s) => [s.command, s.slot])).toEqual([["uv --version", "scratch.main"]])
    shared.pulled = 0
    await shared.refresh(coder.agent)
    expect(shared.state.sessions.map((s) => s.command).sort()).toEqual(["bun --version", "uv --version"])
  })

  // 2026-10-17 owner: a Live terminal tab per command buried the work — at most two sessions per agent.
  test("two sessions per holder: runs reuse its main session (taking turns), a start its long one, which runs on while runs go on and reads by id long", async () => {
    const host = fakeHost({ onStart: (body) => (body.command.startsWith("uv run train.py") ? { lines: ["epoch 1", "epoch 2"] } : null) })
    const post = host.post
    let inMain = 0
    let most = 0
    host.post = async (path, body, o) => {
      if (path !== "term/start" || body.slot !== "main") return post(path, body, o)
      most = Math.max(most, ++inMain)
      await Bun.sleep(5)
      try {
        return await post(path, body, o)
      } finally {
        inMain--
      }
    }
    const terminal = new Terminal()
    const coder = holder("coder", terminal, { writes: ["projects/**"] }, host)
    expect(await coder.run("start", { command: "uv run train.py", name: "train" })).toMatch(/^▶ term-\d+ long "train" \(coder\) running .*\nstarted in your long session/)
    // runs called in one step take turns in the main session; every one gets its own lines
    const outs = await Promise.all(["bun install", "bun test", "bun run build"].map((command) => coder.run("run", { command })))
    expect(most).toBe(1)
    expect(outs.map((o) => o.split("\n").slice(1))).toEqual([["  ran bun install"], ["  ran bun test"], ["  ran bun run build"]])
    for (const command of ["bun --version", "uv --version", "bun x tsc"]) await coder.run("run", { command, cwd: "projects/x" })
    const mine = () => terminal.twin().state.sessions.filter((s) => s.agent === "coder")
    expect(mine().map((s) => [s.slot, s.runs, s.status, s.command])).toEqual([
      ["main", 6, "exited", "bun x tsc"],
      ["long", 1, "running", "uv run train.py"],
    ])
    expect(host.sessions).toHaveLength(2)
    // the long one's logs while it runs; the main one's scrollback, each command under its $ line
    host.sessions.find((s) => s.slot === "long").lines.push("epoch 3")
    expect(await coder.run("read", { id: "long" })).toMatch(/^▶ term-\d+ long "train" \(coder\) running .*\n {2}\$ uv run train\.py\n {2}epoch 1\n {2}epoch 2\n {2}epoch 3$/)
    expect((await coder.run("read", { id: "main", lines: 4 })).split("\n").slice(1)).toEqual(["  projects/x $ uv --version", "  ran uv --version", "  projects/x $ bun x tsc", "  ran bun x tsc"])
    expect(mine()[0].tail).toEqual(["ran bun x tsc"]) // the twin keeps the command's own lines
    expect(await coder.run("wait", { id: "long", until: "epoch 3" })).toContain("matched: epoch 3")
    // a run that outlasts its timeout keeps the main session; the next run says what to do; stop frees it
    expect(await coder.run("run", { command: "sleep 100", timeout: 1 })).toContain('still running after 1 s — terminal.wait {id: "main", seconds} for more')
    await expect(coder.run("run", { command: "bun test" })).rejects.toThrow('your main session is still running "sleep 100" — terminal.wait {id: "main"} lets it finish, terminal.stop {id: "main"} ends it; a command that keeps running belongs in terminal.start (your long session)')
    expect(await coder.run("stop", { id: "main" })).toContain('main "sleep" (coder) stopped')
    expect(await coder.run("run", { command: "bun test" })).toContain("ran bun test")
    // the next start replaces the long run, in the same session
    const again = await coder.run("start", { command: "uv run train.py --resume" })
    expect(again).toContain("replaced: uv run train.py (stopped after 2.0 s)")
    expect(mine().map((s) => [s.slot, s.runs, s.status])).toEqual([
      ["long", 2, "running"],
      ["main", 8, "exited"],
    ])
    // another agent reads them by <agent>:<slot>; a slot it has none of says so
    const critic = holder("critic", terminal, {}, host, { commands: ["read", "list", "wait"] })
    expect(await critic.run("read", { id: "coder:long", lines: 3 })).toContain("  $ uv run train.py --resume\n  epoch 1\n  epoch 2")
    await expect(critic.run("read", { id: "long" })).rejects.toThrow("id: you have no long session yet (terminal.run opens the main one, terminal.start the long one; terminal.list lists them)")
    await expect(critic.run("read", { id: "tester:main" })).rejects.toThrow("id: tester has no main session yet")
  })

  // 2026-10-17: one GPU, one run at a time — a session holds a lease while it runs; the host refuses a second holder.
  test("lease: run and start pass it to term/start (validated); the twin carries it (null without); the prompt's header shows [gpu]; a held lease is the host's reason", async () => {
    const host = fakeHost({ onStart: (body) => (body.command.startsWith("uv run train.py") ? { lines: ["step 1"] } : null) })
    const terminal = new Terminal()
    const trainer = holder("trainer", terminal, { writes: ["projects/**"] }, host)
    expect(await trainer.run("start", { command: "uv run train.py", name: "train", lease: "gpu" })).toMatch(/^▶ term-\d+ long \[gpu\] "train" \(trainer\) running/)
    expect(host.calls.at(-1).body).toMatchObject({ command: "uv run train.py", lease: "gpu", slot: "long", replace: true })
    await trainer.run("run", { command: "bun --version" })
    expect(host.calls.at(-1).body).not.toHaveProperty("lease")
    expect(terminal.twin().state.sessions.map((s) => [s.command, s.lease])).toEqual([["bun --version", null], ["uv run train.py", "gpu"]])
    expect(trainer.agent.render({ text: "x", from: "owner" }, [])).toMatch(/\nRUNNING\n▶ term-\d+ long \[gpu\] "train" \(trainer\) running .* · uv run train\.py · cwd \.\n {2}step 1\n/)
    // a second GPU run: the host's reason (who holds it, what to wait on), never "your main session is still running"
    const evaluator = holder("evaluator", terminal, { writes: ["projects/**"] }, host)
    await expect(evaluator.run("run", { command: "uv run eval.py", lease: "gpu" })).rejects.toThrow(/^term\/start: HTTP 409: gpu is held by term-\d+ \(trainer: uv run train\.py\) since \S+ — terminal\.wait it, then start again$/)
    await expect(evaluator.run("start", { command: "uv run eval.py", lease: "gpu" })).rejects.toThrow("gpu is held by")
    expect(await evaluator.run("run", { command: "uv run lint.py", lease: "cpu-heavy" })).toContain("ran uv run lint.py")
    // checked before the host is asked
    const calls = host.calls.length
    for (const bad of ["GPU", "1gpu", "gpu lease", "a".repeat(21)]) await expect(evaluator.run("run", { command: "uv run eval.py", lease: bad })).rejects.toThrow(`lease "${bad}": a short name — lowercase letters, digits and -, up to 20 chars, starting with a letter (e.g. gpu)`)
    expect(host.calls.length).toBe(calls)
    // the holder's next start replaces its own leased run (the lease goes with it); once it ends the lease is free
    expect(await trainer.run("start", { command: "uv run train.py --resume", lease: "gpu" })).toContain("replaced: uv run train.py")
    await trainer.run("stop", { id: "long" })
    expect(await evaluator.run("run", { command: "uv run eval.py", lease: "gpu" })).toMatch(/^■ term-\d+ main \[gpu\] "uv" \(evaluator\) exited exit 0/)
  })

  test("a host refusal reads as the host's reason", async () => {
    const host = fakeHost()
    host.post = async (path) => {
      throw Object.assign(new Error(`POST ${path}: HTTP 403 {"error":"\\"rm\\" is not one of this desk's programs: bun, uv."}`), { status: 403 })
    }
    const coder = holder("coder", new Terminal(), { writes: ["**"] }, host)
    await expect(coder.run("run", { command: "rm -rf x" })).rejects.toThrow(`term/start: HTTP 403: "rm" is not one of this desk's programs: bun, uv.`)
  })
  // 2026-10-17: a host `error` on a wait (its `until` was a regex it dropped when slow; now literal text, but the
  // branch stays) and an aborted wait returning neither matched nor timedOut both read "ended" while the session ran on.
  test("wait: a dropped until or an early return never reads ended while the session runs", async () => {
    const host = fakeHost({ onStart: () => ({ lines: ["step 1"] }) }) // still running
    const post = host.post
    let answer = null
    host.post = async (path, body, o) => (path === "term/wait" && answer ? answer(await post(path, body, o)) : post(path, body, o))
    const terminal = new Terminal()
    const coder = holder("coder", terminal, { writes: ["projects/**"] }, host)
    await coder.run("start", { command: "uv run train.py", name: "train" })
    answer = (r) => ({ ...r, matched: false, timedOut: false, error: "until took too long on one line" })
    expect(await coder.run("wait", { until: "val_bpb:" })).toContain("until dropped: until took too long on one line")
    answer = (r) => ({ ...r, matched: false, timedOut: false })
    const early = await coder.run("wait", {})
    expect(early).toContain("still running (the wait returned early)")
    expect(early).not.toMatch(/\nended/)
  })
})
