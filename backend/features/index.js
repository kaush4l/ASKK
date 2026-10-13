// The feature catalogue: every tool and artifact type an agent.md may list.
// Core (core/) defines the contracts and the flow; each feature folder
// implements them and is registered here.
//
//   filesystem/   workspace (OPFS or companion folder), fs.* tools, the
//                 filesystem artifact (tree + open files, fs.open / fs.close),
//                 shared artifact (shared/: every file always expanded)
//   skills/       catalogue of public/skills/ (name + description), the skills
//                 artifact (catalogue + loaded skills, skills.load / skills.unload)
//   mcp/          McpTool: each tool of an MCP server in .mcp.json (agent.md
//                 `mcp:`), loaded from the host when the engine starts work
//   schedule/     schedule.wake: book the next run (state/wakes.jsonl)
//   checklist/    the run checklist artifact (THIS RUN + TODAY, checklist.tick / skip)
//   compact/      size caps on working files, kept by compaction (not summaries):
//                 the compact artifact (agent.md `compact:`), intel.compact
//   terminal/     term.run (a desk's programs in the workspace, sandboxed on the
//                 host) and the terminal artifact (the team's last 5 runs)
//   team/         the team artifact: sub-agents this agent creates and ends
//                 (agent.spawn / agent.task / agent.keep / agent.kill,
//                 runtime/spawner.js)
//
// A desk may add artifact types of its own (desk.js `artifacts`, see
// companion/team/desk.js): registerArtifacts() below.
//
// Hardware features (backend/hardware/index.js, e.g. apple.*) are merged in
// from their registry: each entry's tools join the contract on every host,
// marked with the host capability they need; without it they fail with
// "not available here" when called.
//
// `*` in an agent's tools: / artifacts: means every built-in tool (BUILTIN_TOOLS)
// / every artifact (agents/definitions.js expands it).
//
// Add a feature: a folder with its Tool specs and/or Artifact subclasses,
// then list them below.

import { Tool } from "@/backend/core/tool"
import { HARDWARE_TOOLS } from "@/backend/hardware"
import { FilesystemArtifact, SharedArtifact } from "@/backend/features/filesystem/artifact"
import { FS_TOOLS } from "@/backend/features/filesystem/tools"
import { SCHEDULE_TOOLS } from "@/backend/features/schedule/tools"
import { WEB_TOOLS } from "@/backend/features/web/tools"
export { loadMcpTools } from "@/backend/features/mcp/tools"
import { SkillsArtifact } from "@/backend/features/skills/artifact"
import { ChecklistArtifact } from "@/backend/features/checklist/artifact"
import { CompactArtifact } from "@/backend/features/compact/artifact"
import { TerminalArtifact } from "@/backend/features/terminal/artifact"
import { TERMINAL_TOOLS } from "@/backend/features/terminal/tools"
import { TeamArtifact } from "@/backend/features/team/artifact"
import { LIMITS } from "@/lib/config"

// ── artifacts ──────────────────────────────────────────────────────────────

const ARTIFACTS = {
  [FilesystemArtifact.type]: FilesystemArtifact,
  [SharedArtifact.type]: SharedArtifact,
  [SkillsArtifact.type]: SkillsArtifact,
  [ChecklistArtifact.type]: ChecklistArtifact,
  [CompactArtifact.type]: CompactArtifact,
  [TerminalArtifact.type]: TerminalArtifact,
  [TeamArtifact.type]: TeamArtifact,
}

// Artifact types a desk brings (desk.js `artifacts`: modules exporting Artifact
// subclasses), registered by the team worker / headless ask before engines
// start. A built-in type is never replaced.
export function registerArtifacts(types = []) {
  for (const Type of types) {
    if (typeof Type !== "function" || typeof Type.type !== "string" || !Type.type) continue
    if (ARTIFACTS[Type.type] && ARTIFACTS[Type.type] !== Type) throw new Error(`Artifact type "${Type.type}" is already defined.`)
    ARTIFACTS[Type.type] = Type
  }
}

// One artifact per listed type; `saved` holds state by type (artifacts.json).
export function createArtifacts(names = [], { engine, saved = {}, onChange }) {
  return names.map((name) => {
    const Type = ARTIFACTS[name]
    if (!Type) throw new Error(`Unknown artifact "${name}". Known: ${Object.keys(ARTIFACTS).join(", ")}.`)
    return new Type({ engine, state: saved[name] ?? null, onChange })
  })
}

// ── tools ──────────────────────────────────────────────────────────────────

const keySchema = { type: "string", minLength: 1, maxLength: LIMITS.notes.keyChars }

// Declared, not implemented yet: they fail on invoke().
const PLANNED_TOOLS = {
  "notes.read": {
    description: "Read workspace notes; omit key to list all notes.",
    inputs: { type: "object", properties: { key: keySchema }, additionalProperties: false },
  },
  "notes.write": {
    description: "Save one workspace note after human approval.",
    inputs: {
      type: "object",
      properties: { key: keySchema, text: { type: "string", maxLength: LIMITS.notes.textChars } },
      required: ["key", "text"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
  },
}

const BUILTIN_SPECS = { ...FS_TOOLS, ...WEB_TOOLS, ...SCHEDULE_TOOLS, ...HARDWARE_TOOLS, ...TERMINAL_TOOLS }
const TOOL_SPECS = { ...BUILTIN_SPECS, ...PLANNED_TOOLS }

// Every tool name with a known contract (offered when editing an agent).
export const TOOL_NAMES = Object.keys(TOOL_SPECS)

// Every implemented tool (what `tools: ["*"]` gives an agent; planned ones left out).
const BUILTIN_TOOLS = Object.keys(BUILTIN_SPECS)

// A tools: / artifacts: list with "*" replaced by every built-in one (kept
// in order, no duplicates).
export const expandTools = (names = []) => expandStar(names, BUILTIN_TOOLS)
export const expandArtifacts = (names = []) => expandStar(names, Object.keys(ARTIFACTS))
function expandStar(names, all) {
  return names.includes("*") ? [...new Set(names.flatMap((n) => (n === "*" ? all : [n])))] : names
}

// Build Tool objects for the names an agent declares. Unknown names still get
// a Tool so the agent's configuration stays visible; they fail on invoke().
export function createTools(names = []) {
  return names.map((name) => new Tool({ name, ...(TOOL_SPECS[name] ?? {}) }))
}
