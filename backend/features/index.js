// The feature catalogue: every tool and artifact type an agent.md may list.
// Core (core/) defines the contracts and the flow; each feature folder
// implements them and is registered here.
//
//   filesystem/   workspace (OPFS or companion folder), fs.* tools, the
//                 filesystem artifact (tree + open files, fs.open / fs.close)
//   skills/       catalogue of public/skills/ (name + description), the skills
//                 artifact (catalogue + loaded skills, skills.load / skills.unload)
//
// Add a feature: a folder with its Tool specs and/or Artifact subclasses,
// then list them below.

import { Tool } from "@/backend/core/tool"
import { FilesystemArtifact } from "@/backend/features/filesystem/artifact"
import { FS_TOOLS } from "@/backend/features/filesystem/tools"
import { SkillsArtifact } from "@/backend/features/skills/artifact"

// ── artifacts ──────────────────────────────────────────────────────────────

export const ARTIFACTS = {
  [FilesystemArtifact.type]: FilesystemArtifact,
  [SkillsArtifact.type]: SkillsArtifact,
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
  "web.read": {
    description: "Read text from a specified CORS-enabled HTTP resource; this is not web search.",
    inputs: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
}

const TOOL_SPECS = { ...FS_TOOLS, ...PLANNED_TOOLS }

// Every tool name with a known contract (offered when editing an agent).
export const TOOL_NAMES = Object.keys(TOOL_SPECS)

// Build Tool objects for the names an agent declares. Unknown names still get
// a Tool so the agent's configuration stays visible; they fail on invoke().
export function createTools(names = []) {
  return names.map((name) => new Tool({ name, ...(TOOL_SPECS[name] ?? {}) }))
}
