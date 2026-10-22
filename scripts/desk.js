// A convention desk from the command line (docs/standard.md): does it compose?
//
//   bun scripts/desk.js check <desk folder>
//        composes it as the server would (companion/team/compose.js composeDesk, with its main.js's compose options), with a
//        stub model and no host, and prints { name, layout: standard (<lead>/<lead>.md) | legacy (agents/<lead>/agent.md),
//        lead, tree: desk.twin().tree, tools: {agent: [tool names]},
//        templates: {team: its lead and members as agent.spawn {template} names them} }; exit 0, or the reason on
//        stderr and exit 1 (a bad teams/ template fails it too: composeDesk checks them). Nothing runs: no model is
//        called, no tool either.

import { resolve } from "node:path"

import { composeDesk, readDeskConfig } from "../companion/team/compose.js"
import { deskLead } from "../companion/team/layout.js"

const USAGE = "usage: bun scripts/desk.js check <desk folder>"

// A template as the team it spawns: each agent's name (members "<team>-<member>"), what it holds and its lanes.
function team(t, prefix = null) {
  const name = prefix ? `${prefix}-${t.name}` : t.name
  const lanes = Object.fromEntries(["model", "max_steps", "writes", "reads", "board"].filter((k) => t[k] !== undefined).map((k) => [k, t[k]]))
  return { name, ...(prefix ? {} : { goal: t.goal ?? null }), ...lanes, tools: t.tools, artifacts: t.artifacts, members: t.members.map((m) => team(m, name)) }
}

async function main() {
  const [command, dir] = Bun.argv.slice(2)
  if (command !== "check" || !dir) throw new Error(USAGE)
  const folder = resolve(dir)
  const config = await readDeskConfig(folder)
  const c = config.compose ?? {}
  const infer = async () => JSON.stringify({ thought: "check", calls: [], answer: "check only" })
  const desk = await composeDesk({ folder, name: config.name, infer, ...c })
  const tools = Object.fromEntries([...desk.agents().values()].map((a) => [a.name, [...a.tools.keys()]]))
  const templates = Object.fromEntries(Object.entries(desk.ctx.env.templates ?? {}).map(([key, t]) => [key, team(t)]))
  console.log(JSON.stringify({ name: config.name ?? desk.lead.name, layout: deskLead(folder).layout, lead: desk.lead.name, tree: desk.twin().tree, tools, templates }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error.message)
    process.exit(1)
  }
)
