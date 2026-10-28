import { expect, test } from "bun:test"
import {
  canFrame,
  changedLines,
  choose,
  consoleErrors,
  diffCut,
  diffRows,
  fileMarks,
  flattenTree,
  followSession,
  followShot,
  followTab,
  fullPath,
  hasWorkbench,
  mergeSessions,
  nameParts,
  noteOutput,
  paneIds,
  pickWorkbench,
  sessionLabel,
  sessionTabs,
  shotSrc,
  tabNames,
  treeRows,
  twinTree,
  workbenchTabs,
} from "./workbench.js"

const files = {
  id: "files",
  view: "files",
  state: {
    root: "projects/llm",
    tree: [
      { path: "train.py", size: 10, dir: false },
      { path: "runs", dir: true },
      { path: "runs/1/log.txt", size: 3, dir: false },
      { path: "README.md", size: 5, dir: false },
    ],
    open: [
      { path: "projects/llm/README.md", by: "coder", at: "2026-10-17T10:00:00Z" },
      { path: "projects/llm/train.py", by: "coder", at: "2026-10-17T10:01:00Z" },
    ],
    modified: [
      { path: "projects/llm/train.py", by: "coder", at: "2026-10-17T10:02:00Z", op: "edit", added: 1, removed: 1, diff: "-a\n+b" },
      { path: "projects/llm/train.py", by: "coder", at: "2026-10-17T10:05:00Z", op: "edit", added: 1, removed: 0, diff: "+c" },
      { path: "projects/llm/runs/1/log.txt", by: "coder", at: "2026-10-17T10:03:00Z", op: "write", added: 1, removed: 0, diff: "+x" },
    ],
    focus: null,
  },
}
const preview = {
  id: "preview",
  view: "preview",
  state: {
    pages: [
      { id: "p1", url: "http://localhost:8001/", title: "Dashboard", status: "open", at: "2026-10-17T10:00:00Z", shot: { n: 3, at: "2026-10-17T10:04:00Z", url: "/__askk/browser/shot?id=p1&n=3" } },
      { id: "p2", url: "http://localhost:8002/x", title: "", status: "closed", at: "2026-10-17T09:00:00Z", shot: null },
    ],
  },
}

test("the workbench shows for a desk with a files, terminal or preview artifact; others go to the side slot", () => {
  expect(hasWorkbench({ plan: { id: "plan", view: "checklist" } })).toBe(false)
  expect(hasWorkbench({ files })).toBe(true)
  const other = { id: "notes", view: "files" }
  const plan = { id: "plan", view: "checklist" }
  const picked = pickWorkbench({ notes: other, files, preview, plan })
  expect(picked.files.id).toBe("files") // the shared one, by id
  expect(picked.preview.id).toBe("preview")
  expect(picked.terminal).toBeNull()
  expect(Object.keys(picked.others).sort()).toEqual(["notes", "plan"])
})

test("tabs: the one Preview tab, then open + modified files newest first, one per path, newest change kept", () => {
  const tabs = workbenchTabs({ files, preview })
  expect(tabs.map((t) => t.id)).toEqual(["preview", "file:projects/llm/train.py", "file:projects/llm/runs/1/log.txt", "file:projects/llm/README.md"])
  const train = tabs.find((t) => t.path === "projects/llm/train.py")
  expect(train.modified.diff).toBe("+c")
  expect(train.open.by).toBe("coder")
  // 2026-10-17 owner: one preview pane — its pages and visuals are the pane's own strip, not a tab each
  expect(tabs[0]).toMatchObject({ kind: "preview", name: "Preview", items: 2, open: 0, at: Date.parse("2026-10-17T10:04:00Z") })
  expect(workbenchTabs({ files }).some((t) => t.kind === "preview")).toBe(false)
})

test("tabs: the Preview tab's time is the preview's newest change (a visual drawn, a question), so follow can pick it", () => {
  const drawn = { ...preview, state: { ...preview.state, visuals: [{ id: "flow", title: "The line", visual: { kind: "steps", steps: [] }, at: "2026-10-17T10:30:00Z" }], current: { kind: "visual", id: "flow" }, asks: [{ id: "q1", text: "why?", at: "2026-10-17T10:31:00Z", answer: null }] } }
  const tabs = workbenchTabs({ files, preview: drawn })
  expect(tabs[0]).toMatchObject({ id: "preview", items: 3, open: 1, at: Date.parse("2026-10-17T10:31:00Z") })
  expect(followTab(tabs)).toBe("preview") // newer than the last file change (10:05)
})

test("tabs: the owner's pinned files join; a dismissed tab stays closed until its file changes again", () => {
  const pinned = [{ path: "projects/llm/runs/1/log.txt", at: Date.parse("2026-10-17T11:00:00Z") }, { path: "projects/llm/notes.md", at: 1 }]
  const dismissed = new Map([["projects/llm/README.md", Date.parse("2026-10-17T10:30:00Z")], ["projects/llm/train.py", 0]])
  const tabs = workbenchTabs({ files, pinned, dismissed })
  expect(tabs.map((t) => t.path)).toEqual(["projects/llm/runs/1/log.txt", "projects/llm/train.py", "projects/llm/notes.md"])
  expect(tabs[0].pinned).toBe(true)
  expect(workbenchTabs({ files, max: 1 }).length).toBe(1)
})

// 2026-10-26, critic l20: the work/dev/parked copy of waiting.js showed as a second tab also named "waiting.js".
test("tabs: same-named files are told apart by their folder; one path is one tab; a unique name stays plain", () => {
  const live = "projects/powerhouse/backend/live/waiting.js"
  const parked = "work/dev/parked/backend/live/waiting.js"
  const twin = {
    state: {
      open: [{ path: live, by: "dev", at: "2026-10-26T02:00:00Z" }, { path: "projects/powerhouse/backend/live/preview.js", by: "coder", at: "2026-10-26T02:01:00Z" }],
      modified: [
        { path: live, by: "dev", at: "2026-10-26T02:02:00Z", op: "create" },
        { path: parked, by: "dev", at: "2026-10-26T02:03:00Z", op: "create" },
      ],
    },
  }
  const tabs = workbenchTabs({ files: twin })
  const waiting = tabs.filter((t) => t.path.endsWith("/waiting.js"))
  expect(waiting.length).toBe(2)
  expect(waiting.every((t) => t.name.startsWith("waiting.js"))).toBe(true)
  expect(new Set(waiting.map((t) => t.name)).size).toBe(2)
  expect(Object.fromEntries(waiting.map((t) => [t.path, t.name]))).toEqual({ [live]: "waiting.js · powerhouse", [parked]: "waiting.js · parked" })
  expect(tabs.find((t) => t.path.endsWith("/preview.js")).name).toBe("preview.js")
  // the same path opened and modified: one tab, its plain name
  const one = workbenchTabs({ files: { state: { open: twin.state.open.slice(0, 1), modified: twin.state.modified.slice(0, 1) } } })
  expect(one.map((t) => t.name)).toEqual(["waiting.js"])
  // the twin dismissed: the label is plain again
  expect(workbenchTabs({ files: twin, dismissed: new Map([[parked, Date.parse("2026-10-26T03:00:00Z")]]) }).find((t) => t.path === live).name).toBe("waiting.js")
  // differ only further up, or three of a name: the shortest suffix that tells them apart
  const names = tabNames(["a/x/live/w.js", "b/x/live/w.js", "a/y/live/w.js"])
  expect([...names.values()]).toEqual(["w.js · a/x", "w.js · b/x", "w.js · y"])
  // a file at the root: the nearest folder already differs, the root one reads "/"
  expect([...tabNames(["a/live/w.js", "w.js"]).values()]).toEqual(["w.js · live", "w.js · /"])
})

test("follow: the newest tab; the session with the newest output; the newest shot", () => {
  expect(followTab(workbenchTabs({ files, preview }))).toBe("file:projects/llm/train.py")
  expect(followTab([])).toBeNull()
  const sessions = [
    { id: "a", status: "running", startedAt: "2026-10-17T10:00:00Z", tail: ["1"] },
    { id: "b", status: "exited", exit: 0, startedAt: "2026-10-17T09:00:00Z", endedAt: "2026-10-17T09:30:00Z", tail: ["done"] },
    { id: "c", status: "running", startedAt: "2026-10-17T10:10:00Z", tail: ["x"] },
  ]
  const t0 = Date.parse("2026-10-17T10:20:00Z")
  let seen = noteOutput(new Map(), sessions, t0)
  expect(followSession(sessions, seen)).toBe("c") // both running from now: the newest
  seen = noteOutput(seen, sessions.map((s) => (s.id === "a" ? { ...s, tail: ["1", "2"] } : s)), t0 + 1000)
  expect(seen.get("a").at).toBe(t0 + 1000)
  expect(seen.get("c").at).toBe(t0)
  expect(followSession(sessions, seen, { tieMs: 5000 })).toBe("c") // a printed a second later: as new, c started last
  seen = noteOutput(seen, sessions.map((s) => (s.id === "a" ? { ...s, tail: ["1", "2", "3"] } : s)), t0 + 30000)
  expect(followSession(sessions, seen, { tieMs: 5000 })).toBe("a") // c quiet for 30 s, a printing
  expect(followSession([sessions[1]], new Map())).toBe("b")
  expect(followShot(preview.state.pages)).toBe("p1")
})

// 2026-10-17, observed: the coder started r07 while r06 had just ended; the twin brought r06's exit (and the commit's)
// after r07's first sighting, and follow sat on the finished r06 while r07 printed.
test("follow: an ended session never outranks the run that started after it ended", () => {
  const ms = (t) => Date.parse(`2026-10-17T20:${t}Z`)
  const r06 = { id: "r06", status: "running", startedAt: "2026-10-17T20:49:20.504Z", tail: ["step 900"] }
  const git = { id: "git", status: "running", startedAt: "2026-10-17T20:54:50.438Z", tail: [] }
  const r07 = { id: "r07", status: "running", startedAt: "2026-10-17T20:54:50.449Z", tail: ["config.optimizer: adamw"] }
  let seen = noteOutput(new Map(), [r06], ms("50:00"))
  seen = noteOutput(seen, [r07, r06], ms("54:55")) // t1: r07 first seen; the twin still shows r06 running
  const ended = [
    { ...git, status: "exited", exit: 0, endedAt: "2026-10-17T20:54:52.490Z", tail: ["create mode 100644 runs/r06/train.log"] },
    { ...r06, status: "exited", exit: 0, endedAt: "2026-10-17T20:54:43.827Z", tail: ["train_seconds=296.7"] },
  ]
  const later = [r07, ...ended]
  seen = noteOutput(seen, later, ms("56:22")) // t2 > t1: the exits arrive
  expect(seen.get("r06").at).toBe(Date.parse("2026-10-17T20:54:43.827Z")) // not t2
  expect(seen.get("git").at).toBe(Date.parse("2026-10-17T20:54:52.490Z"))
  expect(followSession(later, seen, { tieMs: 5000 })).toBe("r07")
  // r07's tail stands still in the twin; a poll of term/list sees it print
  seen = noteOutput(seen, [{ ...r07, tail: ["step 200"] }, ...ended], ms("56:29"))
  expect(followSession(later, seen, { tieMs: 0 })).toBe("r07")
  // the next run and its commit start together: the run (started last) wins over the commit's output
  const r08 = { id: "r08", status: "running", startedAt: "2026-10-17T21:00:23.891Z", tail: [] }
  const git2 = { id: "git2", status: "exited", exit: 0, startedAt: "2026-10-17T21:00:23.878Z", endedAt: "2026-10-17T21:00:25.920Z", tail: ["create mode"] }
  const r07done = { ...r07, status: "exited", exit: 0, endedAt: "2026-10-17T21:00:16.444Z", tail: ["train_seconds=296.6"] }
  seen = noteOutput(seen, [r08, { ...git2, status: "running", endedAt: null, tail: [] }, r07done], Date.parse("2026-10-17T21:00:24Z"))
  const now = [r08, git2, r07done]
  seen = noteOutput(seen, now, Date.parse("2026-10-17T21:00:27Z")) // r08 quiet since 21:00:24; the commit ended at :25.9
  expect(followSession(now, seen, { tieMs: 0 })).toBe("git2")
  expect(followSession(now, seen, { tieMs: 5000 })).toBe("r08")
  // a twin session the polls have not seen yet counts from its start
  expect(followSession([r08, git2], new Map(), { tieMs: 5000 })).toBe("r08")
})

// 2026-10-17, observed: the coder's 19-second eval reached the twin half a minute after it ended.
test("mergeSessions: the twin's sessions, with ends and new sessions term/list knows sooner", () => {
  const twin = [
    { id: "uv1", name: "uv", command: "uv run x", status: "running", startedAt: "2026-10-17T21:18:06.361Z", tail: ["a", "b", "c"] },
    { id: "git", name: "git && git", status: "exited", exit: 0, startedAt: "2026-10-17T21:17:03.748Z", endedAt: "2026-10-17T21:17:05.561Z", tail: [] },
  ]
  expect(mergeSessions(twin, null)).toBe(twin)
  expect(mergeSessions(twin, [])).toBe(twin)
  const polled = [
    { id: "uv2", name: "uv && uv", command: "uv run eval", status: "running", startedAt: "2026-10-17T21:18:06.367Z", tail: ["eval"] },
    { id: "uv1", name: "uv", status: "exited", exit: 0, startedAt: "2026-10-17T21:18:06.361Z", endedAt: "2026-10-17T21:18:06.451Z", tail: ["c"] },
    { id: "git", name: "git && git", status: "exited", exit: 0, startedAt: "2026-10-17T21:17:03.748Z", endedAt: "2026-10-17T21:17:05.561Z", tail: [] },
    { id: "old", name: "r00", status: "exited", exit: 0, startedAt: "2026-10-17T20:16:46.463Z", endedAt: "2026-10-17T20:21:54.631Z", tail: [] },
  ]
  const merged = mergeSessions(twin, polled)
  expect(merged.map((s) => s.id)).toEqual(["uv2", "uv1", "git"]) // newest first; the session older than the twin's list stays out
  expect(merged[1]).toMatchObject({ status: "exited", exit: 0, endedAt: "2026-10-17T21:18:06.451Z", command: "uv run x", tail: ["a", "b", "c"] })
  expect(merged[2]).toBe(twin[1])
  // a poll older than the twin never brings a session back to running
  expect(mergeSessions([{ ...twin[0], status: "exited", exit: 0 }], [{ ...polled[1], status: "running" }])[0].status).toBe("exited")
  // follow sees the eval the twin has not listed
  const seen = noteOutput(new Map(), polled, Date.parse("2026-10-17T21:18:08Z"))
  expect(followSession(merged, seen, { tieMs: 5000 })).toBe("uv2")
})

test("mergeSessions: a slot session's next command, polled before the twin has it, takes the poll's fields", () => {
  const twin = [
    { id: "m", agent: "coder", slot: "main", runs: 3, command: "bun test", status: "exited", exit: 0, startedAt: "2026-10-17T21:18:00Z", tail: ["1 pass"] },
    { id: "l", agent: "coder", slot: "long", runs: 1, command: "bun run dev", status: "running", startedAt: "2026-10-17T21:10:00Z", tail: ["ready"] },
  ]
  const polled = [
    { id: "m", agent: "coder", slot: "main", runs: 4, command: "bun run build", status: "running", exit: null, startedAt: "2026-10-17T21:19:00Z", tail: ["building"] },
    { id: "l", agent: "coder", slot: "long", runs: 1, command: "bun run dev", status: "running", startedAt: "2026-10-17T21:10:00Z", tail: ["GET /"] },
  ]
  const merged = mergeSessions(twin, polled)
  expect(merged[0]).toMatchObject({ id: "m", runs: 4, command: "bun run build", status: "running", exit: null, tail: ["building"] })
  expect(merged[1]).toBe(twin[1])
  // an older poll (runs lower) changes nothing
  expect(mergeSessions(twin, [{ ...polled[0], runs: 2, status: "running" }])[0]).toBe(twin[0])
})

// 2026-10-17 owner: a tab per command buried the work — at most two tabs per agent.
test("sessionTabs: an agent's main and long sessions, at most two per agent, in a stable order; sessionLabel names them", () => {
  const at = (m) => `2026-10-17T21:${String(m).padStart(2, "0")}:00Z`
  const sessions = [
    { id: "cm", agent: "coder", slot: "main", status: "exited", startedAt: at(30) },
    { id: "old1", agent: "coder", name: "pytest", status: "exited", startedAt: at(20) }, // an earlier server's, no slot
    { id: "cl", agent: "coder", slot: "long", status: "running", startedAt: at(25) },
    { id: "am", agent: "critic", slot: "main", status: "running", startedAt: at(29) },
    { id: "old2", agent: "coder", name: "bun", status: "running", startedAt: at(10) },
    { id: "own", agent: null, name: "ls", status: "exited", startedAt: at(28) },
    { id: "sm", agent: "helper", slot: "scratch.main", status: "exited", startedAt: at(27) },
  ]
  const tabs = sessionTabs(sessions)
  expect(tabs.map((s) => s.id)).toEqual(["cm", "cl", "am", "sm", "own"])
  // the order holds when the long one prints and main runs again later
  expect(sessionTabs([sessions[2], sessions[0], sessions[3]]).map((s) => s.id)).toEqual(["cm", "cl", "am"])
  const counts = Object.groupBy(tabs, (s) => s.agent ?? "owner")
  expect(Math.max(...Object.values(counts).map((l) => l.length))).toBeLessThanOrEqual(2)
  expect(tabs.map(sessionLabel)).toEqual(["coder · main", "coder · long", "critic · main", "helper · scratch.main", "ls"])
  expect(sessionTabs([])).toEqual([])
})

test("choose: the owner's pick while paused, else what the pane showed when it paused, else the followed one", () => {
  const ids = ["x", "y", "z"]
  expect(choose({ following: true, chosen: "x", followed: "y", ids })).toBe("y")
  expect(choose({ following: false, chosen: "x", followed: "y", ids })).toBe("x")
  expect(choose({ following: false, chosen: "gone", followed: "y", ids })).toBe("y")
  expect(choose({ following: true, chosen: null, followed: null, ids })).toBe("x")
  expect(choose({ following: true, chosen: null, followed: null, ids: [] })).toBeNull()
  // paused, nothing picked in this pane: it stays on what it showed
  expect(choose({ following: false, chosen: null, followed: "y", shown: "x", ids })).toBe("x")
  expect(choose({ following: true, chosen: null, followed: "y", shown: "x", ids })).toBe("y")
  expect(choose({ following: false, chosen: "z", followed: "y", shown: "x", ids })).toBe("z")
  expect(choose({ following: false, chosen: null, followed: "y", shown: "gone", ids })).toBe("y")
})

// 2026-10-17, observed: a click on an editor tab paused follow, and the terminal went on switching sessions.
test("paneIds: a pause freezes every pane; the owner's pick moves only its own pane", () => {
  const lists = { tab: ["file:a", "file:b"], file: ["file:a", "file:b"], page: ["page:p1"], session: ["r06", "git", "r07"] }
  let followed = { tab: "file:b", file: "file:b", page: "page:p1", session: "r06" }
  expect(paneIds({ following: true, followed, lists })).toEqual(followed)
  const frozen = paneIds({ following: true, followed, lists }) // what showed when the owner clicked
  const chosen = { tab: "file:a", file: "file:a", page: null, session: null } // the owner clicked file a's tab
  followed = { tab: "file:b", file: "file:b", page: "page:p1", session: "git" } // then git printed
  expect(paneIds({ following: false, chosen, frozen, followed, lists })).toEqual({ tab: "file:a", file: "file:a", page: "page:p1", session: "r06" })
  expect(paneIds({ following: true, chosen, frozen, followed, lists })).toEqual(followed)
})

test("paths: the twin's tree under its root, fs/tree flattened", () => {
  expect(fullPath("projects/llm", "train.py")).toBe("projects/llm/train.py")
  expect(fullPath("projects/llm", "projects/llm/train.py")).toBe("projects/llm/train.py")
  expect(fullPath("", "a/b")).toBe("a/b")
  expect(twinTree(files).map((e) => e.path)).toContain("projects/llm/runs/1/log.txt")
  const flat = flattenTree("projects/llm", [
    { name: "runs", type: "dir", children: [{ name: "1", type: "dir", children: [{ name: "log.txt", type: "file" }] }] },
    { name: ".venv", type: "dir", skipped: true },
    { name: null, type: "omitted", omitted: 4 },
    { name: "train.py", type: "file" },
  ])
  expect(flat).toEqual([
    { path: "projects/llm/runs", dir: true },
    { path: "projects/llm/runs/1", dir: true },
    { path: "projects/llm/runs/1/log.txt", dir: false },
    { path: "projects/llm/.venv", dir: true, skipped: true },
    { path: "projects/llm/train.py", dir: false },
  ])
})

test("tree rows: folders first, open where a marked file is, the owner's toggles win", () => {
  const marks = fileMarks(files)
  expect(marks.get("projects/llm/train.py")).toBe("modified")
  expect(marks.get("projects/llm/README.md")).toBe("open")
  const entries = [...twinTree(files), { path: "projects/llm/data/big.bin", dir: false }]
  const rows = treeRows(entries, { root: "projects/llm", marks })
  expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.name}`)).toEqual(["data", "  big.bin", "runs", "  1", "    log.txt", "README.md", "train.py"])
  expect(rows.find((r) => r.name === "runs")).toMatchObject({ dir: true, expanded: true, inside: true })
  expect(rows.find((r) => r.name === "data")).toMatchObject({ expanded: true, inside: false }) // the root's child: open
  const closed = treeRows(entries, { root: "projects/llm", marks, toggled: new Map([["projects/llm/runs", false], ["projects/llm/data", true]]) })
  expect(closed.map((r) => r.name)).toEqual(["data", "big.bin", "runs", "README.md", "train.py"])
  // dot-folders and folders the host did not expand start closed
  const quiet = treeRows([{ path: "p/.git", dir: true, skipped: true }, { path: "p/.cache/x", dir: false }, { path: "p/src/a.py", dir: false }], { root: "p" })
  expect(quiet.map((r) => r.name)).toEqual([".cache", ".git", "src", "a.py"])
})

// 2026-10-26, l27: four "2026-10-22-bun-*" rows all read "2026-10-22-bun…"; l44: a fixed tail made the notes rows alike.
test("tree names: a long name keeps its tail", () => {
  expect(nameParts("a.py")).toEqual({ head: "a.py", tail: "" })
  const long = "2026-10-22-bun-1.4-highlights-notes.md"
  const p = nameParts(long, [long, "2026-10-22-bun-yaml-notes.md", "2026-10-22-brief.md"])
  expect(p.tail.endsWith("notes.md")).toBe(true)
  expect(p.head + p.tail).toBe(long)
  expect(p).toEqual({ head: "2026-10-22-bun-", tail: "1.4-highlights-notes.md" })
  // the live notes rows: the tail starts on the word that tells them apart, not on the date they share
  const notes = ["bun-1.4-highlights-2026-10-22.md", "bun-image-2026-10-22.md", "bun-markdown-2026-10-22.md", "bun-yaml-2026-10-22.md"]
  expect(notes.map((n) => nameParts(n, notes).tail)).toEqual(["1.4-highlights-2026-10-22.md", "image-2026-10-22.md", "markdown-2026-10-22.md", "yaml-2026-10-22.md"])
  // a long name no sibling shares the start of stays whole
  expect(nameParts("releases-2026-10-20.md", notes)).toEqual({ head: "releases-2026-10-20.md", tail: "" })
  // treeRows gives each row its parts, split against its siblings
  const rows = treeRows(notes.map((n) => ({ path: `w/notes/${n}`, dir: false })), { root: "w" })
  expect(rows.find((r) => r.name === "bun-image-2026-10-22.md")).toMatchObject({ head: "bun-", tail: "image-2026-10-22.md" })
  expect(new Set(rows.filter((r) => !r.dir).map((r) => r.tail)).size).toBe(4)
  expect(rows.every((r) => r.head + r.tail === r.name)).toBe(true)
})

test("a file's lines for the editor, capped", async () => {
  const { fileLines } = await import("./workbench.js")
  expect(fileLines("a\nb\nc", 2)).toEqual({ lines: ["a", "b"], cut: 1 })
  expect(fileLines(null)).toEqual({ lines: [], cut: 0 })
})

test("diff rows and the lines a diff added, with and without hunk heads", () => {
  expect(diffRows(" a\n-b\n+c\n … 3 more lines\n")).toEqual([
    { op: " ", text: "a" },
    { op: "-", text: "b" },
    { op: "+", text: "c" },
    { op: "…", text: "… 3 more lines" },
  ])
  const text = "import x\n\ndef f():\n    return 2\n\nprint(f())\n"
  expect([...changedLines(text, " def f():\n-    return 1\n+    return 2\n \n")]).toEqual([4])
  expect([...changedLines(text, "@@ -1,2 +5,3 @@\n \n+print(f())")]).toEqual([6])
  expect([...changedLines("a\nb\n", "+a\n+b")].sort()).toEqual([1, 2]) // a new file
  // the file moved on since the diff: added lines found by their text
  expect([...changedLines("zzz\n    return 2\n", " def f():\n+    return 2")]).toEqual([2])
})

test("a whole-file rewrite cut at 80 lines: its added lines past the cut are changed, and the cut is told", async () => {
  const { lineDiff } = await import("../kernel/builtin/files.js")
  const keep = Array.from({ length: 45 }, (_, i) => `keep ${i + 1}`)
  const before = [...keep, ...Array.from({ length: 352 }, (_, i) => `old ${i}`), "tail a", "tail b", "tail c", "end"].join("\n")
  const after = [...keep, ...Array.from({ length: 389 }, (_, i) => `new ${i}`), "tail a", "tail b", "tail c", "end"].join("\n")
  const { diff, added, removed } = lineDiff(before, after)
  const rows = diffRows(diff)
  expect(rows[0].text).toBe("@@ -43,358 +43,395 @@")
  expect(rows.filter((r) => r.op === "+").length).toBe(0) // the cap cut every added row
  expect(rows.filter((r) => r.op === "-").length).toBe(75)
  expect(rows.at(-1).op).toBe("…")
  // the added block: new lines 46..434 (after 45 kept lines), not the 3 trailing context lines
  const lines = changedLines(after, diff, { added })
  expect(lines.size).toBe(389)
  expect(Math.min(...lines)).toBe(46)
  expect(Math.max(...lines)).toBe(434)
  expect(after.split("\n")[45]).toBe("new 0")
  // without the count: up to the hunk's end (its trailing context too)
  expect(changedLines(after, diff).size).toBe(392)
  expect(diffCut(diff, { added, removed })).toEqual({
    more: 669,
    added: { shown: 0, total: 389 },
    removed: { shown: 75, total: 352 },
    range: { from: 46, to: 434 },
  })
})

test("a cut diff by hand: all '-' rows, cut inside the added rows, a new file, no cut", () => {
  const minus = Array.from({ length: 78 }, (_, i) => `-old ${i}`)
  const text = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n")
  const allMinus = ["@@ -10,90 +10,40 @@", ...minus, " … 50 more lines"].join("\n")
  expect([...changedLines(text, allMinus, { added: 40 })]).toEqual(Array.from({ length: 40 }, (_, i) => 10 + i))
  expect(diffCut(allMinus, { added: 40, removed: 90 })?.range).toEqual({ from: 10, to: 49 })
  // cut inside the added rows: the ones shown plus the rest
  const someAdded = ["@@ -1,3 +1,30 @@", " a", "-b", "+n1", "+n2", " … 28 more lines"].join("\n")
  const marked = changedLines(text, someAdded, { added: 28 })
  expect(Math.min(...marked)).toBe(2)
  expect(Math.max(...marked)).toBe(29)
  expect(marked.size).toBe(28)
  // a new file cut at 80: every line of it
  const created = ["@@ -0,0 +1,105 @@", ...Array.from({ length: 78 }, (_, i) => `+l${i}`), " … 27 more lines"].join("\n")
  expect(changedLines(text, created, { added: 105 }).size).toBe(105)
  // removed only, cut: no added side to tell
  const gone = ["@@ -1,90 +1,0 @@", ...minus, " … 12 more lines"].join("\n")
  expect(changedLines(text, gone, { added: 0 }).size).toBe(0)
  expect(diffCut(gone, { added: 0, removed: 90 })?.range).toBeNull()
  expect(diffCut(" a\n-b\n+c")).toBeNull()
})

test("preview helpers: the shot's url by n, console errors, which pages may be framed", () => {
  expect(shotSrc({ n: 3, url: "/__askk/browser/shot?id=p1&n=3" })).toBe("/__askk/browser/shot?id=p1&n=3")
  expect(shotSrc({ n: 4, url: "/__askk/browser/shot?id=p1" })).toBe("/__askk/browser/shot?id=p1&n=4")
  expect(shotSrc(null)).toBeNull()
  expect(shotSrc({ n: 1, url: "data:image/png;base64,AAA" })).toBe("data:image/png;base64,AAA")
  const errors = consoleErrors({ console: [{ level: "log", text: "hi" }, { level: "error", text: "boom" }], errors: 2 })
  expect(errors).toEqual({ lines: [{ level: "error", text: "boom" }], count: 2 })
  expect(consoleErrors({ errors: ["x"] }).count).toBe(1)
  expect(canFrame("http://localhost:8001/")).toBe(true)
  expect(canFrame("http://127.0.0.1:5173/a")).toBe(true)
  expect(canFrame("https://example.com/")).toBe(false)
  expect(canFrame("http://localhost:1111/live", "http://localhost:1111/")).toBe(false)
  expect(canFrame("javascript:alert(1)")).toBe(false)
})

test("callLook: the files and preview artifacts' commands have their own kind", async () => {
  const { callLook, CALL_KINDS } = await import("./visual.js")
  expect(callLook({ name: "files.write", type: "dev", view: "files" })).toMatchObject({ kind: "files", icon: "folder-tree" })
  expect(callLook({ name: "preview.shot", type: "dev", view: "preview" })).toMatchObject({ kind: "preview", icon: "app-window" })
  expect(callLook({ name: "terminal.run", type: "dev", view: "terminal" }).kind).toBe("terminal")
  expect(CALL_KINDS).toEqual(expect.arrayContaining(["files", "preview"]))
})
