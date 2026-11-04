// Template agent skin — createSnapshot() / createTemplateAgentSkin().
//
// Given a name, create a template agent skin in the CORRECT memory
// folder, from the abstract templates, without touching soul.md:
//
//   <base>/memory/<name>.agent.md
//   <base>/memory/agent/<name>/state.md   (empty template)
//   <base>/memory/agent/<name>/history.md (empty template)
//   <base>/memory/agent/<name>/snapshots/ (directory)
//   <base>/memory/scripts/<name>/         (directory, for its scripts)
//   <base>/memory/watchers/<name>/        (directory, for its notify scripts)
//
// Soul rule: if <base>/memory/soul.md exists, it is NEVER modified
// by this tool — soul is immutable, no one can change it via a tool.
// If it does not exist, a template soul is created (creation, not a
// change to an existing soul), marked as a template. The agent file
// contains data + metadata only: name, role, goal, tools, lanes,
// keep, version, improvesOn — never soul text, never tool specs,
// never history, never secrets.
//
// Server-side only (Node fs). `baseDir` is the snapshot root
// (personal/ or a test temp dir), so tests never touch the repo.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkAgentName } from "./placement.js";

export const TEMPLATE_SOUL = [
  "Soul: template",
  "",
  "Who this agent is: character, role, north star — separate from",
  "instructions (how it answers). Soul is immutable: no tool can",
  "change it. Only the owner, editing this file outside a run, can.",
  "",
].join("\n");

export function agentFileText({
  name,
  role = "",
  goal = "",
  tools = [],
  keep = "run",
}) {
  return [
    `# Agent: ${name}`,
    "",
    `- name: ${name}`,
    `- role: ${role}`,
    `- goal: ${goal}`,
    `- tools: ${tools.join(", ")}`,
    `- keep: ${keep}`,
    `- version: 1`,
    "",
    "Data and metadata only. Soul is inherited, never copied here.",
    "Tool specs come from the live registry at runtime.",
    "History lives in history.md, state in state.md.",
    "",
  ].join("\n");
}

// Create the skin. Returns {agentFile, memoryDir, soulTouched: false,
// soulCreated: boolean}. Throws on a bad name or an existing agent file
// (a skin is created once; updating it is a different, gated tool).
export function createTemplateAgentSkin({
  name,
  baseDir,
  role,
  goal,
  tools,
  keep,
} = {}) {
  checkAgentName(name);
  if (typeof baseDir !== "string" || baseDir.trim() === "") {
    throw new Error("template skin needs a baseDir");
  }
  const memoryDir = join(baseDir, "memory");
  const agentFile = join(memoryDir, `${name}.agent.md`);
  if (existsSync(agentFile)) {
    throw new Error(`agent skin already exists: memory/${name}.agent.md`);
  }
  const agentMemoryDir = join(memoryDir, "agent", name);
  mkdirSync(join(agentMemoryDir, "snapshots"), { recursive: true });
  mkdirSync(join(memoryDir, "scripts", name), { recursive: true });
  mkdirSync(join(memoryDir, "watchers", name), { recursive: true });
  writeFileSync(
    agentFile,
    agentFileText({
      name,
      role,
      goal,
      tools: tools ?? [],
      keep: keep ?? "run",
    }),
    "utf8",
  );
  const stateFile = join(agentMemoryDir, "state.md");
  const historyFile = join(agentMemoryDir, "history.md");
  if (!existsSync(stateFile)) {
    writeFileSync(
      stateFile,
      `# Live artifact: ${name}\n\n- id: ${name}\n- open: none\n- focus: none\n- modified: none\n`,
      "utf8",
    );
  }
  if (!existsSync(historyFile)) {
    writeFileSync(historyFile, `# History: ${name}\n\n`, "utf8");
  }
  // Soul: never touch an existing soul. Create a template only if absent.
  const soulFile = join(memoryDir, "soul.md");
  let soulCreated = false;
  if (!existsSync(soulFile)) {
    writeFileSync(soulFile, TEMPLATE_SOUL, "utf8");
    soulCreated = true;
  }
  return {
    agentFile: `memory/${name}.agent.md`,
    memoryDir: `memory/agent/${name}`,
    soulTouched: false,
    soulCreated,
  };
}

export function readSoulText(baseDir) {
  const soulFile = join(baseDir, "memory", "soul.md");
  return existsSync(soulFile) ? readFileSync(soulFile, "utf8") : null;
}

// Alias required by the task: createSnapshot() creates a template skin.
// (The run snapshot itself is snapshot.js / snapshot-state.js; this
// function creates the agent skin a snapshot is taken OF.)
export function createSnapshot(options) {
  return createTemplateAgentSkin(options);
}
