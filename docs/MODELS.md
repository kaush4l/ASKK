# Domain models

Signatures are the design contract. Implementation may add fields, never remove semantics.
All types live in `crates/core` unless noted.

## Sheet & Element

```rust
pub struct Sheet {
    pub elements: Vec<Element>,       // ordered; order = render order
}

pub enum Element {                    // closed enum: serializable, exhaustive render (ADR-001)
    Identity(Identity),               // soul + "You are {name}" + role body
    Directive(Directive),             // the current task/goal framing
    Skills(Vec<Skill>),               // named markdown fragments
    ToolManifest(Vec<ToolSpec>),      // what the model is SHOWN (⊆ dispatch allowlist)
    Contract(Contract),               // response schema + format instructions (rendered LAST)
    StateSnapshot(StateSnapshot),     // selected state slices, explicit
    Memory(MemoryBlock),              // agent memory digest
    History(Vec<Message>),            // conversation prefix + in-run turns
    UserInput(String),
    Multimodal(Vec<Part>),            // images/audio; provider maps or drops with a signal
    InferenceConfig(InferenceConfig), // model/provider profile, temperature, budgets
    ActionPolicy(ActionPolicy),       // per-effect gate policy
    OutputMode(OutputMode),           // json | toon | text (negotiated)
    PhaseFrame(PhaseFrame),           // current phase header + artifacts from prior phases
}

impl Sheet {
    pub fn render(&self) -> InferenceRequest;               // pure projection
    pub fn absorb(&mut self, effect: &ParsedResponse) -> Vec<Signal>;  // apply + emit
}
```

Each element renders into a named request section. Providers consume sections; they never
re-template. `absorb` is the write path: history append, state deltas, artifact adds — each
returning signals, never hidden mutation.

## Agent configuration (agent.md)

```
---
id: coder                # slug, unique, validated
name: Coder
description: ...         # doubles as the tool card when delegated to
enabled: true
tools: file_read, file_write, run_js        # names resolved at load; unknown = hard error
skills: concise                              # resolved at load; unknown = hard error
provider: default                            # provider profile id
contract: react                              # named contract (default: react)
format: toon                                 # initial output mode
budget.max_turns: 64                         # optional budget.* overrides of the session budgets
budget.deadline_s: 1800                      # wall clock, seconds (stored as ms)
budget.depth: 3                              # delegation depth cap, 1..=8 (runaway guard)
phase.1.name: plan                           # optional phases → DeclaredStrategy
phase.1.contract: plan
phase.1.loop: one_shot
phase.2.name: execute
phase.2.contract: react
phase.2.loop: loop
phase.3.name: verify
phase.3.contract: critique
phase.3.gate: true
phase.3.on_fail: plan
---
(markdown body = the directive/role prompt)
```

Load pipeline: parse frontmatter → `AgentConfig` → `validate(refs)` (tools, skills, contracts,
providers, phase targets) → hard error listing every problem. Silent drops forbidden.
Sub-agents: `agents/<team>/N_member.md`; folder = team; members become delegate tools.

## Provider interface

```rust
pub struct InferenceRequest {         // the rendered sheet — provider-agnostic
    pub sections: Vec<(SectionKind, String)>,  // system-side, ordered
    pub history: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub contract: ContractWire,       // native schema if supported, else instructions text
    pub parts: Vec<Part>,             // multimodal
    pub config: InferenceConfig,
}

pub struct InferenceReply {
    pub text: String,
    pub native_tool_calls: Vec<ToolCall>,  // empty if provider has no native calling
    pub usage: Option<Usage>,
}

pub trait Provider {
    fn id(&self) -> &str;
    async fn infer(&self, req: &InferenceRequest, on_delta: &mut dyn FnMut(&str))
        -> Result<InferenceReply, ProviderError>;
}

pub enum ProviderError { Unreachable{hint: String}, Auth, RateLimited{retry_after_ms: Option<u64>},
                         BadRequest(String), Timeout, Malformed(String) }
```

Adapters (in `crates/inference`): `openai_compat`, `anthropic`, `mock`; `local` (transformers.js)
in `web`. Body building + reply parsing are pure functions over an injected `Transport`
(`async fn send(HttpRequest) -> HttpResponse` + SSE reader). Retry/backoff with injected sleeper
lives in the runtime call site, not adapters. Provider selection: `"provider/model"` id →
cached instance in a registry. Reach errors carry actionable hints (CORS, key, URL).

## Tool model

```rust
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,          // JSON Schema; structured args from day one
    pub effect: Effect,               // Pure | Mutating (routes through action gate)
}

pub trait Tool {
    fn spec(&self) -> &ToolSpec;
    async fn call(&self, args: Value, ctx: &mut ToolCtx) -> ToolResult;  // never panics into loop
}

pub struct ToolSet { /* name-keyed, insertion-ordered; membership = allowlist */ }
```

One registry (`runtime/src/tools/registry.rs`), one trait, adapters for: rust fn, MCP tool,
agent-as-tool (delegation seam, depth-capped), JS/worker tool (web). `ToolCtx` exposes the
**explicit state slices** the tool declared — no shared mutable world (ADR-005). Errors become
observation strings; unauthorized names get a structured allowlist rejection.

## Contract model

```rust
pub struct Contract {
    pub name: &'static str,           // "react" | "plan" | "critique" | custom
    pub version: u8,
    pub fields: Vec<FieldSpec>,       // {name, kind: Str|List|Enum(..), required, description}
}

impl Contract {
    pub fn instructions(&self, mode: OutputMode) -> String;   // render side
    pub fn parse(&self, reply: &InferenceReply) -> Result<ParsedResponse, ParseFailure>;
    // parse cascade: native tool_calls/structured → JSON brace-scan → TOON → repair/coerce
}
```

`ParsedResponse` = typed map + `action: Answer | ToolCalls(Vec<ToolCall>)`.
`FormatNegotiator`: TOON default → 3 consecutive failures escalates to JSON → reset on success;
per-turn `honored` telemetry signal. Missing required fields ⇒ `ParseFailure` with repair
prompt appended as observation (bounded retries). Contracts registered by name; versioned;
unknown contract name at load = hard error.

## Action model

```rust
pub struct ActionProposal { pub id: ActionId, pub tool: String, pub args: Value,
                            pub effect: Effect, pub rationale: String }
pub enum Verdict { Auto, NeedsConfirmation, Denied{reason: String} }
pub struct ActionRecord { pub proposal: ActionProposal, pub verdict: Verdict,
                          pub result: Option<ToolResult>, pub ts: u64 }
```

Flow: model emits tool call → if `effect == Mutating`, gate validates (schema + `ActionPolicy`)
→ `Auto` executes; `NeedsConfirmation` parks a pending future, surfaces to UI, resolution
(approve/deny) is a command; `Denied` returns a first-class observation. Every decision appends
an `ActionRecord` signal → audit trail is the log itself. Dry-run: execute with `ctx.dry_run`
= tool reports what it would do.

## State model

| Category | Store | Durability | Written by |
|---|---|---|---|
| Session (UI, model pick) | `SessionStore` (memory + OPFS mirror) | reload-safe | UI commands |
| Run state | fold(signal log) | replayable | reducer only |
| Signal log | JSONL, OPFS, epoch segments | durable | single writer |
| Agent memory | `MemoryStore` (OPFS) | durable | absorb path |
| Workspace/artifacts | OPFS `artifacts/<id>/` | durable | tools via action gate |
| Config | `agents/*.md`, provider profiles | files | user |
| Derived | projections | none (recompute) | fold |
| Scratch | per-run struct | none | run loop |

Stores are traits in runtime (`KvStore`, `BlobStore`); memory impls for tests, OPFS impls in web.
Every durable write is traceable to a signal. Rollback = replay to seq N. Stale-state conflicts:
epoch fence — a new epoch synthesizes terminals for stale runs.
