// The inbuilt kit attached by name (docs/standard.md "Attach by name"): no tools/ folder, no artifact types of its
// own — every tool and artifact its agents list comes from backend/kernel/builtin (2026-10-17). teams/probe: one team
// template (a lead and two members) the lead spawns with agent.spawn {template: "probe"} (2026-10-17).
import { conventionDesk } from "../../compose.js"

export default conventionDesk({ title: "Kit desk", description: "Attach by name: files, terminal, preview, plan, web, spawn." })
