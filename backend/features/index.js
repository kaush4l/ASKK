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
//   apple/        apple.* tools: the owner's Mac (Shortcuts, speech, clipboard,
//                 Spotlight, Reminders, …) through the host API, with approval
//
// Add a feature: a folder with its Tool specs and/or Artifact subclasses,
// then list them below.

import { Tool } from "@/backend/core/tool"
import { APPLE_TOOLS } from "@/backend/features/apple/tools"
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

// ── artifacts ──────────────────────────────────────────────────────────────

export const ARTIFACTS = {
  [FilesystemArtifact.type]: FilesystemArtifact,
  [SharedArtifact.type]: SharedArtifact,
  [SkillsArtifact.type]: SkillsArtifact,
  [ChecklistArtifact.type]: ChecklistArtifact,
  [CompactArtifact.type]: CompactArtifact,
  [TerminalArtifact.type]: TerminalArtifact,
  [TeamArtifact.type]: TeamArtifact,
}

export const ARTIFACT_NAMES = Object.keys(ARTIFACTS)

// One artifact per listed type; `saved` holds state by type (artifacts.json).
export function createArtifacts(names = [], { engine, saved = {}, onChange }) {
  return names.map((name) => {
    const Type = ARTIFACTS[name]
    if (!Type) throw new Error(`Unknown artifact "${name}". Known: ${ARTIFACT_NAMES.join(", ")}.`)
    return new Type({ engine, state: saved[name] ?? null, onChange })
  })
}

// ── tools ──────────────────────────────────────────────────────────────────

const keySchema = { type: "string", minLength: 1, maxLength: 80 }

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
      properties: { key: keySchema, text: { type: "string", maxLength: 20000 } },
      required: ["key", "text"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
  },
}

const TOOL_SPECS = { ...FS_TOOLS, ...WEB_TOOLS, ...SCHEDULE_TOOLS, ...APPLE_TOOLS, ...TERMINAL_TOOLS, ...PLANNED_TOOLS }

// Every tool name with a known contract (offered when editing an agent).
export const TOOL_NAMES = Object.keys(TOOL_SPECS)

// Build Tool objects for the names an agent declares. Unknown names still get
// a Tool so the agent's configuration stays visible; they fail on invoke().
export function createTools(names = []) {
  return names.map((name) => new Tool({ name, ...(TOOL_SPECS[name] ?? {}) }))
}
