// The terminal artifact (`terminal`): the team's last 5 terminal runs, newest
// last — who ran what, where, the exit code and the end of the output — and
// the background processes (term.start: status, URLs, last output lines),
// re-read before every step, so a tester sees the programmer's failing test
// run and dev server, and the lead sees both. With `filesystem` (the tree) it
// is the live state of a coding desk: what the files are, and what running
// them did. live() is the same state for the UI (view "terminal").

import { Artifact } from "@/backend/core/artifact"
import { termRequest } from "@/backend/features/terminal/tools"

const SHOW = 5
const TAIL_LINES = 25
const PROC_LINES = 10

export class TerminalArtifact extends Artifact {
  static type = "terminal"
  static title = "TERMINAL"

  #entries = []
  #procs = []
  #tails = {} // proc id -> last output lines
  #policy = null
  #error = null

  async refresh() {
    try {
      const data = await termRequest("term/log", { params: { limit: SHOW } })
      this.#entries = data.entries ?? []
      this.#procs = data.procs ?? []
      this.#policy = data.policy ?? null
      this.#error = null
      const tails = {}
      await Promise.all(
        this.#procs.map(async (p) => {
          const log = await termRequest("term/logs", { params: { id: p.id, tail: PROC_LINES } }).catch(() => null)
          if (log) tails[p.id] = log.output ?? ""
        })
      )
      this.#tails = tails
    } catch (error) {
      this.#error = error.message
    }
  }

  render() {
    const lines = [`## ${TerminalArtifact.title}`, ""]
    if (this.#error) return [...lines, `Not available: ${this.#error}`].join("\n")
    if (this.#policy) {
      lines.push(`term.run programs: ${this.#policy.programs.join(", ")} · limit ${this.#policy.timeoutSeconds} s per command.`)
      if (this.#policy.backgroundMinutes) lines.push(`term.start: at most ${this.#policy.maxProcesses ?? 4} background processes, each stopped after ${this.#policy.backgroundMinutes} min.`)
    }
    lines.push(`The team's last ${SHOW} runs, newest last (re-read before every step):`)
    if (!this.#entries.length) lines.push("", "(none yet)")
    for (const e of this.#entries) {
      const tail = (e.tail ?? "").split("\n").slice(-TAIL_LINES).join("\n").trimEnd()
      lines.push(
        "",
        `### ${e.at?.slice(11, 19) ?? "?"}Z ${e.agent ?? "?"} · $ ${e.command} · in ${e.cwd} → exit ${e.exit}${e.timedOut ? ` (${e.timedOut})` : ""} · ${((e.ms ?? 0) / 1000).toFixed(1)} s`,
        "```",
        tail || "(no output)",
        "```"
      )
    }
    lines.push("", "Background processes (term.start; term.logs / term.stop by id):")
    if (!this.#procs.length) lines.push("(none)")
    for (const p of this.#procs) {
      const status = p.status === "running" ? "RUNNING" : `exited ${p.exit}${p.reason ? ` (${p.reason})` : ""}`
      const tail = (this.#tails[p.id] ?? "").split("\n").slice(-PROC_LINES).join("\n").trimEnd()
      lines.push(
        "",
        `### ${p.id} · ${p.name} · ${status} · ${p.agent ?? "?"} · $ ${p.command} · in ${p.cwd}${p.urls?.length ? ` · ${p.urls.join(" ")}` : ""}`,
        "```",
        tail || "(no output)",
        "```"
      )
    }
    return lines.join("\n")
  }

  // For the UI (Artifact.live(), published by the engine when it changes).
  live() {
    return {
      view: "terminal",
      data: {
        runs: this.#entries.slice(-SHOW),
        procs: this.#procs.map((p) => ({ ...p, tail: this.#tails[p.id] ?? "" })),
        ...(this.#error ? { error: this.#error } : {}),
      },
    }
  }
}
