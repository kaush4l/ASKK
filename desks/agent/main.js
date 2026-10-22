// agent — the core desk (2026-10-20 owner: "the core desk will now be updated to a single agent and create multiple
// subagents capable tool"): one agent, no fixed team, the kernel's capability kit. Any request: it works it itself, with
// helpers it makes and runs in parallel (agent.spawn / catalog / update / dismiss, dispatch — a helper that earns it is
// kept as agent/<name>/<name>.md), or, when the work is a standing job, by designing a desk for it (desk.create →
// desk.load → desk.ask, written to the local desks folder, custom/). Its practice — the run checklist, quality bar and
// learned instructions — is memory/agent/practice/agent.md, seeded from agent/practice.md and improved by its own
// retro after every run; its runs are agent/history.md (local, git-ignored). A convention desk (docs/standard.md:
// <desk>/<agent>/<agent>.md). The hosted version runs the same idea in the browser (backend/browser/desk.js) with the kit
// parts a browser can run.

import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { conventionDesk, MODELS } from "../../companion/team/compose.js"

export default conventionDesk({
  title: "Agent",
  description: "One capable agent: any request — done itself, with helpers it makes and runs in parallel, or by designing a desk for a standing job; improves its own practice after every run.",
  // the Claude CLI with no --model: whatever the CLI defaults to (owner 2026-10-20: "Switch every model to default")
  models: { ...MODELS, default: { key: "default", label: "Default (Claude CLI)", provider: "claude-cli", id: "default" } },
  defaultModel: "default",
  fallbacks: [],
  maxSteps: 120,
  // init: before the agent is built, every start — its workspace folders.
  init: async ({ dir }) => {
    for (const folder of ["work", "notes"]) mkdirSync(join(dir, "data", folder), { recursive: true })
  },
})
