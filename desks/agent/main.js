// agent — the core desk (2026-10-20 owner: "the core desk will now be updated to a single agent and create multiple
// subagents capable tool"): one agent, no fixed team, the kernel's capability kit. Any request: it works it itself, with
// helpers it makes and runs in parallel (agent.spawn / catalog / update / dismiss, dispatch — a helper that earns it is
// kept as agent/<name>/<name>.md), or, when the work is a standing job, by designing a desk for it (desk.create →
// desk.load → desk.ask, written to the local desks folder, custom/). Its practice — the run checklist, quality bar and
// learned instructions — is memory/agent/practice/agent.md, seeded from agent/practice.md and improved by its own
// retro after every run; its runs are agent/history.md (local, git-ignored). A convention desk (docs/standard.md:
// <desk>/<agent>/<agent>.md). The hosted version runs the same idea in the browser (backend/browser/desk.js) with the kit
// parts a browser can run.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { conventionDesk, MODELS } from "../../companion/team/compose.js"
import { scriptRouter, withShadowFill } from "../../backend/kernel/index.js"

// 2026-10-27 step router in shadow (docs/jepa-router.md): each agent's router learned from its own exported steps
// (`bun scripts/steps.js desks --out memory/agent/router/steps.jsonl`); it records a prediction on every step and,
// for a read-only call with fixed arguments seen ≥ 90% after the same two calls, runs it without a model call. No file: no router.
const STEPS = join(import.meta.dir, "../../memory/agent/router/steps.jsonl")
const SHADOW = join(import.meta.dir, "../../memory/agent/router/shadow.jsonl")
const PORT = Number(process.env.ASKK_PORT ?? 1111)
// the local route in shadow: Apple's on-device model writes a call's input from the thought and tool alone
async function appleFill({ request, thought, tool, examples }) {
  const prompt = `Write the JSON input for one tool call. Reply with the JSON object only.\nTOOL: ${tool}\nEARLIER INPUTS OF THIS TOOL (shape only):\n${examples.slice(-2).map((e) => JSON.stringify(e.input)).join("\n")}\nREQUEST: ${String(request).slice(0, 400)}\nTHOUGHT (what this call must do): ${thought}`
  const res = await fetch(`http://localhost:${PORT}/__askk/llm/apple/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${PORT}` }, body: JSON.stringify({ model: "apple", messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(20000) })
  const text = (await res.json()).choices?.[0]?.message?.content ?? ""
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) } catch { return null }
}
const rows = existsSync(STEPS) ? readFileSync(STEPS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []

export default conventionDesk({
  title: "Agent",
  description: "One capable agent: any request — done itself, with helpers it makes and runs in parallel, or by designing a desk for a standing job; improves its own practice after every run.",
  // the Claude CLI with no --model: whatever the CLI defaults to (owner 2026-10-20: "Switch every model to default")
  models: { ...MODELS, default: { key: "default", label: "Default (Claude CLI)", provider: "claude-cli", id: "default" } },
  defaultModel: "default",
  fallbacks: [],
  maxSteps: 120,
  router: (name) => {
    const own = rows.filter((r) => r.agent === name)
    if (!own.length) return null
    const examples = Object.groupBy(own.filter((r) => r.ok), (r) => r.action)
    return withShadowFill(scriptRouter(own, { act: true }), { fill: appleFill, examples, log: (row) => appendFileSync(SHADOW, JSON.stringify({ agent: name, ...row }) + "\n") })
  },
  // init: before the agent is built, every start — its workspace folders.
  init: async ({ dir }) => {
    for (const folder of ["work", "notes"]) mkdirSync(join(dir, "data", folder), { recursive: true })
  },
})
