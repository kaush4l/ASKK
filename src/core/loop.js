// Loop — the agent loop. ReAct is the INNER loop inside a phase;
// the phase graph (harness.js) is the outer loop, enforced by code.
//
// runLoop({ registry, inference, prompt, phase, goal, ... }):
//   - Parses TOON replies by default (src/core/toon.js).
//   - Runs ONE stage of tool calls in parallel via Promise.all:
//     every call in a stage is independent by construction. A call
//     whose input references another call in the SAME stage with
//     "$result.<name>" is NOT run in that stage: it is deferred to
//     the next stage, after the referenced result exists, with the
//     placeholder substituted. Sequential execution happens ONLY
//     where a call depends on a previous result — that is the rule.
//   - stop() at the next step boundary: createStopSignal() returns
//     { stopped, stop() }; the loop checks it before each step and
//     after each stage, and then returns { stopped: true }.
//   - maxSteps 12 by default (a stage counts as one step).
//   - Compaction: when the prompt chars reach >=90% of the model
//     ctx length, older steps are folded into ONE summary step
//     (the supplied summariser, else a clipped fallback labelled
//     as clipped, never invented), the last 2 steps are kept, and
//     the compaction is recorded in history.
//   - Checks gate: runState tracks files modified in this run and
//     whether a test/build terminal.run succeeded. If
//     requireChecks and files were modified and no check passed,
//     the loop REFUSES the final answer and reports the failed
//     check instead of answering — a file is never left unchecked.
//   - The single-turn chat in engine.js is untouched: this loop
//     lives in new files, and chat() still does exactly one call.
//
// Registry: a Tool array, a createToolRegistry() object, or any
// object with run(name, input) / get(name). Inference: an object
// with infer(messages) returning a reply string (a mocked model
// in tests; a real inference in production). No real model, no
// real CLI is created here — both arrive through those arguments.

import { parseReply } from "./toon.js";

// Slice B — goal delivery (artifact twin snapshot as the goal
// element). runLoop used to drop the goal it was passed
// (element-mapping mistake #2): the harness passed
// goal.snapshot() but runLoop never read it, so the executing
// agent saw only the raw owner request. Now, when opts.goal
// (kernel artifact, delivered object, or plain snapshot) or
// opts.goalElement is given, runLoop adds the goal element as
// its own system message, read LIVE at call time — a kernel
// artifact's snapshot() is called here, per run, so steps /
// phase / evidence added since the last phase are visible in
// the next phase's prompt, with no refetch and no new goal
// object. The element carries no history transcript.
export function formatGoalElement(goal) {
  if (typeof goal === "string") {
    return goal;
  }
  if (goal && typeof goal.element === "string") {
    return goal.element;
  }
  let snapshot = null;
  if (goal && typeof goal.snapshot === "function") {
    snapshot = goal.snapshot();
  } else if (goal && typeof goal.snapshot === "object" && goal.snapshot !== null) {
    snapshot = goal.snapshot;
  } else if (goal && typeof goal === "object") {
    snapshot = goal;
  }
  if (!snapshot || typeof snapshot.statement !== "string") {
    return null;
  }
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const done = steps.filter((s) => s.done).length;
  const lines = [
    `Goal (artifact twin, artifactKind: goal):`,
    `- id: ${snapshot.id ?? ""}`,
    `- statement: ${snapshot.statement}`,
    `- status: ${snapshot.status ?? ""}`,
    `- phase: ${snapshot.phase ?? "none"}`,
    `- attempts: ${typeof snapshot.attempts === "number" ? snapshot.attempts : 0}`,
    `- steps: ${done} of ${steps.length} done`,
  ];
  for (const step of steps) {
    lines.push(`  - [${step.done ? "x" : " "}] ${step.id}: ${step.text ?? ""}`);
  }
  const list = (label, values) => {
    if (!Array.isArray(values) || values.length === 0) {
      lines.push(`- ${label}: none`);
      return;
    }
    lines.push(`- ${label}:`);
    for (const value of values) {
      lines.push(
        `  - ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
    }
  };
  list("evidence", snapshot.evidence);
  list("decisions", snapshot.decisions);
  list("open questions", snapshot.openQuestions);
  if (snapshot.folder?.root) {
    lines.push(`- folder root: ${snapshot.folder.root}`);
  }
  if (snapshot.report) {
    lines.push(`- report: ${snapshot.report}`);
  }
  return lines.join("\n");
}

export const MAX_STEPS = 12;
export const COMPACTION_THRESHOLD = 0.9;

// Owner guidance channel — the "guide" side of the typing-icon
// UI. guide(text) holds guidance for exactly ONE next step;
// take() returns it and consumes it, so guidance sent mid-run
// is seen at the next step and never repeated. The loop records
// consumed guidance in its history. A channel with nothing
// pending returns null from take() and peek().
export function createGuidanceChannel() {
  let pending = null;
  return {
    guide: (text) => {
      if (typeof text !== "string" || text.trim() === "") {
        throw new Error("guide needs guidance text");
      }
      pending = text;
      return pending;
    },
    take: () => {
      const text = pending;
      pending = null;
      return text;
    },
    peek: () => pending,
  };
}

export function createStopSignal() {
  const signal = { stopped: false };
  signal.stop = () => {
    signal.stopped = true;
  };
  return signal;
}

function normalizeRegistry(registry) {
  if (Array.isArray(registry)) {
    const byName = new Map(registry.map((t) => [t.name, t]));
    return {
      list: () => [...registry],
      get: (name) => byName.get(name) ?? null,
      run: async (name, input) => {
        const tool = byName.get(name);
        if (!tool) {
          throw new Error(`no tool named ${name}`);
        }
        return tool.run(input);
      },
    };
  }
  if (registry && typeof registry.run === "function") {
    return registry;
  }
  if (registry && typeof registry.get === "function") {
    return {
      list: () => registry.list?.() ?? [],
      get: (name) => registry.get(name),
      run: async (name, input) => registry.get(name).run(input),
    };
  }
  throw new Error("loop needs a tool registry (array or registry object)");
}

function toolNamesOf(registry) {
  try {
    return (registry.list?.() ?? []).map((t) =>
      typeof t === "string" ? t : t.name,
    );
  } catch {
    return [];
  }
}

function promptChars(messages) {
  return messages
    .map(
      (m) =>
        `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")}`,
    )
    .join("\n").length;
}

function resultPlaceholder(name) {
  return `$result.${name}`;
}

function hasDependency(input, stageNames) {
  const text = JSON.stringify(input ?? {});
  return stageNames.some((name) => text.includes(resultPlaceholder(name)));
}

function substituteResults(input, resultsByName) {
  let text = JSON.stringify(input ?? {});
  for (const [name, result] of Object.entries(resultsByName)) {
    text = text
      .split(resultPlaceholder(name))
      .join(typeof result === "string" ? result : JSON.stringify(result ?? ""));
  }
  try {
    return JSON.parse(text);
  } catch {
    return input;
  }
}

export async function runLoop({
  registry,
  inference,
  prompt = "",
  phase = null,
  goal = null,
  goalElement = null,
  maxSteps = MAX_STEPS,
  ctxLength = null,
  summarise = null,
  onEvent = null,
  signal = null,
  live = null,
  requireChecks = false,
  runState = null,
  guidance = null,
} = {}) {
  if (!inference || typeof inference.infer !== "function") {
    throw new Error("loop needs an inference with infer(messages)");
  }
  const tools = normalizeRegistry(registry);
  const state = runState ?? { modified: [], checksPassed: false };
  if (!Array.isArray(state.modified)) {
    state.modified = [];
  }
  // Goal delivery: the artifact twin's snapshot, as its own
  // system message, before the phase instructions — so the
  // executing agent receives the goal (kernel + twin snapshot),
  // not just the raw owner request. Read live here, per run.
  const deliveredGoalElement =
    typeof goalElement === "string" && goalElement !== ""
      ? goalElement
      : goal
        ? formatGoalElement(goal)
        : null;
  const messages = [
    { role: "system", content: prompt },
    ...(deliveredGoalElement
      ? [{ role: "system", content: deliveredGoalElement }]
      : []),
    ...(phase?.instructions
      ? [
          {
            role: "system",
            content: `Phase ${phase.id}: ${phase.duty ?? ""}\n${phase.instructions}`,
          },
        ]
      : []),
  ];
  // Results by tool name, kept across steps: a call deferred from
  // one stage substitutes the earlier stage's result on the next.
  const resultsByName = {};
  const calls = [];
  const history = [];
  let compactions = 0;
  let pending = [];
  let step = 0;
  let finalAnswer = null;
  let refused = false;
  let failedCheck = null;

  const emit = (type, detail) => {
    if (typeof onEvent === "function") {
      onEvent(type, detail);
    }
    if (live && typeof live.emit === "function") {
      try {
        live.emit(type, detail);
      } catch {
        // Live events are best-effort here; the loop result is authoritative.
      }
    }
  };

  const compactIfNeeded = async () => {
    if (
      !ctxLength ||
      promptChars(messages) < COMPACTION_THRESHOLD * ctxLength
    ) {
      return;
    }
    // Keep the system prompt(s) + last 2 steps; fold the rest.
    const system = messages.filter((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    if (rest.length <= 2) {
      return;
    }
    const folded = rest.slice(0, -2);
    const kept = rest.slice(-2);
    let summary;
    if (typeof summarise === "function") {
      summary = await summarise(folded);
    } else {
      const clipped = folded
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n")
        .slice(0, 500);
      summary = `[compacted summary — clipped, not invented: ${folded.length} steps folded]\n${clipped}`;
    }
    messages.length = 0;
    messages.push(...system, { role: "system", content: summary }, ...kept);
    compactions += 1;
    const record = `compaction: folded ${folded.length} steps, kept last 2`;
    history.push(record);
    if (live && typeof live.appendHistory === "function") {
      live.appendHistory(record);
    }
    emit("compaction", { folded: folded.length, kept: 2 });
  };

  while (step < maxSteps) {
    if (signal?.stopped) {
      break;
    }
    await compactIfNeeded();
    step += 1;
    // Owner guidance, consumed exactly once: held guidance is
    // injected as a system message at this step's start, recorded
    // in history, and never re-injected at a later step, because
    // take() clears it. Guidance received after this check waits
    // for the next step's check.
    if (guidance && typeof guidance.take === "function") {
      const guided = guidance.take();
      if (guided !== null && guided !== undefined) {
        const guidanceMessage = {
          role: "system",
          content: `Owner guidance: ${guided}`,
        };
        messages.push(guidanceMessage);
        history.push(`guidance: ${guided}`);
        if (live && typeof live.appendHistory === "function") {
          live.appendHistory(`guidance: ${guided}`);
        }
        emit("guidance", { step, text: guided });
      }
    }
    emit("llm:start", { step, phase: phase?.id ?? null });
    const replyText = await inference.infer(messages);
    emit("llm:end", { step });
    const parsed = parseReply(replyText);
    const stageCalls = [...pending, ...parsed.calls];
    pending = [];
    if (stageCalls.length === 0) {
      finalAnswer = parsed.answer || parsed.thought || "";
      break;
    }
    const stageNames = stageCalls.map((c) => c.name);
    const ready = [];
    const deferred = [];
    for (const call of stageCalls) {
      // A call depending on another call in this same stage waits.
      const others = stageNames.filter((n) => n !== call.name);
      if (hasDependency(call.input, others)) {
        deferred.push(call);
      } else {
        ready.push(call);
      }
    }
    pending = deferred;
    if (ready.length === 0 && deferred.length > 0) {
      // Every call in the stage depends on another in the stage:
      // run them sequentially in order instead of deadlocking.
      ready.push(...deferred.splice(0, 1));
      pending = deferred;
    }
    const group = `stage-${step}`;
    const settled = await Promise.all(
      ready.map(async (call, index) => {
        const id = `call-${step}-${index + 1}`;
        const startedAt = Date.now();
        const liveCall = live?.addCall
          ? live.addCall({
              id,
              name: call.name,
              status: "running",
              parallelGroup: group,
              startedAt,
            })
          : null;
        emit("tool:start", { id, name: call.name, group });
        try {
          const input = substituteResults(call.input, resultsByName);
          const result = await tools.run(call.name, input);
          const endedAt = Date.now();
          if (liveCall && live?.updateCall) {
            live.updateCall(id, {
              status: "done",
              endedAt,
              partial: Boolean(result?.partial),
            });
          }
          emit("tool:end", { id, name: call.name, group });
          if (
            call.name === "files.write" ||
            call.name === "files.edit" ||
            call.name === "files.append"
          ) {
            state.modified.push(call.input?.path ?? call.name);
          }
          if (
            call.name === "terminal.run" &&
            /test|build/i.test(String(call.input?.command ?? ""))
          ) {
            const exit = result?.exit;
            if (exit === 0 || exit === undefined) {
              state.checksPassed = true;
            }
          }
          resultsByName[call.name] = result;
          return { call, id, result, status: "done", startedAt, endedAt };
        } catch (error) {
          const endedAt = Date.now();
          if (liveCall && live?.updateCall) {
            live.updateCall(id, { status: "failed", endedAt });
          }
          emit("tool:error", { id, name: call.name, error: error.message });
          return {
            call,
            id,
            result: null,
            status: "failed",
            error: error.message,
            startedAt,
            endedAt,
          };
        }
      }),
    );
    for (const entry of settled) {
      calls.push(entry);
      messages.push({
        role: "tool",
        content: `call ${entry.call.name} -> ${entry.status}: ${typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result ?? entry.error ?? "")}`,
      });
    }
    if (parsed.thought) {
      messages.push({
        role: "assistant",
        content: `thought: ${parsed.thought}`,
      });
    }
    if (signal?.stopped) {
      break;
    }
    // A deferred stage still counts as progress: the loop iterates
    // again, so deferred calls run with dependencies resolved.
  }

  if (
    finalAnswer !== null &&
    requireChecks &&
    state.modified.length > 0 &&
    !state.checksPassed
  ) {
    refused = true;
    failedCheck = {
      name: "dev checks",
      reason: `${state.modified.length} file(s) modified with no passing test/build run in this run`,
      modified: [...state.modified],
    };
    finalAnswer = null;
  }

  return {
    answer: finalAnswer,
    refused,
    failedCheck,
    calls,
    steps: step,
    stopped: Boolean(signal?.stopped),
    maxStepsReached: step >= maxSteps && finalAnswer === null && !refused,
    compactions,
    history,
    runState: state,
    toolsAvailable: toolNamesOf(tools),
    goalElement: deliveredGoalElement,
  };
}

// Run one phase through the loop: the registry is narrowed to the
// phase's allowedTools before the loop ever sees it, so a phase
// cannot call a tool it was not given — enforcement is in code,
// not in prose. Returns the loop result plus the phase id.
// Slice B: opts.goal / opts.goalElement are forwarded untouched
// to runLoop, which renders the goal element live per run (see
// formatGoalElement above) — runPhase does not snapshot the goal
// itself, so a stale snapshot can never be delivered.
export async function runPhase(phase, opts = {}) {
  if (!phase || typeof phase.id !== "string") {
    throw new Error("runPhase needs a phase with an id");
  }
  const all = normalizeRegistry(opts.registry);
  const allowed = new Set(phase.allowedTools ?? []);
  // Goal tools (goal.*) are always available to the goal's agent:
  // they change the goal, they are not phase tools. Everything else
  // is narrowed to the phase's allowedTools.
  const subset = (all.list?.() ?? []).filter((tool) => {
    const name = typeof tool === "string" ? tool : tool.name;
    return allowed.has(name) || name.startsWith("goal.");
  });
  const prompt = [
    opts.prompt ?? "",
    `Phase: ${phase.id} — ${phase.duty ?? ""}`,
    phase.instructions ? phase.instructions : "",
    phase.body ? phase.body : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    phase: phase.id,
    ...(await runLoop({ ...opts, registry: subset, prompt, phase })),
  };
}
