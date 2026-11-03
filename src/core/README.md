# core — the engine, skeleton first

## What an agent is, as understood from the old system

In the old ASKK (main, `backend/kernel/agent/agent.js`), an agent is not a
model and not a chatbot wrapper. It is **one configurable ReAct loop** with
a name, a role, a soul (who it is in every role), tools, and artifacts it
holds:

1. **Render a prompt, in a fixed order.** Soul, then `# YOU ARE <name>`
   with the role, then `# TOOLS`, then each artifact's latest state, then
   `# REQUEST`, then `# OWNER GUIDANCE` (a note from the owner, shown
   once), then `# EARLIER RUNS`, then `# WORK DONE ON THIS REQUEST`,
   then `# RESPONSE` — the reply format, last, so it is read right
   before the model writes.
2. **Infer.** The model is injected as `infer(prompt, agent, { signal })`.
   No model is bundled, and no agent library is used. The core desk in
   the old system ran this loop with `maxSteps: 120`; the kernel default
   was 12.
3. **Parse.** A reply is a thought plus tool calls, or a final answer
   alone. The old reply format was field-style (`thought:`, `call:` with
   input fields, `answer: <<< ... >>>`), with a JSON-object reply as a
   fallback.
4. **Call, in parallel.** One step's calls run together; their results
   join the run's steps and are shown in the next prompt. A call to an
   unknown tool, or a tool that throws, becomes an error result — the
   run goes on, it does not crash.
5. **Gate the answer.** Before a final answer is taken, artifacts may
   refuse it (an open checklist, for example), and an agent configured
   with `minCalls` refuses to answer before its tools have run. A
   refused answer costs a retry; a hard refusal never counts toward
   retries. After `gateRetries` soft refusals, the answer goes through
   flagged.
6. **Stop, or run out of steps.** One run at a time per agent; a request
   arriving mid-run waits in the inbox. `stop()` ends the run at the
   next step boundary. A run that reaches `maxSteps` without an answer
   ends with "(stopped after N steps without an answer)" as its answer.

**Tools** are one list, one contract: a function, another agent, or an
artifact's command. Another agent is called as a **quest** — a brief
with `requirement`, `ask`, and `outcome`, never a bare goal — and its
result is its report.

**Artifacts** are state beside the conversation, rendered into every
prompt as their latest state only. Their commands are tools that change
them; their `gate()` can refuse a final answer; their `refresh()` is
awaited before each step so host-backed state (a terminal tail, a file
tree) is fresh in the prompt.

**A desk** (old `backend/kernel/desk/desk.js`) was configuration in,
live agents out: specs build agents, agents holding agents lead teams,
and a team shares a board so the goal flows down and findings stay
where the team works. A desk is not built here yet.

## What this skeleton does

- `agent.js`: `Agent`, `Tool`, `AgentTool` (quest), `parseReply`, and
  the loop above — render, infer, parse, parallel calls, gates,
  inbox queue, `guide()`, `stop()`, `twin()` (the agent as plain data
  for its UI twin).
- `engine.js`: a thin factory, `createAgent(config, options)` and
  `runAgent(config, options, request)`. The "engine" is the loop
  itself; there is no separate engine machine, as in the old system.
- `agent.test.js`: the loop driven by a fake infer — one tool call,
  then an answer — plus an unknown-tool result and a gate refusal.

## What it does not do yet — correct me here first

- Full TOON reply parsing (lists, nested items, one-line joins).
- Prompt compaction / budgeting, image carrying, step router.
- Report-format checking on final answers.
- `chat()` — answering the owner without starting or changing a run.
- Letters as a structured inbox type (inbox entries are plain requests).
- Supervision digests (a run's supervision summary).
- A desk builder, a host (files, web, MCP, models), and any UI twin
  beyond `twin()` data. The old kernel, backend, companion, desks, and
  shell were deliberately not copied.
