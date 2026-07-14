# Glossary

- **Harness** — the top-level runtime coordinating sheets, agents, inference, tools, state,
  actions, outputs. Code home: `crates/engine` (+ `crates/features`, `crates/state`).
- **Sheet** — the typed, serializable working surface for one agent invocation; an ordered
  collection of Elements. Rendering a sheet produces the exact `InferenceRequest` sent to a
  provider. The sheet is the only thing an agent "sees".
- **Element** — one typed unit on a sheet (identity, directive, tool manifest, state snapshot,
  user input, multimodal part, inference config, response contract, action policy, output mode,
  phase frame, memory). Each element knows how to **render** (project itself into the request)
  and, where applicable, **absorb** (validate/apply the model's effect on it).
- **Agent** — configuration, not code: a markdown file (frontmatter + body) selecting identity,
  directive, tools, contract, provider profile, phases, policies. Loaded into `AgentConfig`,
  validated at load time.
- **Soul** — `agents/soul.md`, the shared persona/laws prepended to every agent's identity element.
- **Skill** — a named markdown fragment (`agents/skills/`) composed into the sheet when an agent
  lists it.
- **Provider** — an adapter implementing the `Provider` trait: maps a rendered `InferenceRequest`
  to one wire format and parses the reply. Never composes prompt text.
- **Transport** — the injected HTTP/SSE seam a provider uses. Mocked in tests; fetch in the browser.
- **Contract** — a structured response schema (field specs + rules): renders format instructions,
  parses replies (native structured output → JSON → TOON → repair), reports typed parse errors.
- **TOON** — token-oriented object notation; line-based `field: value` format small models emit
  more reliably than JSON. Fallback wire format, negotiated per failure count.
- **Tool** — a callable capability behind one trait: `spec()` (name/description/JSON-schema input)
  + `call(args)`. Membership in a run's `ToolSet` IS the allowlist.
- **Action** — an effectful operation proposed by an agent. Every tool spec declares `effect:
  Pure | Mutating`. Mutating calls route through the action gate: validate → policy (auto /
  confirm / deny) → execute → audit record. Denial is a first-class observation.
- **Signal** — one typed event `{seq, run_id, kind, ts}` in the append-only run log. The log is
  the source of truth for run state; UI state = fold(signals).
- **Fold / Projection** — the pure reducer turning a signal stream into view state. Replay from
  seq 0 reproduces identical state.
- **Run / Execution** — one submission processed to a terminal: `Answered | Unverified |
  BudgetExhausted | Interrupted | Error`.
- **Phase** — one stage of a strategy (name, contract kind, tool policy, loop mode, prompt frame).
  Declared in agent.md flat keys or built-in.
- **Gate phase** — the verifier phase; the only phase whose pass may end a run as success.
- **Strategy** — the phase list + routing rules (`Next | Back(i) | Done`) an agent runs under.
- **Delegation** — agent-as-tool. A sub-agent appears in the parent's ToolSet; authority narrows
  (child tools = parent ∩ own); nesting depth-capped.
- **State categories** — session (UI/app), run (fold of signals), agent memory (per-agent,
  persistent), project/workspace (artifacts), config (agents/providers), derived (projections),
  scratch (per-run, disposable).
