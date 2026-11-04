// Skills as a phase — a skill IS a phase object.
//
// A skill definition is markdown with frontmatter-like fields
// (the same "- key: value" lines used by <name>.agent.md), then a
// body of instructions:
//
//   - id: review
//   - duty: review a change without editing it
//   - allowedTools: files.read, files.list, files.search
//   - exitGate: none
//   - onFail: report, do not apply
//
// loadSkillPhase() reads shared first, then agent-specific
// (agent-specific wins on the same name, same rule as scripts
// and watchers in placement.js), from memory/skills/ under the
// personal desk folder first, then the public defaults templates.
// The loop runs the returned phase exactly like any other phase:
// { id, duty, inputs, outputs, allowedTools, entryGate, exitGate,
// handoff, agent, onFail, onSuccess }. No skill behaviour is
// invented: a field that is absent stays absent, and a gate that
// is absent is not a gate.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function parseSkill(text, fallbackId = "") {
  const lines = String(text ?? "").split(/\r?\n/);
  const fields = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      bodyStart = i + 1;
      break;
    }
    const match = line.match(/^-?\s*([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/);
    if (!match) {
      bodyStart = i;
      break;
    }
    fields[match[1]] = match[2].trim();
    bodyStart = i + 1;
  }
  const splitList = (value) =>
    String(value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  const gate = (value) => {
    if (value === undefined || value === "" || value === "none") {
      return null;
    }
    if (value === "passed" || value === "true") {
      return { passed: true, description: value };
    }
    return { passed: null, description: value };
  };
  return {
    id: fields.id ?? fields.name ?? fallbackId,
    duty: fields.duty ?? "",
    inputs: splitList(fields.inputs),
    outputs: splitList(fields.outputs),
    allowedTools: splitList(fields.allowedTools),
    entryGate: gate(fields.entryGate),
    exitGate: gate(fields.exitGate),
    handoff: null,
    agent: fields.agent ?? null,
    onFail: fields.onFail ?? null,
    onSuccess: fields.onSuccess ?? null,
    body: lines.slice(bodyStart).join("\n").trim(),
    fields,
  };
}

// A gate passes when: there is no gate, it is boolean true, its
// passed field is true, or its function returns true for the
// evidence. Anything else does not pass — it never defaults to
// passing on an unreadable gate.
export function gatePassed(gate, evidence = null) {
  if (gate === null || gate === undefined) {
    return true;
  }
  if (typeof gate === "boolean") {
    return gate;
  }
  if (typeof gate === "function") {
    return Boolean(gate(evidence));
  }
  if (typeof gate.passed === "boolean") {
    return gate.passed;
  }
  return false;
}

function skillCandidates(personalDir, defaultsDir, agent, skillName) {
  const base = skillName.endsWith(".skill.md")
    ? skillName
    : `${skillName}.skill.md`;
  // Ascending priority (last found wins): defaults shared, then
  // defaults agent, then personal shared, then personal agent.
  const dirs = [];
  if (defaultsDir) {
    dirs.push(join(defaultsDir, "memory", "skills", "shared"));
    if (agent) {
      dirs.push(join(defaultsDir, "memory", "skills", agent));
    }
  }
  if (personalDir) {
    dirs.push(join(personalDir, "memory", "skills", "shared"));
    if (agent) {
      dirs.push(join(personalDir, "memory", "skills", agent));
    }
  }
  return dirs.map((dir) => ({ path: join(dir, base), dir }));
}

export function loadSkillPhase(input = {}, skillName, opts = {}) {
  const name = skillName ?? opts.skill ?? input.skill;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("loadSkillPhase needs a skill name");
  }
  const agent = opts.agent ?? input.agent ?? null;
  // input may be a desk (location = personal dir) or explicit dirs.
  const personalDir =
    opts.personalDir ??
    input.personalDir ??
    (typeof input.location === "string" ? input.location : null);
  const defaultsDir =
    opts.defaultsDir ??
    input.defaultsDir ??
    (typeof input.defaultsDir === "string" ? input.defaultsDir : null);
  const resolvedPersonal = personalDir
    ? isAbsolute(personalDir)
      ? personalDir
      : join(process.cwd(), personalDir)
    : null;
  const resolvedDefaults = defaultsDir
    ? isAbsolute(defaultsDir)
      ? defaultsDir
      : join(process.cwd(), defaultsDir)
    : join(process.cwd(), "public/defaults");
  // Shared first, agent-specific wins: later candidates override
  // earlier ones on the same skill name, so collect in order and
  // keep the LAST file found (agent-specific, personal first).
  let found = null;
  for (const candidate of skillCandidates(
    resolvedPersonal,
    resolvedDefaults,
    agent,
    name.trim(),
  )) {
    if (existsSync(candidate.path)) {
      found = {
        text: readFileSync(candidate.path, "utf8"),
        source: candidate.path,
      };
    }
  }
  if (!found) {
    throw new Error(`no skill definition found for ${name}`);
  }
  const parsed = parseSkill(found.text, name.replace(/\.skill\.md$/, ""));
  return {
    ...parsed,
    kind: "skill-phase",
    source: found.source,
    // The loop reads phase.instructions; the skill body is it.
    instructions: parsed.body,
  };
}
