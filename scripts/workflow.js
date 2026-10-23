// A workflow file from the command line (docs/phases.md): read one markdown file and show the workflow object it makes —
// every phase, what it reads (its variables and where each comes from), what it hands on (its report fields), how it
// runs — or the reason it does not load (an unknown variable, a phase that does not run before, a field nobody reports).
//
//   bun scripts/workflow.js <file.md> [--json]
//        exit 0 with the outline (--json: the object), or the reason on stderr and exit 1
//
// The desk's own names (tools, agents, code steps) are checked when the desk loads it; this checks the file itself.

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { parseArgs } from "node:util"

import { parseWorkflowMarkdown, RUN_VARS, WORKFLOW_DEFAULTS } from "../backend/kernel/index.js"

const USAGE = "usage: bun scripts/workflow.js <file.md> [--json]"

// The workflow object as lines a person reads.
export function outline(wf) {
  const settings = { ...WORKFLOW_DEFAULTS, ...wf.settings }
  const phases = wf.steps
  const lines = [`${wf.title ?? "(untitled)"} — ${phases.length} phase${phases.length === 1 ? "" : "s"} · deadline ${settings.deadline_minutes} min · retries ${settings.retries}${settings.board === false ? " · no shared board: each phase reads only its variables" : ""}`]
  if (wf.description) lines.push(...wf.description.split("\n").map((l) => `  ${l}`))
  const declared = Object.entries(wf.vars ?? {})
  lines.push("", `run variables: ${[...RUN_VARS.map((v) => (v === "request" ? "request (the Run box)" : v)), ...declared.map(([k, v]) => `${k} = ${JSON.stringify(v)}`)].join(" · ")}`)
  for (const s of phases) {
    const how = s.kind === "code" ? `code ${s.code}` : s.kind === "phase" ? `agent ${s.agent}` : s.own ? "its own agent" : s.kind === "agent" ? `agent ${s.agent}` : "one research call"
    const limits = [s.tools?.length ? `tools ${s.tools.join(", ")}` : null, s.artifacts?.length ? `+ ${s.artifacts.join(", ")}` : null, s.max_steps ? `≤ ${s.max_steps} steps` : null].filter(Boolean).join(" · ")
    lines.push("", `${s.n || "·"}. ${s.id}${s.title !== s.id ? ` — ${s.title}` : ""}`, `   runs:  ${how}${limits ? ` · ${limits}` : ""}${s.after?.length ? ` · after ${s.after.join(", ")}` : ""}`)
    const reads = (s.uses ?? []).map((u) => (u.includes(".") ? `{{${u}}} ← ${u.split(".")[0]}` : phases.some((x) => x.id === u) ? `{{${u}}} ← ${u} (whole)` : `{{${u}}}`))
    const board = (s.board ?? settings.board) !== false && (s.kind === "phase" || (s.own && s.report?.length > 0)) && phases.indexOf(s) > 0
    lines.push(`   reads: ${[...reads, ...(board ? ["the board (every earlier report)"] : [])].join(" · ") || "—"}`)
    lines.push(`   hands on: ${s.report?.length ? s.report.map((f) => `${s.id}.${f}`).join(" · ") : s.kind === "code" ? `{{${s.id}}} (its data)` : "its document"}${s.output ? " (format in ### Output)" : ""}`)
  }
  return lines.join("\n")
}

if (import.meta.main) {
  try {
    const { values: args, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { json: { type: "boolean" } } })
    const [file] = positionals
    if (!file) throw new Error(USAGE)
    const wf = parseWorkflowMarkdown(readFileSync(file, "utf8"), { file: basename(file) })
    console.log(args.json ? JSON.stringify(wf, null, 2) : outline(wf))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
