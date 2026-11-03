// Agent — skeleton of the old ASKK loop, retold, not copied.
//
// What an agent was in the old system (backend/kernel/agent/agent.js):
// a configurable ReAct loop. ask(request) renders a prompt, calls the model
// (infer, injected — never a bundled model), parses the reply into a thought
// plus tool calls or a final answer, runs one step's calls in parallel, feeds
// the results back into the next prompt, and repeats until it answers, is
// stopped, or runs out of steps. The core desk ran that loop with maxSteps
// 120; the kernel default was 12.
//
// Prompt order, kept from the old render():
//   soul -> # YOU ARE <name> + role -> # TOOLS -> artifacts (latest state)
//   -> # REQUEST -> # OWNER GUIDANCE (shown once) -> # EARLIER RUNS
//   -> # WORK DONE ON THIS REQUEST -> # RESPONSE (the reply format, last)
//
// This file is a skeleton on purpose. Everything marked TODO below is a
// real gap, not behaviour faked to look finished:
//   - full TOON reply parsing (old backend/kernel/agent/reply.js) — JSON and
//     plain-text replies work; a field-style reply is parsed only for the
//     simple thought:/call:/answer: shape, and anything else is a format
//     refusal step, exactly as the old loop treated a reply with no calls
//     and no answer.
//   - prompt compaction, prompt budgeting, image carrying, step router —
//     the old loop folded old steps when the prompt neared its budget;
//     this skeleton sends the whole prompt every step.
//   - report-format checking — the old loop refused answers missing report
//     fields; here gates() only runs artifact gates and minCalls.
//   - chat() — the old agent could answer the owner in one model call
//     without starting or changing a run; that is not built yet.
//   - letters — the old agent's inbox held requests waiting behind the run
//     in progress. A letter (a structured inbox message with a kind, not
//     just text) is not a type yet; inbox entries here are plain requests.
//   - supervision digests — a run's supervision summary is not built yet.
//
// No LangChain, CrewAI, or any external agent library is used, and no
// model is bundled: infer(prompt, agent, { signal }) is injected by the
// caller, so this loop can be tested with a fake model (see agent.test.js).

// The reply format, in the old shape: one thought line, then calls, or a
// final answer alone. A call's input fields follow its `call:` line as
// `field: value` lines, or a `<<< ... >>>` block for a long value.
export const RESPONSE_FORMAT = `Reply in fields, one per line — no JSON object, no code fences:
thought: one line
then calls — every tool under # TOOLS is yours; results come back next prompt under # WORK DONE ON THIS REQUEST:
call: <tool name>
<input field>: <value>
or, when the work is done (no calls), the answer:
answer: <<<
<your report>
>>>
Answer from tool results, never from the request's numbers alone.`;

// A tool: the one contract for anything an agent can call — a function, or
// another agent (see AgentTool below). `type` is "function", "agent", or
// "artifact" (a command that only changes an artifact the agent holds).
export class Tool {
  constructor({ name, description = "", input = {}, run, type = "function" }) {
    if (!name) throw new Error("tool needs a name");
    if (typeof run !== "function")
      throw new Error(`${name}: tool needs run(input, ctx)`);
    this.name = name;
    this.description = description;
    this.input = input;
    this.type = type;
    this._run = run;
  }

  describe() {
    const fields = Object.entries(this.input)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return `- ${this.name} {${fields}} — ${this.description}`;
  }

  async run(input, ctx) {
    return this._run(input ?? {}, ctx);
  }
}

// Another agent as a tool: the call hands it a quest, and the result is
// its report. A quest is a brief, not a one-liner — requirement (situation
// and limits), ask (questions whose answers change the decision), outcome
// (what the report must deliver to count as done). Refused without all three,
// as in the old kernel: an agent handed a bare goal guesses what done means.
export function questText(input) {
  const q = input ?? {};
  const missing = ["requirement", "ask", "outcome"].filter(
    (k) => !String(q[k] ?? "").trim(),
  );
  if (missing.length) {
    throw new Error(`a quest needs ${missing.join(", ")}`);
  }
  return `REQUIREMENT: ${q.requirement}\nASK: ${q.ask}\nOUTCOME: ${q.outcome}`;
}

export class AgentTool extends Tool {
  constructor(agent) {
    super({
      name: agent.name,
      type: "agent",
      description: agent.config.description ?? agent.config.role ?? "",
      input: {
        requirement: "the situation and limits",
        ask: "the questions whose answers change your decision",
        outcome: "what the report must deliver to count as done",
      },
      run: (input, ctx) =>
        agent.ask(questText(input), {
          from: ctx.agent?.name ?? "caller",
          signal: ctx.signal,
        }),
    });
    this.agent = agent;
  }
}

// Parse a model reply into { thought, calls: [{ tool, input }], answer }.
// Supported, in order:
//   1. A JSON object: { thought, calls, answer } — the old parser's fallback.
//   2. Plain text with no field lines: the whole text is the answer.
//   3. Field lines: thought: …, then call: <tool> with `field: value` lines
//      (or a <<< >>> block) until the next call:/answer:, then answer: <<<
//      … >>> or the rest of the text. Anything else yields no calls and no
//      answer, which the loop treats as a format refusal step.
// TODO: the old parser's full TOON value rules (lists, nested key: value
// items, one-line ` · ` joins) are not implemented here.
export function parseReply(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { thought: "", calls: [], answer: null };
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      return {
        thought: parsed.thought ?? "",
        calls: Array.isArray(parsed.calls) ? parsed.calls : [],
        answer: parsed.answer ?? null,
      };
    } catch {
      // Not JSON after all: fall through to field/plain-text parsing.
    }
  }
  const lines = text.split("\n");
  const hasFields = lines.some((l) =>
    /^(thought|call|answer)\s*:/.test(l.trim()),
  );
  if (!hasFields) return { thought: "", calls: [], answer: text };
  let thought = "";
  let answer = null;
  const calls = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(/^(thought|call|answer)\s*:\s*(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }
    const [, key, value] = match;
    if (key === "thought") {
      thought = value;
      i += 1;
    } else if (key === "call") {
      const call = { tool: value.trim(), input: {} };
      i += 1;
      while (i < lines.length) {
        const fieldLine = lines[i].trim();
        if (/^(thought|call|answer)\s*:/.test(fieldLine)) break;
        const field = fieldLine.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
        if (field) {
          const [, fieldName, fieldValue] = field;
          if (fieldValue.trim() === "<<<") {
            const block = [];
            i += 1;
            while (i < lines.length && lines[i].trim() !== ">>>") {
              block.push(lines[i]);
              i += 1;
            }
            call.input[fieldName] = block.join("\n");
          } else {
            call.input[fieldName] = fieldValue;
          }
        }
        i += 1;
      }
      calls.push(call);
    } else {
      // answer: the rest, unwrapped from <<< >>> when present.
      const rest = lines.slice(i + 1);
      const body = value.trim() === "<<<" ? rest : [value, ...rest];
      const end = body.findIndex((l) => l.trim() === ">>>");
      answer = (end >= 0 ? body.slice(0, end) : body).join("\n").trim();
      break;
    }
  }
  return { thought, calls, answer };
}

export class Agent {
  constructor(
    config,
    { infer, tools = [], artifacts = [], context = {} } = {},
  ) {
    if (!config?.name) throw new Error("agent needs a name");
    if (typeof infer !== "function") {
      throw new Error(`${config.name}: needs infer(prompt, agent, options)`);
    }
    this.name = config.name;
    // maxSteps 12 is the old kernel default; the core desk used 120.
    this.config = { maxSteps: 12, historyKeep: 3, gateRetries: 2, ...config };
    this.infer = infer;
    this.tools = new Map();
    this.artifacts = [];
    this.history = []; // finished runs: { from, request, answer }
    this.guidance = []; // notes for the run in progress, shown once
    this.current = null; // the run in progress: { request, steps }
    this.inbox = []; // requests waiting behind the run in progress
    this.listeners = new Map();
    this.status = "idle";
    this.context = context;
    this.stopped = false;
    this.queue = Promise.resolve();
    for (const tool of tools) this.addTool(tool);
    for (const artifact of artifacts) this.addArtifact(artifact);
  }

  addTool(tool) {
    const t = tool instanceof Agent ? new AgentTool(tool) : tool;
    if (this.tools.has(t.name)) {
      throw new Error(`${this.name}: tool ${t.name} twice`);
    }
    this.tools.set(t.name, t);
    return this;
  }

  // An artifact is state the agent keeps beside its conversation and that
  // renders into every prompt as its latest state only. It may provide:
  //   id, render(agent) -> string, gate(agent, answer) -> reason | null,
  //   commands() -> tools that change it, onRunStart(agent, request),
  //   refresh(agent) -> awaited before each step's render (TODO: refresh
  //   failures are not yet recorded as one line in the artifact's block,
  //   as the old loop did — a failing refresh currently throws).
  addArtifact(artifact) {
    if (!artifact?.id || typeof artifact.render !== "function") {
      throw new Error(`${this.name}: artifact needs id and render(agent)`);
    }
    this.artifacts.push(artifact);
    for (const tool of artifact.commands?.() ?? []) {
      const command = { ...tool, type: "artifact" };
      this.addTool(command);
    }
    return this;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, data) {
    const payload = { agent: this.name, event, at: Date.now(), ...data };
    for (const fn of [
      ...(this.listeners.get(event) ?? []),
      ...(this.listeners.get("*") ?? []),
    ]) {
      try {
        fn(payload);
      } catch {
        // A listener that throws is its own fault and never the run's,
        // as in the old loop — counted, never silent, never fatal here.
        this.listenerErrors = (this.listenerErrors ?? 0) + 1;
      }
    }
  }

  render(request, steps) {
    const parts = [];
    if (this.config.soul) parts.push(this.config.soul);
    parts.push(
      `# YOU ARE ${this.name}${this.config.role ? `\n${this.config.role}` : ""}`,
    );
    if (this.tools.size) {
      parts.push(
        `# TOOLS\n${[...this.tools.values()].map((t) => t.describe()).join("\n")}`,
      );
    }
    for (const artifact of this.artifacts) {
      parts.push(`# ${artifact.id}\n${artifact.render(this)}`);
    }
    parts.push(`# REQUEST (from ${request.from})\n${request.text}`);
    if (this.guidance.length) {
      parts.push(
        `# OWNER GUIDANCE\nArrived during this run. Act on it now; it shows once.\n${this.guidance.map((g) => `> ${g.from}: ${g.text}`).join("\n")}`,
      );
    }
    const past = this.history.slice(-this.config.historyKeep);
    if (past.length) {
      parts.push(
        `# EARLIER RUNS\n${past.map((h) => `> ${h.from}: ${h.request}\n< ${h.answer}`).join("\n")}`,
      );
    }
    if (steps.length) {
      parts.push(
        `# WORK DONE ON THIS REQUEST\n${steps
          .map(
            (s, i) =>
              `step ${i + 1}: ${s.thought ?? ""}\n${(s.results ?? [])
                .map((r) => `  ${r.tool} → ${r.ok ? "" : "ERROR "}${r.output}`)
                .join("\n")}`,
          )
          .join("\n")}`,
      );
    }
    parts.push(`# RESPONSE\n${RESPONSE_FORMAT}`);
    return parts.join("\n\n");
  }

  // Reasons to refuse a final answer: an artifact's gate, or no tool called
  // yet when minCalls is set. TODO: the old report-format check.
  gates(answer, steps = []) {
    const reasons = [];
    for (const artifact of this.artifacts) {
      const reason = artifact.gate?.(this, answer);
      if (reason) reasons.push(String(reason));
    }
    const ran = steps.reduce((n, s) => n + (s.calls?.length ?? 0), 0);
    if (this.config.minCalls && ran < this.config.minCalls) {
      reasons.push(
        `no tool called yet: call a tool under # TOOLS and answer from its results`,
      );
    }
    return reasons;
  }

  // A note for the run in progress: the next step's prompt shows it, then
  // it is gone. Only while a run is in progress (false otherwise).
  guide(text, from = "owner") {
    const note = String(text ?? "").trim();
    if (!note) throw new Error("guidance needs text");
    if (this.status !== "running") return false;
    this.guidance.push({ from, text: note, at: Date.now() });
    this.emit("guide", { from, text: note });
    return true;
  }

  stop(reason = "stopped by the owner") {
    this.stopped = true;
    this.emit("stop", { reason });
    return true;
  }

  // One run at a time per agent: a request that arrives while one runs
  // waits in the inbox (its entry is removed when its turn comes).
  async ask(text, { from = "owner", signal } = {}) {
    const run = this.queue.then(async () => {
      const waiting =
        this.status === "running"
          ? { id: `in${Date.now()}`, text: String(text).slice(0, 300), from }
          : null;
      if (waiting) this.inbox.push(waiting);
      try {
        return await this.#run({ text, from }, signal);
      } finally {
        if (waiting) {
          this.inbox = this.inbox.filter((m) => m !== waiting);
        }
      }
    });
    // A rejected run must not poison the queue for the next request.
    this.queue = run.catch(() => {});
    return run;
  }

  // TODO: the old chat() — one model call beside the runs, answering from
  // what the prompt shows without starting, waiting for, or changing a run.
  // Not built yet: calling it is an explicit error, not a silent no-op.
  async chat() {
    throw new Error("chat: not yet built (TODO in src/core/agent.js)");
  }

  twin() {
    return {
      element: "agent",
      id: this.name,
      name: this.name,
      description: this.config.description ?? "",
      role: String(this.config.role ?? ""),
      soul: String(this.config.soul ?? ""),
      model: this.config.model ?? null,
      tools: [...this.tools.values()].map((t) => ({
        name: t.name,
        type: t.type,
        description: t.description,
      })),
      artifacts: this.artifacts.map((a) => a.id),
      status: this.status,
    };
  }

  async #run(request, signal) {
    this.status = "running";
    this.stopped = false;
    const steps = [];
    this.current = { request, steps };
    for (const artifact of this.artifacts) {
      artifact.onRunStart?.(this, request);
    }
    this.emit("start", { request });
    try {
      let refused = 0;
      for (let n = 1; n <= this.config.maxSteps; n++) {
        if (this.stopped || signal?.aborted) throw new Error("stopped");
        for (const artifact of this.artifacts) {
          if (typeof artifact.refresh === "function") {
            await artifact.refresh(this);
          }
        }
        const shown = this.guidance.length;
        const prompt = this.render(request, steps);
        this.emit("think", { n });
        const raw = await this.infer(prompt, this, { signal });
        // Guidance shown in this prompt is read once the model replies.
        this.guidance.splice(0, shown);
        const reply = parseReply(raw);
        this.emit("step", {
          n,
          thought: reply.thought,
          calls: reply.calls,
          answer: reply.answer,
        });
        if (reply.answer != null && !reply.calls.length) {
          const reasons = this.gates(reply.answer, steps);
          if (!reasons.length)
            return this.#finish(request, reply.answer, steps);
          if (refused++ < this.config.gateRetries) {
            steps.push({
              thought: reply.thought,
              results: [
                {
                  tool: "gate",
                  ok: false,
                  output: `answer refused: ${reasons.join("; ")}`,
                },
              ],
            });
            this.emit("gate", { reasons });
            continue;
          }
          return this.#finish(request, reply.answer, steps, reasons);
        }
        if (!reply.calls.length) {
          steps.push({
            thought: reply.thought,
            results: [
              { tool: "format", ok: false, output: "give calls or an answer" },
            ],
          });
          this.emit("format", { note: "no calls and no answer" });
          continue;
        }
        // One step's calls run together, in parallel, as in the old loop.
        const results = await Promise.all(
          reply.calls.map((call, index) => this.#call(call, signal, index)),
        );
        steps.push({ thought: reply.thought, calls: reply.calls, results });
        if (reply.answer != null) {
          // Old rule, simplified: an answer beside artifact commands only,
          // all ok, is final once the gates pass; beside a data or agent
          // call it was written before those results, so it is not taken.
          const commandsOnly = reply.calls.every(
            (c) => this.tools.get(c.tool)?.type === "artifact",
          );
          const allOk = results.every((r) => r.ok);
          if (
            commandsOnly &&
            allOk &&
            !this.gates(reply.answer, steps).length
          ) {
            return this.#finish(request, reply.answer, steps);
          }
          steps.push({
            thought: reply.thought,
            results: [
              {
                tool: "format",
                ok: false,
                output:
                  "answer not taken: it came with calls whose results you had not read — read them above, then answer alone (no calls)",
              },
            ],
          });
        }
      }
      return this.#finish(
        request,
        `(stopped after ${this.config.maxSteps} steps without an answer)`,
        steps,
      );
    } finally {
      this.status = "idle";
      this.current = null;
      this.guidance = [];
    }
  }

  async #call({ tool, input }, signal, index) {
    const t = this.tools.get(tool);
    this.emit("call", { tool, input, index });
    let result;
    if (!t) {
      result = {
        tool,
        ok: false,
        output: `no tool ${tool}; have ${[...this.tools.keys()].join(", ")}`,
      };
    } else {
      try {
        const out = await t.run(input ?? {}, {
          ...this.context,
          agent: this,
          signal,
        });
        result = {
          tool,
          ok: true,
          output: typeof out === "string" ? out : JSON.stringify(out),
        };
      } catch (error) {
        result = { tool, ok: false, output: error.message };
      }
    }
    this.emit("result", { ...result, input: input ?? {}, index });
    return result;
  }

  #finish(request, answer, steps, flags = []) {
    this.history.push({ from: request.from, request: request.text, answer });
    this.emit("answer", { request, answer, flags, steps });
    return answer;
  }
}
