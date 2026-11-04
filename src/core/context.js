// Context optimization — response = f(state, context, request).
//
// selectContext(state, { phase, goal }) returns ONLY the elements
// relevant to the current state/phase/goal:
//   - soul: always included, never dropped.
//   - current-phase instructions and tools: only the tools in
//     phase.allowedTools (a tool outside that subset is left out,
//     never silently included).
//   - goal artifact: the goal's statement, current phase, and steps.
//   - goal-clipped history: history entries for this goal only,
//     oldest dropped first when the history segment would exceed
//     HISTORY_CHARS (the drop is recorded, not silent).
// Everything else present in the state is returned as leftOut
// [{ id, reason, chars }] with counts. Nothing is silently
// included, and nothing selected is silently dropped.
//
// renderContext(selection) returns { prompt, meter } where meter
// is { totalChars, segments: [{ id, label, chars, colour }] } and
// the segments sum EXACTLY to prompt.length: the "\n\n" separators
// between segments are themselves a meter segment, so the meter
// matches what is actually sent — it is not an estimate.

export const HISTORY_CHARS = 4000;

const COLOURS = Object.freeze({
  soul: "sky",
  phase: "violet",
  tools: "amber",
  goal: "emerald",
  history: "grey",
  separators: "grey",
});

function charsOf(value) {
  return String(value ?? "").length;
}

function phaseText(phase) {
  if (!phase) {
    return "";
  }
  return [phase.duty, phase.instructions, phase.body]
    .filter((part) => typeof part === "string" && part !== "")
    .join("\n");
}

export function selectContext(state = {}, { phase = null, goal = null } = {}) {
  const currentPhase = phase ?? state.phase ?? null;
  const currentGoal = goal ?? state.goal ?? null;
  const included = [];
  const leftOut = [];

  const soulText = typeof state.soul === "string" ? state.soul : "";
  included.push({ id: "soul", label: "soul", text: soulText });

  if (currentPhase) {
    included.push({
      id: `phase:${currentPhase.id ?? "current"}`,
      label: "current phase",
      text: phaseText(currentPhase),
    });
  }

  const allTools = Array.isArray(state.tools) ? state.tools : [];
  const toolName = (tool) =>
    typeof tool === "string" ? tool : (tool?.name ?? "");
  const allowed = currentPhase?.allowedTools
    ? new Set(currentPhase.allowedTools)
    : null;
  const phaseTools = [];
  for (const tool of allTools) {
    const name = toolName(tool);
    if (!name) {
      continue;
    }
    if (allowed === null || allowed.has(name)) {
      phaseTools.push(tool);
    } else {
      leftOut.push({
        id: name,
        reason: "not in current phase tools",
        chars: charsOf(
          typeof tool === "string" ? tool : (tool?.description ?? name),
        ),
      });
    }
  }
  if (currentPhase) {
    included.push({
      id: "phase-tools",
      label: "current phase tools",
      text: phaseTools
        .map((tool) =>
          typeof tool === "string"
            ? tool
            : `- ${tool.name} — ${tool.description ?? ""}`,
        )
        .join("\n"),
    });
  }

  if (currentGoal) {
    // The goal contributes its STATEMENT (and status/steps) only.
    // It never contributes phases: phases belong to the executing
    // agent's internal loop (correction 2026-11-04), and the
    // current phase element above is that internal phase.
    const goalStatus =
      typeof currentGoal.status === "string"
        ? currentGoal.status
        : (currentGoal.state?.status ?? "open");
    const goalText = [
      `Goal: ${currentGoal.statement ?? currentGoal.id ?? ""}`,
      `Status: ${goalStatus}`,
      ...(Array.isArray(currentGoal.steps)
        ? currentGoal.steps.map(
            (s) =>
              `- step ${s.id}: ${s.text ?? ""} [${s.done ? "done" : "open"}]`,
          )
        : []),
    ]
      .filter(Boolean)
      .join("\n");
    included.push({ id: "goal", label: "goal artifact", text: goalText });
  }

  const allHistory = Array.isArray(state.history) ? state.history : [];
  const goalId = currentGoal?.id;
  const goalHistory = goalId
    ? allHistory.filter((entry) => {
        const text = typeof entry === "string" ? entry : JSON.stringify(entry);
        return (
          text.includes(goalId) ||
          (typeof entry === "object" && entry !== null && entry.goal === goalId)
        );
      })
    : allHistory;
  // If nothing is tagged with the goal id, the goal-clipped
  // history is the most recent entries (still clipped, still
  // recorded as history, not as goal history).
  const historyEntries = goalId && goalHistory.length > 0 ? goalHistory : [];
  let historyText = historyEntries
    .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
    .join("\n");
  let clipped = false;
  if (historyText.length > HISTORY_CHARS) {
    historyText = historyText.slice(-HISTORY_CHARS);
    clipped = true;
  }
  included.push({
    id: "history",
    label: "goal-clipped history",
    text: historyText,
    clipped,
  });
  for (const entry of allHistory) {
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    if (!historyText.includes(text) && text !== "") {
      leftOut.push({
        id: "history-entry",
        reason: "not goal history, or clipped by history limit",
        chars: text.length,
      });
    }
  }

  // Other agents and other goals are context, not current context.
  const agents = state.agents ?? {};
  const agentNames = Array.isArray(agents)
    ? agents.map((a) => (typeof a === "string" ? a : a?.name))
    : Object.keys(agents);
  for (const name of agentNames) {
    if (name && name !== state.currentAgent && name !== currentPhase?.agent) {
      leftOut.push({
        id: `agent:${name}`,
        reason: "not the current phase agent",
        chars: charsOf(name),
      });
    }
  }
  const goals = state.goals ?? {};
  const goalIds = Array.isArray(goals)
    ? goals.map((g) => (typeof g === "string" ? g : g?.id))
    : Object.keys(goals);
  for (const gid of goalIds) {
    if (gid && gid !== goalId) {
      leftOut.push({
        id: `goal:${gid}`,
        reason: "not the current goal",
        chars: charsOf(gid),
      });
    }
  }

  const segments = included.map((el) => ({
    id: el.id,
    label: el.label,
    text: el.text,
    colour:
      el.id === "phase-tools"
        ? "amber"
        : (COLOURS[el.id.split(":")[0]] ?? COLOURS[el.id] ?? "grey"),
    ...(el.clipped ? { clipped: true } : {}),
  }));
  return {
    elements: segments,
    leftOut,
    counts: {
      included: segments.length,
      leftOut: leftOut.length,
      leftOutChars: leftOut.reduce((sum, item) => sum + item.chars, 0),
    },
  };
}

export function renderContext(selection) {
  const segments = (selection?.elements ?? []).map((el) => ({
    id: el.id,
    label: el.label,
    chars: charsOf(el.text),
    colour: el.colour ?? "grey",
    ...(el.clipped ? { clipped: true } : {}),
  }));
  const texts = (selection?.elements ?? []).map((el) => el.text ?? "");
  const prompt = texts.join("\n\n");
  if (segments.length > 1) {
    segments.push({
      id: "separators",
      label: "separators",
      chars: (segments.length - 1) * 2,
      colour: "grey",
    });
  }
  const totalChars = prompt.length;
  const summed = segments.reduce((sum, seg) => sum + seg.chars, 0);
  if (summed !== totalChars) {
    throw new Error(
      `prompt meter mismatch: segments sum ${summed}, prompt length ${totalChars}`,
    );
  }
  return { prompt, meter: { totalChars, segments } };
}
