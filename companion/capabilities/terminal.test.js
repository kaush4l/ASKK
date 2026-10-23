// Terminal sessions (terminal.js): real programs in a PTY under sandbox-exec, in a workspace under ~/.askk/tmp
// (outside TMPDIR, which programs may write), removed after. The "desk server" and another local service are
// Bun.serve on free ports.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { processInfo } from "./sandbox.js"
import { createTerm, LineView, termRoutes, untilTexts } from "./terminal.js"

const base = join(homedir(), ".askk", "tmp")
mkdirSync(base, { recursive: true })
const top = realpathSync(mkdtempSync(join(base, "term-test-")))
const root = join(top, "data") // the workspace
const state = join(top, "state")
const desks = join(top, "desks") // a mount root: alpha is mounted (marker), beta is not
const caches = join(top, "caches") // where desks' own package caches go (~/.askk/caches outside tests)
for (const dir of [root, state, join(desks, "alpha"), join(desks, "beta")]) mkdirSync(dir, { recursive: true })
writeFileSync(join(desks, "alpha", ".mounted"), "")
writeFileSync(join(desks, "alpha", "README.md"), "alpha desk\n")
writeFileSync(join(desks, "beta", "secret.txt"), "beta secret\n")
// A loaded project (projects.js): projects/app/ is a folder outside the workspace, beside the desk's own projects/.
const app = join(top, "elsewhere", "app")
mkdirSync(join(app, "src"), { recursive: true })
writeFileSync(join(app, "README.md"), "outside app\n")
const loaded = { folder: (name) => (name === "app" ? app : null), list: () => [{ name: "app" }] }
const mounts = { desks: { root: desks, allow: (name) => existsSync(join(desks, name, ".mounted")) }, projects: loaded }

// Programs: a progress bar with colours, a prompt that reads stdin, a long run.
writeFileSync(
  join(root, "progress.js"),
  `process.stdout.write("\\x1b[1;32mtraining\\x1b[0m model\\n")
for (let i = 0; i <= 10; i++) { process.stdout.write("\\r\\x1b[2Kstep " + i + "/10 \\x1b[33m" + i * 10 + "%\\x1b[0m"); await Bun.sleep(15) }
process.stdout.write("\\n\\x1b[36mdone\\x1b[0m loss=0.42\\n")
`
)
writeFileSync(join(root, "ask.js"), `process.stdout.write("name? ")\nfor await (const line of console) { console.log("got:" + line.toUpperCase()); break }\n`)
writeFileSync(join(root, "serve.js"), `console.log("listening on http://0.0.0.0:4321/ ready")\nawait Bun.sleep(60000)\n`)
// Long lines on cue: "ready? ", then after one line of input three of n "a" and one ending with `end` (n in all).
writeFileSync(join(root, "line.js"), `const [n, end = ""] = process.argv.slice(2)\nprocess.stdout.write("ready? ")\nfor await (const _ of console) break\nfor (let i = 0; i < 3; i++) console.log("a".repeat(Number(n)))\nconsole.log("a".repeat(Number(n) - end.length) + end)\nawait Bun.sleep(20000)\n`)
// A burst on cue: n lines of 500 spaces in one write.
writeFileSync(join(root, "burst.js"), `process.stdout.write("ready? ")\nfor await (const _ of console) break\nprocess.stdout.write((" ".repeat(500) + "\\n").repeat(Number(process.argv[2])))\nawait Bun.sleep(20000)\n`)
// A marker line on cue, named by a key so the command never holds the text waited for.
writeFileSync(
  join(root, "say.js"),
  `const lines = { ready: "ready on http://127.0.0.1:3000", listening: "listening on :3000", bpb: "val_bpb: 1.41" }
process.stdout.write("cue? ")
for await (const _ of console) break
console.log("starting")
console.log(lines[process.argv[2]])
await Bun.sleep(20000)
`
)

let desk // the desk server: never reached from a session
let other // another local service: reachable
let term
const policy = { toolchains: ["javascript", "python", "rust"], programs: ["sleep", "touch", "cat", "curl", "ls", "printenv"] }
beforeAll(() => {
  desk = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("desk") })
  other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("other") })
  term = createTerm({ root, state, policy, mounts, hostPorts: () => [desk.port], caches })
})
afterAll(async () => {
  await term?.close()
  desk?.stop(true)
  other?.stop(true)
  rmSync(top, { recursive: true, force: true })
})

const finished = async (session) => (await term.wait({ id: session.id, seconds: 30 })).session

describe("LineView", () => {
  test("\\r rewrites the line, escapes dropped, erase-in-line, backspace, tabs", () => {
    const v = new LineView()
    v.write("\x1b[31mred\x1b[0m\r\n10%\r20%\r\x1b[2K30%\r\nabcdef\rxy\r\nab\bc\r\n\tx\r\n")
    expect(v.tail(10)).toEqual(["red", "30%", "xycdef", "ac", "        x"])
  })
  test("an escape sequence split across chunks; OSC titles; long lines cut", () => {
    const v = new LineView({ lineChars: 10 })
    v.write("\x1b[3")
    v.write("2mgreen\x1b]0;title\x07!")
    expect(v.tail(1)).toEqual(["green!"])
    v.write("\n0123456789abc")
    expect(v.tail(3)).toEqual(["green!", "0123456789", "abc"])
    expect(v.since(1)).toEqual(["0123456789"])
  })
})

describe("sessions", () => {
  test("H2: a PTY program's \\r progress and colours read as clean final lines (term/read)", async () => {
    const { session } = await term.start({ command: "bun progress.js", agent: "coder", wait: 30 })
    expect(session).toMatchObject({ status: "exited", exit: 0, agent: "coder", cwd: ".", name: "bun" })
    const { lines } = term.read({ id: session.id })
    expect(lines).toEqual(["training model", "step 10/10 100%", "done loss=0.42"])
    expect(lines.join("")).not.toContain("\x1b")
    // its whole raw output in state/terminal/<id>.log, one row in state/terminal.jsonl
    expect(readFileSync(join(state, "terminal", `${session.id}.log`), "utf8")).toContain("\x1b[1;32mtraining")
    const rows = readFileSync(join(state, "terminal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(rows.at(-1)).toMatchObject({ id: session.id, agent: "coder", cwd: ".", command: "bun progress.js", status: "exited", exit: 0, tail: "training model\nstep 10/10 100%\ndone loss=0.42" })
  })

  test("H3: term/write reaches the program's stdin; term/wait until a line holds a text", async () => {
    const { session } = await term.start({ command: "bun ask.js" })
    const prompt = await term.wait({ id: session.id, seconds: 10, until: "name?" })
    expect(prompt).toMatchObject({ matched: true, timedOut: false, line: "name? " })
    expect(term.write({ id: session.id, text: "ada" }).session.status).toBe("running")
    const got = await term.wait({ id: session.id, seconds: 10, until: "got:" })
    expect(got).toMatchObject({ matched: true, line: "got:ADA" })
    expect((await finished(session)).status).toBe("exited")
    expect(() => term.write({ id: session.id, text: "late" })).toThrow(/exited/)
  })

  test("H4: a session survives two term/read calls 2 s apart, listed running; term/stop ends it", async () => {
    const { session } = await term.start({ command: "sleep 60", name: "long" })
    const first = term.read({ id: session.id })
    await Bun.sleep(2000)
    const second = term.read({ id: session.id })
    expect(first.session.status).toBe("running")
    expect(second.session.status).toBe("running")
    expect(second.session.pid).toBe(session.pid)
    expect(() => process.kill(session.pid, 0)).not.toThrow()
    expect(term.list().sessions.find((s) => s.id === session.id)).toMatchObject({ status: "running", name: "long" })
    const stopped = (await term.stop({ id: session.id })).session
    expect(stopped).toMatchObject({ status: "stopped", exit: null, signal: "SIGTERM", reason: "stopped" })
    expect(() => process.kill(session.pid, 0)).toThrow()
  }, 15000)

  test("&& chains run in order in fresh PTYs, cd moves inside the workspace, the first failure stops it", async () => {
    mkdirSync(join(root, "sub"), { recursive: true })
    mkdirSync(join(root, "out"), { recursive: true })
    writeFileSync(join(root, "sub", "here.txt"), "inside sub\n")
    const ok = await finished((await term.start({ command: "cd sub && cat here.txt && ls" })).session)
    expect(ok).toMatchObject({ status: "exited", exit: 0, cwd: "sub" })
    expect(ok.tail).toEqual(["$ cat here.txt", "inside sub", "$ ls", "here.txt"])
    const absolute = await finished((await term.start({ command: `cd ${join(root, "sub")} && ls`, cwd: "out" })).session) // an absolute folder is not joined to cwd
    expect(absolute).toMatchObject({ exit: 0, cwd: "sub" })
    const failed = await finished((await term.start({ command: "cat nope.txt && ls" })).session)
    expect(failed.exit).not.toBe(0)
    expect(failed.tail.join("\n")).not.toContain("$ ls")
  })

  test("URLs a program prints are collected (0.0.0.0 → 127.0.0.1); wait without until returns at the timeout", async () => {
    const { session } = await term.start({ command: "bun serve.js" })
    const waited = await term.wait({ id: session.id, seconds: 1 })
    expect(waited.timedOut).toBe(true)
    expect(waited.session.urls).toEqual(["http://127.0.0.1:4321/"])
    await term.stop({ id: session.id })
  })

  // 2026-10-17: `until` is literal text (includes), no longer a regex: as one, (a+)+b on the three lines of 4000 "a"
  // before it held the process for ages, and accepted patterns still stalled it 1–10 s (backreferences, lookarounds).
  test("until: literal text — a regex-looking text is looked for as is, never refused; a list matches any one; a 4000-character line returns fast", async () => {
    const { session } = await term.start({ command: "bun line.js 4000 '(a+)+b'" })
    expect(await term.wait({ id: session.id, seconds: 10, until: ["never printed", "ready?"] })).toMatchObject({ matched: true, line: "ready? " })
    // timed from the cue, so the program's start does not count
    const began = performance.now()
    term.write({ id: session.id, text: "go" })
    // as regexes ^a and a{3} would match the first line of "a"; as text only the last line holds one of them
    const waited = await term.wait({ id: session.id, seconds: 15, until: ["^a", "a{3}", "(a+)+b"] })
    const ms = performance.now() - began
    expect(waited).toMatchObject({ matched: true, timedOut: false })
    expect(waited.line).toBe(`${"a".repeat(3994)}(a+)+b`) // the whole line comes back (lineChars is 4000: not cut)
    expect(ms).toBeLessThan(1000)
    await term.stop({ id: session.id })
  }, 20000)

  // 2026-10-17: (a+)+$ is the classic catastrophic regex over a run of "a"; as text it costs one includes per line.
  test('until "(a+)+$": lines of 4000 "a" without it time out with the event loop free; the line ending in it matches within 200 ms', async () => {
    const cued = async (command) => {
      const { session } = await term.start({ command })
      expect(await term.wait({ id: session.id, seconds: 10, until: "ready?" })).toMatchObject({ matched: true })
      return session
    }
    const plain = await cued("bun line.js 4000") // four lines of 4000 "a", none holding the text
    let last = performance.now()
    let gap = 0
    const tick = setInterval(() => {
      const now = performance.now()
      gap = Math.max(gap, now - last)
      last = now
    }, 10)
    term.write({ id: plain.id, text: "go" })
    const none = await term.wait({ id: plain.id, seconds: 1, until: "(a+)+$" })
    clearInterval(tick)
    expect(none).toMatchObject({ matched: false, timedOut: true })
    expect(term.read({ id: plain.id, lines: 10 }).lines.filter((l) => l === "a".repeat(4000)).length).toBe(4) // they arrived
    expect(gap).toBeLessThan(200)
    await term.stop({ id: plain.id })

    const session = await cued("bun line.js 4000 '(a+)+$'") // three lines of 4000 "a", then one ending in (a+)+$
    const began = performance.now()
    term.write({ id: session.id, text: "go" })
    const waited = await term.wait({ id: session.id, seconds: 10, until: "(a+)+$" })
    const ms = performance.now() - began
    expect(waited).toMatchObject({ matched: true, timedOut: false, line: `${"a".repeat(3994)}(a+)+$` })
    expect(ms).toBeLessThan(200)
    await term.stop({ id: session.id })
  }, 20000)

  test('until: one text ("val_bpb:") matches its line; in a list ["ready on", "listening"] the first and the second each match alone', async () => {
    const said = async (key, until) => {
      const { session } = await term.start({ command: `bun say.js ${key}` })
      expect(await term.wait({ id: session.id, seconds: 10, until: "cue?" })).toMatchObject({ matched: true })
      term.write({ id: session.id, text: "go" })
      const waited = await term.wait({ id: session.id, seconds: 10, until })
      await term.stop({ id: session.id })
      return waited
    }
    expect(await said("bpb", "val_bpb:")).toMatchObject({ matched: true, timedOut: false, line: "val_bpb: 1.41" })
    expect(await said("ready", ["ready on", "listening"])).toMatchObject({ matched: true, timedOut: false, line: "ready on http://127.0.0.1:3000" })
    expect(await said("listening", ["ready on", "listening"])).toMatchObject({ matched: true, timedOut: false, line: "listening on :3000" })
  }, 20000)

  test("until: 400 only for a non-string, a text over 300 characters or more than 8 texts; empty texts are left out", async () => {
    expect(untilTexts("val_bpb:")).toEqual(["val_bpb:"])
    expect(untilTexts(["", "ready on", "x".repeat(300)])).toEqual(["ready on", "x".repeat(300)])
    for (const none of [undefined, null, "", [], ["", ""]]) expect(untilTexts(none)).toBeNull()
    const { session } = await term.start({ command: "bun ask.js" })
    for (const until of ["x".repeat(301), ["ok", "x".repeat(301)], Array(9).fill("ok"), 42, ["ok", 7], { text: "ok" }]) {
      const refused = await term.wait({ id: session.id, seconds: 1, until }).catch((error) => error)
      expect(refused.status).toBe(400)
      expect(refused.message).toMatch(/^until: literal text of at most 300 characters .* or a list of at most 8 of them/)
    }
    expect(await term.wait({ id: session.id, seconds: 10, until: Array(8).fill("name?") })).toMatchObject({ matched: true, line: "name? " })
    await term.stop({ id: session.id })
  })

  // 2026-10-17: includes is linear: a burst of 2000 lines of 500 spaces against 8 texts of 300 characters that almost
  // match (the worst case for a string search, measured ~30 ms over all of them) never holds the event loop.
  test("until: a burst of lines against 8 long texts that almost match: the event loop is never held, the wait times out", async () => {
    const { session } = await term.start({ command: "bun burst.js 2000" })
    expect(await term.wait({ id: session.id, seconds: 10, until: "ready?" })).toMatchObject({ matched: true })
    let last = performance.now()
    let gap = 0
    const tick = setInterval(() => {
      const now = performance.now()
      gap = Math.max(gap, now - last)
      last = now
    }, 10)
    term.write({ id: session.id, text: "go" })
    const texts = Array.from({ length: 8 }, (_, i) => `${" ".repeat(150 + i)}Z${" ".repeat(149 - i)}`)
    const waited = await term.wait({ id: session.id, seconds: 2, until: texts })
    clearInterval(tick)
    expect(waited).toMatchObject({ matched: false, timedOut: true })
    expect(waited.error).toBeUndefined()
    expect(term.read({ id: session.id, lines: 1000 }).lines.filter((l) => l === " ".repeat(500)).length).toBeGreaterThan(500) // the burst arrived
    expect(gap).toBeLessThan(200)
    await term.stop({ id: session.id })
  }, 20000)

  test("refused: shell syntax, other programs, destructive git, cwd outside, a 7th running session", async () => {
    await expect(term.start({ command: "cat a | grep b" })).rejects.toMatchObject({ status: 400 })
    await expect(term.start({ command: "python9 x" })).rejects.toMatchObject({ status: 403 })
    await expect(term.start({ command: "git clean -fd" })).rejects.toMatchObject({ status: 403 })
    await expect(term.start({ command: "ls", cwd: "../.." })).rejects.toMatchObject({ status: 403 })
    await expect(term.start({ command: "ls", cwd: "/etc" })).rejects.toMatchObject({ status: 403 })
    const six = []
    for (let i = 0; i < 6; i++) six.push((await term.start({ command: "sleep 30" })).session)
    await expect(term.start({ command: "sleep 30" })).rejects.toMatchObject({ status: 429 })
    await Promise.all(six.map((s) => term.stop({ id: s.id })))
  }, 20000)

  test("term/stream: snapshot with the lines so far, then raw out chunks and the exit", async () => {
    const { session } = await term.start({ command: "bun ask.js" })
    await term.wait({ id: session.id, seconds: 10, until: "name" })
    const abort = new AbortController()
    const reader = term.stream({ signal: abort.signal }, session.id).body.getReader()
    const events = []
    const pump = (async () => {
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += new TextDecoder().decode(value)
        for (const block of buffer.split("\n\n").slice(0, -1)) if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)))
        buffer = buffer.split("\n\n").at(-1)
        if (events.some((e) => e.type === "exit")) return
      }
    })()
    await Bun.sleep(100)
    term.write({ id: session.id, text: "zed" })
    await pump
    abort.abort()
    expect(events[0]).toMatchObject({ type: "snapshot", session: { id: session.id, status: "running" }, lines: ["name? "] })
    expect(events.filter((e) => e.type === "out").map((e) => e.data).join("")).toContain("got:ZED")
    expect(events.at(-1)).toMatchObject({ type: "exit", id: session.id, exit: 0, status: "exited" })
  })

  test("routes: GET term/list and term/read, POST term/start / write / wait / stop", async () => {
    const r = termRoutes(term)
    expect(Object.keys(r.GET)).toEqual(["term/list", "term/read"])
    expect(Object.keys(r.POST)).toEqual(["term/start", "term/write", "term/wait", "term/stop"])
    const { session } = await r.POST["term/start"]({ command: "sleep 30" })
    const listed = r.GET["term/list"](new URLSearchParams("tail=5"))
    expect(listed.sessions[0].id).toBe(session.id) // newest first
    expect(listed.policy.programs).toContain("sleep")
    expect(r.GET["term/read"](new URLSearchParams(`id=${session.id}&lines=3`)).session.id).toBe(session.id)
    await r.POST["term/stop"]({ id: session.id })
  })

  // 2026-10-17 owner: at most two sessions per agent — commands in its main one, a long run in the other.
  test("slots: the agent's main session takes command after command (same id, `$` headers in the scrollback, tail the command's own); its long one runs on meanwhile; a running slot refuses unless replace", async () => {
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileSync(join(root, "sub", "here.txt"), "inside sub\n")
    const a = (await term.start({ command: "bun progress.js", agent: "coder", slot: "main", wait: 30 })).session
    expect(a).toMatchObject({ slot: "main", runs: 1, status: "exited", exit: 0, name: "bun" })
    expect(a.tail).toEqual(["training model", "step 10/10 100%", "done loss=0.42"])
    const b = (await term.start({ command: "cat here.txt", cwd: "sub", agent: "coder", slot: "main", wait: 30 })).session
    expect(b).toMatchObject({ id: a.id, slot: "main", runs: 2, status: "exited", exit: 0, command: "cat here.txt", cwd: "sub", name: "cat" })
    expect(b.tail).toEqual(["inside sub"])
    expect(term.read({ id: a.id }).lines).toEqual(["$ bun progress.js", "training model", "step 10/10 100%", "done loss=0.42", "sub $ cat here.txt", "inside sub"])
    // another agent's main and the coder's long are sessions of their own
    const critic = (await term.start({ command: "cat here.txt", cwd: "sub", agent: "critic", slot: "main", wait: 30 })).session
    expect(critic.id).not.toBe(a.id)
    const long = (await term.start({ command: "bun serve.js", agent: "coder", slot: "long", wait: 1 })).session
    expect(long).toMatchObject({ slot: "long", runs: 1, status: "running", urls: ["http://127.0.0.1:4321/"] })
    expect(long.id).not.toBe(a.id)
    await expect(term.start({ command: "sleep 30", agent: "coder", slot: "long" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("coder's long session) is still running bun serve.js") })
    // the main session goes on while the long one runs, and the stream of the main session hears its next command
    const abort = new AbortController()
    const reader = term.stream({ signal: abort.signal }, a.id).body.getReader()
    const events = []
    const pump = (async () => {
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += new TextDecoder().decode(value)
        for (const block of buffer.split("\n\n").slice(0, -1)) if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)))
        buffer = buffer.split("\n\n").at(-1)
        if (events.some((e) => e.type === "exit")) return
      }
    })()
    await Bun.sleep(50)
    const c = (await term.start({ command: "cat here.txt", cwd: "sub", agent: "coder", slot: "main", wait: 30 })).session
    await pump
    abort.abort()
    expect(c).toMatchObject({ id: a.id, runs: 3, exit: 0, tail: ["inside sub"] })
    expect(events.map((e) => e.type).filter((t) => t !== "out")).toEqual(["snapshot", "run", "exit"])
    expect(events[0]).toMatchObject({ session: { id: a.id, status: "exited", runs: 2 } })
    expect(events[1]).toMatchObject({ session: { id: a.id, status: "running", runs: 3, command: "cat here.txt" } })
    expect(events.filter((e) => e.type === "out").map((e) => e.data).join("")).toContain("sub $ cat here.txt\r\ninside sub")
    expect(term.list().sessions.find((s) => s.id === long.id).status).toBe("running")
    expect(term.list().sessions[0].id).toBe(a.id) // the slot's last command: newest
    // replace: the long run is stopped and the next one runs in the same session, its urls the new command's
    const replacing = await term.start({ command: "sleep 30", agent: "coder", slot: "long", replace: true })
    const d = replacing.session
    expect(d).toMatchObject({ id: long.id, runs: 2, status: "running", command: "sleep 30", urls: [] })
    expect(replacing.replaced).toMatchObject({ command: "bun serve.js", status: "stopped" })
    expect(c.replaced).toBeUndefined()
    const rows = readFileSync(join(state, "terminal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(rows.filter((r) => r.id === long.id)).toEqual([expect.objectContaining({ slot: "long", run: 1, command: "bun serve.js", status: "stopped" })])
    expect(rows.filter((r) => r.id === a.id).map((r) => [r.run, r.command, r.tail])).toEqual([
      [1, "bun progress.js", "training model\nstep 10/10 100%\ndone loss=0.42"],
      [2, "cat here.txt", "inside sub"],
      [3, "cat here.txt", "inside sub"],
    ])
    const log = readFileSync(join(state, "terminal", `${a.id}.log`), "utf8") // one log per session, every command appended
    expect(log).toContain("\x1b[1;32mtraining")
    expect(log.split("sub $ cat here.txt").length).toBe(3)
    await term.stop({ id: d.id })
    await expect(term.start({ command: "ls", agent: "coder", slot: "main lane" })).rejects.toMatchObject({ status: 400 })
  }, 20000)

  // 2026-10-17: one GPU, one run at a time — a running session holds its lease; a second start with it is refused
  // with who holds it, until the holder ends.
  test("leases: a second start with the lease while the first runs → 409 naming its session, agent, command and since; after it ends it starts; another lease or none is not held back; a slot session checks again", async () => {
    const trainer = (await term.start({ command: "sleep 30", agent: "trainer", slot: "long", lease: "gpu" })).session
    expect(trainer).toMatchObject({ lease: "gpu", slot: "long", status: "running" })
    const refused = await term.start({ command: "sleep 1", agent: "evaluator", lease: "gpu" }).catch((error) => error)
    expect(refused.status).toBe(409)
    expect(refused.message).toBe(`gpu is held by ${trainer.id} (trainer: sleep 30) since ${trainer.startedAt} — terminal.wait it, then start again`)
    // the owner's own session (no agent) holds it the same way
    const owner = (await term.start({ command: "sleep 30", lease: "disk" })).session
    await expect(term.start({ command: "sleep 1", agent: "evaluator", lease: "disk" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining(`disk is held by ${owner.id} (the owner: sleep 30)`) })
    await term.stop({ id: owner.id })
    // another lease, or none: not held back
    const other = (await term.start({ command: "ls", agent: "evaluator", lease: "cpu-heavy", wait: 30 })).session
    expect(other).toMatchObject({ lease: "cpu-heavy", status: "exited", exit: 0 })
    const none = (await term.start({ command: "ls", agent: "evaluator", wait: 30 })).session
    expect(none).toMatchObject({ lease: null, exit: 0 })
    // a slot session's next command checks again: the evaluator's main session takes a command, then one with the lease
    const main = (await term.start({ command: "ls", agent: "evaluator", slot: "main", wait: 30 })).session
    expect(main.lease).toBeNull()
    await expect(term.start({ command: "sleep 1", agent: "evaluator", slot: "main", lease: "gpu" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining(`gpu is held by ${trainer.id}`) })
    expect(term.list().sessions.find((s) => s.id === main.id)).toMatchObject({ status: "exited", runs: 1, command: "ls" }) // untouched
    // term/list carries it; the holder's own replace takes the lease with it (its run is stopped first)
    expect(term.list().sessions.find((s) => s.id === trainer.id)).toMatchObject({ lease: "gpu", status: "running" })
    const resumed = await term.start({ command: "sleep 30", agent: "trainer", slot: "long", lease: "gpu", replace: true })
    expect(resumed.session).toMatchObject({ id: trainer.id, runs: 2, lease: "gpu", status: "running" })
    expect(resumed.replaced).toMatchObject({ command: "sleep 30", status: "stopped" })
    // a replace that would be refused stops nothing: the holder is another session
    const side = (await term.start({ command: "sleep 30", agent: "evaluator", slot: "long" })).session
    await expect(term.start({ command: "sleep 1", agent: "evaluator", slot: "long", lease: "gpu", replace: true })).rejects.toMatchObject({ status: 409 })
    expect(term.list().sessions.find((s) => s.id === side.id).status).toBe("running")
    await term.stop({ id: side.id })
    // the holder ends: the lease is free, and the slot session starts with it (its next command, the lease its own)
    const ended = (await term.stop({ id: trainer.id })).session
    expect(ended).toMatchObject({ status: "stopped", lease: "gpu" })
    const next = (await term.start({ command: "ls", agent: "evaluator", slot: "main", lease: "gpu", wait: 30 })).session
    expect(next).toMatchObject({ id: main.id, runs: 2, lease: "gpu", status: "exited", exit: 0 })
    const after = (await term.start({ command: "ls", agent: "evaluator", slot: "main", wait: 30 })).session
    expect(after).toMatchObject({ id: main.id, runs: 3, lease: null }) // a command without one holds none
    const rows = readFileSync(join(state, "terminal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(rows.filter((r) => r.id === main.id).map((r) => r.lease ?? null)).toEqual([null, "gpu", null])
    // a lease is a short name
    for (const bad of ["GPU", "1gpu", "gpu lease", "a".repeat(21), 7]) await expect(term.start({ command: "ls", lease: bad })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("lease: a short name") })
  }, 20000)
})

describe("H5: the sandbox", () => {
  test("a session writes only its lanes: outside them (and outside the workspace) nothing lands", async () => {
    mkdirSync(join(root, "out"), { recursive: true })
    const lane = ["out/**"]
    const inside = await finished((await term.start({ command: "touch out/made.txt", writes: lane })).session)
    expect(inside.exit).toBe(0)
    expect(existsSync(join(root, "out", "made.txt"))).toBe(true)
    const outside = await finished((await term.start({ command: "touch elsewhere.txt", writes: lane })).session)
    expect(outside.exit).not.toBe(0)
    expect(outside.tail.join("\n")).toMatch(/not permitted/i)
    expect(existsSync(join(root, "elsewhere.txt"))).toBe(false)
    const none = await finished((await term.start({ command: "touch out/none.txt", writes: [] })).session)
    expect(none.exit).not.toBe(0)
    const away = await finished((await term.start({ command: `touch ${join(top, "away.txt")}` })).session) // no lane: the workspace only
    expect(away.exit).not.toBe(0)
    expect(existsSync(join(top, "away.txt"))).toBe(false)
  })

  test("package caches are the desk's own (~/.askk/caches/<desk>): the env points there, the user's caches are never written", async () => {
    const { policy: p } = term.list()
    const own = join(caches, basename(top)) // <desk>/state → <desk>
    expect(p.cache).toBe(own)
    const env = await finished((await term.start({ command: "printenv BUN_INSTALL_CACHE_DIR npm_config_cache" })).session)
    expect(env).toMatchObject({ exit: 0, tail: [join(own, "bun"), join(own, "npm")] })
    if (p.toolchains.some((c) => c.id === "python")) {
      const uv = await finished((await term.start({ command: "printenv UV_CACHE_DIR UV_PYTHON_INSTALL_DIR" })).session)
      expect(uv).toMatchObject({ exit: 0, tail: [join(own, "uv"), join(own, "uv-python")] })
    }
    if (p.toolchains.some((c) => c.id === "rust")) {
      const cargo = await finished((await term.start({ command: "printenv CARGO_HOME" })).session)
      expect(cargo).toMatchObject({ exit: 0, tail: [join(own, "cargo")] })
    }
    const mine = await finished((await term.start({ command: `touch ${join(own, "bun", "probe")}` })).session)
    expect(mine.exit).toBe(0)
    const global = [".bun/install/cache", ".npm/_cacache", ".cache/uv", ".cargo/registry"].map((d) => join(homedir(), d)).filter((d) => existsSync(d))
    expect(global.length).toBeGreaterThan(0)
    for (const dir of global) {
      const probe = join(dir, `askk-sandbox-probe-${process.pid}`)
      try {
        const wrote = await finished((await term.start({ command: `touch ${probe}` })).session)
        expect(wrote.exit).not.toBe(0)
        expect(existsSync(probe)).toBe(false)
      } finally {
        rmSync(probe, { force: true })
      }
    }
  })

  test("a session cannot read .env (it can read .env.example)", async () => {
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-secret\n")
    writeFileSync(join(root, ".env.example"), "OPENAI_API_KEY=\n")
    const secret = await finished((await term.start({ command: "cat .env" })).session)
    expect(secret.exit).not.toBe(0)
    expect(secret.tail.join("\n")).not.toContain("sk-secret")
    const example = await finished((await term.start({ command: "cat .env.example" })).session)
    expect(example).toMatchObject({ exit: 0, tail: ["OPENAI_API_KEY="] })
  })

  test("a session cannot connect to the desk server's port; another local port answers", async () => {
    expect(await (await fetch(`http://127.0.0.1:${desk.port}/`)).text()).toBe("desk") // up, outside the sandbox
    const blocked = await finished((await term.start({ command: `curl -s -m 5 http://127.0.0.1:${desk.port}/` })).session)
    expect(blocked.exit).not.toBe(0)
    expect(blocked.tail.join("\n")).not.toContain("desk")
    const forged = await finished((await term.start({ command: `curl -s -m 5 -X POST -H "Host: localhost:${desk.port}" http://localhost:${desk.port}/__askk/fs/write` })).session)
    expect(forged.exit).not.toBe(0)
    const open = await finished((await term.start({ command: `curl -s -m 5 http://127.0.0.1:${other.port}/` })).session)
    expect(open).toMatchObject({ exit: 0, tail: ["other"] })
  })

  test("mounts: desks/<name> only when allowed; a lane on desks/alpha writes there; other desks unreadable", async () => {
    const readme = await finished((await term.start({ command: "cat README.md", cwd: "desks/alpha" })).session)
    expect(readme).toMatchObject({ exit: 0, cwd: "desks/alpha", tail: ["alpha desk"] })
    await expect(term.start({ command: "ls", cwd: "desks/beta" })).rejects.toMatchObject({ status: 403 })
    await expect(term.start({ command: "ls", cwd: "desks" })).rejects.toMatchObject({ status: 400 })
    const wrote = await finished((await term.start({ command: "cd desks/alpha && touch tools.js", writes: ["desks/alpha/**"] })).session)
    expect(wrote.exit).toBe(0)
    expect(existsSync(join(desks, "alpha", "tools.js"))).toBe(true)
    const notLaned = await finished((await term.start({ command: "touch other.js", cwd: "desks/alpha", writes: ["out/**"] })).session)
    expect(notLaned.exit).not.toBe(0)
    expect(existsSync(join(desks, "alpha", "other.js"))).toBe(false)
    const peek = await finished((await term.start({ command: `cat ${join(desks, "beta", "secret.txt")}` })).session)
    expect(peek.exit).not.toBe(0)
    expect(peek.tail.join("\n")).not.toContain("beta secret")
  })

  test("a loaded project: projects/app is its folder; a projects/** lane writes there, another lane does not", async () => {
    const readme = await finished((await term.start({ command: "cat README.md", cwd: "projects/app" })).session)
    expect(readme).toMatchObject({ exit: 0, cwd: "projects/app", tail: ["outside app"] })
    const wrote = await finished((await term.start({ command: "cd projects/app/src && touch made.js", writes: ["projects/**"] })).session)
    expect(wrote).toMatchObject({ exit: 0, cwd: "projects/app/src" })
    expect(existsSync(join(app, "src", "made.js"))).toBe(true)
    const named = await finished((await term.start({ command: "touch named.js", cwd: "projects/app", writes: ["projects/app/**"] })).session)
    expect(named.exit).toBe(0)
    const notLaned = await finished((await term.start({ command: "touch other.js", cwd: "projects/app", writes: ["projects/tiny/**"] })).session)
    expect(notLaned.exit).not.toBe(0)
    expect(existsSync(join(app, "other.js"))).toBe(false)
    await expect(term.start({ command: "ls", cwd: "projects/nope" })).rejects.toMatchObject({ status: 400 })
  })
})

describe("orphans", () => {
  test("a running program is booked in state/terminal.running.json until it ends", async () => {
    const book = () => (existsSync(join(state, "terminal.running.json")) ? JSON.parse(readFileSync(join(state, "terminal.running.json"), "utf8")) : [])
    const { session } = await term.start({ command: "sleep 30", agent: "coder" })
    const entry = book().find((r) => r.pid === session.pid)
    expect(entry).toMatchObject({ pgid: session.pid, session: session.id, agent: "coder", server: { pid: process.pid } })
    expect(entry.command).toEndWith("sleep 30")
    expect(entry.started).toBe(processInfo([session.pid]).get(session.pid).started)
    await term.stop({ id: session.id })
    expect(book().some((r) => r.pid === session.pid)).toBe(false)
  })

  test("createTerm SIGKILLs the groups a crashed server left running; a reused pid, a live server's group and a gone one are spared", async () => {
    const at = join(top, "crashed-desk", "state")
    mkdirSync(at, { recursive: true })
    const sleeper = () => Bun.spawn(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/bin/sleep", "60"], { detached: true, stdio: ["ignore", "ignore", "ignore"] })
    const orphan = sleeper() // left by a server that is gone
    const reused = sleeper() // its pid booked with another start time: a program that took a booked pid later
    const kept = sleeper() // booked by a server still running (this one)
    const ended = Bun.spawn(["/usr/bin/true"])
    await ended.exited
    await Bun.sleep(50)
    const info = processInfo([orphan.pid, reused.pid, kept.pid, process.pid])
    const crashed = { pid: ended.pid, started: "Thu Jan  1 00:00:00 2026" }
    const row = (p, extra = {}) => ({ pid: p.pid, pgid: info.get(p.pid).pgid, started: info.get(p.pid).started, command: "/bin/sleep 60", session: `term-${p.pid}`, server: crashed, ...extra })
    writeFileSync(
      join(at, "terminal.running.json"),
      JSON.stringify([row(orphan), row(reused, { started: "Thu Jan  1 00:00:00 2026" }), row(kept, { server: { pid: process.pid, started: info.get(process.pid).started } }), { pid: ended.pid, pgid: ended.pid, started: "Thu Jan  1 00:00:00 2026", server: crashed }])
    )
    const lines = []
    try {
      const t = createTerm({ root, state: at, policy, caches, log: (line) => lines.push(line) })
      await Promise.race([orphan.exited, Bun.sleep(3000)])
      expect(orphan.signalCode).toBe("SIGKILL")
      expect(() => process.kill(reused.pid, 0)).not.toThrow()
      expect(() => process.kill(kept.pid, 0)).not.toThrow()
      expect(lines.join("\n")).toContain(`stopped 1 program an earlier server left running: /bin/sleep 60 (pid ${orphan.pid}, term-${orphan.pid})`)
      expect(JSON.parse(readFileSync(join(at, "terminal.running.json"), "utf8")).map((r) => r.pid)).toEqual([kept.pid]) // the rest cleared
      await t.close()
    } finally {
      for (const p of [orphan, reused, kept]) p.kill("SIGKILL")
    }
  })
})

describe("close", () => {
  test("close() stops every running session and refuses new ones", async () => {
    const t = createTerm({ root, state, policy, hostPorts: () => [desk.port], caches })
    const a = (await t.start({ command: "sleep 60" })).session
    const b = (await t.start({ command: "sleep 60" })).session
    for (const s of [a, b]) expect(() => process.kill(s.pid, 0)).not.toThrow()
    await t.close()
    for (const s of [a, b]) expect(() => process.kill(s.pid, 0)).toThrow()
    // this term's own sessions (the earlier:… ones are what the folder's terminal.jsonl kept from other tests)
    expect(t.list().sessions.filter((s) => !s.id.startsWith("earlier:")).map((s) => [s.status, s.reason])).toEqual([["stopped", "the desk stopped"], ["stopped", "the desk stopped"]])
    await expect(t.start({ command: "sleep 1" })).rejects.toMatchObject({ status: 410 })
  })
})

// 2026-10-23 audit: the sessions that finished before a restart (terminal.jsonl) are listed again, read-only, with
// their last lines — under earlier:<id>, never a slot's id.
test("finished sessions from before a restart come back read-only", () => {
  const root = mkdtempSync(join(realpathSync(require("node:os").tmpdir()), "term-earlier-"))
  const state = join(root, "state")
  mkdirSync(state)
  writeFileSync(join(state, "terminal.jsonl"), `${JSON.stringify({ at: "2026-10-23T14:00:05.000Z", id: "coder:main", agent: "coder", cwd: ".", command: "bun test", status: "exited", exit: 0, ms: 5000, tail: "12 pass\n0 fail" })}\n`)
  const term = createTerm({ root, state })
  const s = term.list({ tail: 2 }).sessions.find((x) => x.id === "earlier:coder:main")
  expect(s).toMatchObject({ command: "bun test", status: "exited", exit: 0, agent: "coder", endedAt: "2026-10-23T14:00:05.000Z", tail: ["12 pass", "0 fail"] })
  term.close?.()
})

test("a session running at a hard kill (its entry left in terminal-running.json) comes back as killed, with why", () => {
  const root = mkdtempSync(join(realpathSync(require("node:os").tmpdir()), "term-killed-"))
  const state = join(root, "state")
  mkdirSync(state)
  writeFileSync(join(state, "terminal-running.json"), JSON.stringify([{ at: "2026-10-23T14:00:00.000Z", id: "coder:long", agent: "coder", cwd: ".", command: "bun run dev", ms: 0, tail: "listening" }]))
  const term = createTerm({ root, state })
  const s = term.list({ tail: 1 }).sessions.find((x) => x.id === "earlier:coder:long")
  expect(s).toMatchObject({ status: "killed", reason: "the server was killed while it ran", command: "bun run dev", tail: ["listening"] })
  expect(existsSync(join(state, "terminal-running.json"))).toBe(false)
  term.close?.()
})
