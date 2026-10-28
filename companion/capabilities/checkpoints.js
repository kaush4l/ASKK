// Checkpoints of a project's working tree (2026-10-25 owner: "when the agent modifies files in the project, we want to
// make sure all the changes are made. If any changes break the application, we should be able to roll back, capture
// this evidence and start from that point"). A project the desk changes in place (ASKK itself, the owner's own
// uncommitted work around it) is never reset with git: a checkpoint is a copy of every file that differs from HEAD —
// modified, added, untracked, and which were deleted — so a rollback brings the tree back to exactly that point and
// leaves HEAD, the index and the branch alone.
//
//   const cp = createCheckpoints({ repo, dir, clock })
//   cp.create({ why, by, kind }) → { id, at, head, why, by, kind, bytes, skipped, files: n, deleted: n }
//   cp.list() → newest first, the manifests without their file lists
//   cp.restore(id, { why, by }) → { id, before, restored: [path], reverted: [path], removed: [path] }
//     before: a checkpoint of the tree as it was (the evidence of what broke, restorable too). Refused when HEAD moved
//     since the checkpoint (a commit in between: the owner's) — 409.
//
// Stored in dir/<id>/: manifest.json {id, at, head, why, by, kind, bytes, entries: [{path, code, bytes} | {path, code,
// deleted: true}], skipped} and files/<path>. A file over MAX_FILE, or once the checkpoint passed MAX_TOTAL, is skipped
// (named in `skipped`; a rollback leaves it as it is). The newest KEEP stay.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import { httpError } from "../shared/http.js"
import { attempt } from "../shared/safe.js"

const MAX_FILE = 5 * 1024 * 1024
const MAX_TOTAL = 80 * 1024 * 1024
const KEEP = 30
const ID = /^c\d{1,6}$/

// `git status --porcelain=v1 -z --untracked-files=all` → [{path, code}] (a rename: its new path, and its old one deleted)
export function parseStatus(out) {
  const parts = String(out ?? "").split("\0").filter(Boolean)
  const rows = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2)
    rows.push({ path: parts[i].slice(3), code })
    if (code[0] === "R" || code[0] === "C") {
      const old = parts[++i]
      if (code[0] === "R") rows.push({ path: old, code: " D" })
    }
  }
  return rows.filter((r) => r.path)
}

const safePath = (p) => {
  const n = normalize(String(p))
  if (!n || n.startsWith("/") || n.split("/").includes("..")) throw httpError(400, `bad path ${p}`)
  return n
}

export function createCheckpoints({ repo, dir, clock = () => new Date(), spawn = Bun.spawnSync } = {}) {
  const git = (...args) => {
    const r = spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
    return { ok: r.exitCode === 0, out: r.stdout ?? Buffer.alloc(0), err: String(r.stderr ?? "") }
  }
  const head = () => {
    const r = git("rev-parse", "HEAD")
    if (!r.ok) throw httpError(500, `git rev-parse HEAD: ${r.err.trim()}`)
    return String(r.out).trim()
  }
  const status = () => {
    const r = git("status", "--porcelain=v1", "-z", "--untracked-files=all")
    if (!r.ok) throw httpError(500, `git status: ${r.err.trim()}`)
    return parseStatus(String(r.out))
  }
  const ids = () => (existsSync(dir) ? readdirSync(dir).filter((d) => ID.test(d)) : []).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const manifest = (id) => {
    if (!ID.test(String(id ?? ""))) throw httpError(400, `No checkpoint "${id}" (ids are c1, c2 …).`)
    const m = attempt(() => JSON.parse(readFileSync(join(dir, id, "manifest.json"), "utf8")))
    if (!m) throw httpError(404, `No checkpoint ${id}.`)
    return m
  }
  const summary = ({ entries, ...m }) => ({ ...m, files: entries.filter((e) => !e.deleted).length, deleted: entries.filter((e) => e.deleted).length })

  function create({ why = "", by = null, kind = "mark" } = {}) {
    const n = (ids().map((d) => Number(d.slice(1))).at(-1) ?? 0) + 1
    const id = `c${n}`
    const base = join(dir, id)
    const entries = []
    const skipped = []
    let total = 0
    for (const { path, code } of status()) {
      const p = safePath(path)
      const full = join(repo, p)
      const st = attempt(() => statSync(full))
      if (!st) {
        entries.push({ path: p, code, deleted: true })
        continue
      }
      if (!st.isFile()) continue
      if (st.size > MAX_FILE || total + st.size > MAX_TOTAL) {
        skipped.push(p)
        continue
      }
      const to = join(base, "files", p)
      mkdirSync(dirname(to), { recursive: true })
      writeFileSync(to, readFileSync(full))
      total += st.size
      entries.push({ path: p, code, bytes: st.size })
    }
    const m = { id, at: clock().toISOString(), head: head(), why: String(why ?? "").slice(0, 400), by, kind, bytes: total, entries, skipped }
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "manifest.json"), JSON.stringify(m, null, 1))
    for (const old of ids().slice(0, -KEEP)) rmSync(join(dir, old), { recursive: true, force: true })
    return summary(m)
  }

  const list = () =>
    ids()
      .reverse()
      .map((id) => attempt(() => summary(manifest(id))))
      .filter(Boolean)

  // Back to checkpoint `id`: every file it holds as it held it, every file it says was deleted gone, every other file
  // that differs now put back to HEAD (tracked) or taken away (new since: kept in `before`).
  function restore(id, { why = "", by = null } = {}) {
    const m = manifest(id)
    const now = head()
    if (now !== m.head) throw httpError(409, `HEAD moved since ${id} (${m.head.slice(0, 8)} → ${now.slice(0, 8)}): a commit came in between — not rolled back.`)
    const before = create({ why: `before rollback to ${id}${why ? `: ${why}` : ""}`, by, kind: "before-rollback" })
    const held = new Set(m.entries.map((e) => e.path))
    const skip = new Set(m.skipped ?? [])
    const restored = []
    const reverted = []
    const removed = []
    for (const e of m.entries) {
      const full = join(repo, e.path)
      if (e.deleted) {
        if (existsSync(full)) {
          unlinkSync(full)
          removed.push(e.path)
        }
        continue
      }
      const saved = readFileSync(join(dir, id, "files", e.path))
      const cur = attempt(() => readFileSync(full))
      if (cur && Buffer.compare(cur, saved) === 0) continue
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(`${full}.askk-tmp`, saved)
      renameSync(`${full}.askk-tmp`, full)
      restored.push(e.path)
    }
    for (const { path } of status()) {
      const p = safePath(path)
      if (held.has(p) || skip.has(p)) continue
      const full = join(repo, p)
      if (git("cat-file", "-e", `HEAD:${p}`).ok) {
        const r = git("show", `HEAD:${p}`)
        if (!r.ok) continue
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, r.out)
        reverted.push(p)
      } else if (existsSync(full)) {
        unlinkSync(full)
        removed.push(p)
      }
    }
    return { id, before: before.id, restored, reverted, removed }
  }

  return { create, list, restore, get: (id) => summary(manifest(id)), status }
}
