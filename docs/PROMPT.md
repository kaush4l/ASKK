# PROMPT — what the LLM sees each turn

Derived from code; every claim cites the line that implements it. When this file and the
code disagree, the code wins (log it in docs/findings/).

## 1. Pipeline

```
turn.rs one_turn (crates/runtime/src/run/turn.rs:180-273)
  └─ build_sheet (turn.rs:277-319)
       └─ assemble() → Sheet{ elements: Vec<Element> }   (crates/runtime/src/assemble.rs:30-86)
            └─ Sheet::render() → InferenceRequest        (crates/core/src/sheet.rs:23-64)
                 { sections: Vec<(SectionKind, String)>, history, tools, contract, parts, config }
                                                          (crates/core/src/request.rs:124-132)
                      └─ provider adapter → wire messages
                         openai_compat (crates/inference/src/openai_compat.rs:71-112)
                         anthropic     (crates/inference/src/anthropic.rs:49-88)
```

Render is a pure projection; `absorb` is the only write path (sheet.rs:2, 70-117).
The sheet is rebuilt from scratch every turn — repairs included (turn.rs:191-192).

## 2. Element order

Fixed order (assemble.rs:53-84); text elements project to a named section via
`Element::section()` (crates/core/src/element.rs:62-112), structural ones fill dedicated
request fields in `Sheet::render` (sheet.rs:36-52).

| # | Element | Kind | SectionKind / request field | Rendered as (element.rs) |
|---|---|---|---|---|
| 1 | Identity | text | `identity` | soul + `\n\n` + `You are {name}. {role}` (64-76) |
| 2 | Directive | text | `directive` | per-run directive, else agent `description` (assemble.rs:61-65) |
| 3 | Skills | text | `skills` | `## {name}\n{body}` per skill, joined `\n\n` (78-85) |
| 4 | ToolManifest | structural | `req.tools` | full ToolSpecs (sheet.rs:37) |
| 5 | Contract | structural | `req.contract` + LAST section | see §4 (sheet.rs:38-48, 60-62) |
| 6 | StateSnapshot | text | `state` | `{key}: {value}` per slice line (86-94) |
| 7 | Memory | text | `memory` | raw content (95) |
| 8 | History | structural | `req.history` | verbatim messages (sheet.rs:49) |
| 9 | UserInput | text | `user_input` | the run goal (turn.rs:305) |
| 10 | Multimodal | structural | `req.parts` | only when parts exist (assemble.rs:74-76); run loop passes none today (turn.rs:310) |
| 11 | InferenceConfig | structural | `req.config` | provider/model/temperature/max_tokens (request.rs:78-96) |
| 12 | ActionPolicy | text | `action_policy` | `Pure tools: X. Mutating tools: Y.` + per-tool overrides (crates/core/src/action.rs:92-102) |
| 13 | OutputMode | structural | `req.contract.mode` | last OutputMode element wins (sheet.rs:24-32) |
| 14 | PhaseFrame | text | `phase` | `# Phase: {name}\n{header}` + `## artifact: {n}\n{c}` per prior-phase artifact (98-104); only on declared strategies (turn.rs:291-295) |

Contract format instructions always render as the LAST section, wherever the Contract
element sits (sheet.rs:60-62).

## 3. Provider mapping

Providers map, they never compose prompt text (ADR-002; request.rs:1-2).

**openai_compat** (openai_compat.rs):
- All non-`user_input` sections → ONE system message of `## {kind}\n{text}` blocks joined
  `\n\n`; `user_input` sections → trailing user message(s) (split_sections, 54-68).
- Messages = `[system] + history verbatim + user inputs` (74-82); roles pass through
  as `system|user|assistant|tool` (role_str, 42-49).
- Tools: `{"type":"function","function":{name,description,parameters:input_schema}}` (84-97).
- `response_format: json_object` iff mode == Json (104-106); `stream: true` +
  `stream_options.include_usage` always (107-111); buffered fallback if the server
  ignores streaming (310-317).

**anthropic** (anthropic.rs):
- Same split_sections string → the `system` field (49-50, 67-69).
- Only user/assistant roles exist: history `Role::Tool` and `Role::System` collapse to
  `"user"` (53-57). Tools use `input_schema` directly (73-86). `max_tokens` required,
  default 1024 (16, 64). Multimodal parts are dropped; non-streaming — one delta with
  the full text (44-48, 150-152).

**History flattening** (both providers see flat text):
- Assistant tool-call turns are stored as the JSON-stringified `Vec<ToolCall>`
  (sheet.rs:74-77).
- Tool results are flat `Role::Tool` messages, `"{name}: {content}"` (turn.rs:60-67;
  crates/runtime/src/run/dispatch.rs:239). Nothing round-trips provider-native
  tool_use ids (turn.rs:245-256).

## 4. Response format

**Contract instructions** (crates/core/src/contract.rs) = mode preamble + field
bullets + ONE worked example headed `Example (shape only):` — TOON: one `field: value`
line per field (values from `FieldSpec.example`, else kind placeholders); JSON: one
compact object; Text mode renders none. Curated examples ship on react/plan/critique
(contracts.rs); agent authors set `field.N.example` in frontmatter.

| Mode | Preamble (contract.rs:90-98) |
|---|---|
| json | "Respond with a single JSON object and nothing else." |
| toon | one `field: value` line per field; list fields = `field:` + `- item` lines; no prose outside the fields |
| text | "Respond in plain text." |

Then `Fields:` with one bullet per field: `- name (required|optional, text|list|one of: a | b): description` (99-117).

`Contract::schema()` (121-141) projects a JSON Schema onto `ContractWire.schema`
(request.rs:113-120); neither adapter sends it today — openai_compat only uses the mode
for `response_format` (openai_compat.rs:104-106).

**TOON** (crates/core/src/toon.rs): decode is key-aware — a line opens a field iff its
head before `:` is a known contract field (78-89); unknown `word:` lines are continuation
text, so URLs/prose never split a field (44-74). Tolerates quoted/backticked keys, a
leading `{` (truncated JSON), quote-stripped values, trailing commas, `- item` dash lists
and inline `[a, b]` lists (78-126). Encode: `field: value` / dash lists (11-33).

**Parse cascade** (contract.rs:144-187, ADR-002):
1. Native tool calls win outright (145-155).
2. JSON brace-scan: first balanced object (extract_json_object, 328-353), guarded — must
   contain ≥1 known field or it's an embedded fragment (223-230). A failed JSON rung
   falls through to TOON before its failure is reported (156-163, 182-184).
3. TOON decode (164-178).
4. Bare tool-call recovery — only for contracts with an `action` field; scans the raw
   reply for MCP `{"name","arguments"}` objects or natural `toolname: {args}` blocks
   (193-207; crates/core/src/toolcall.rs:46-71).
5. Nothing structured: coerce defaults; required fields decide (185-187).

Coercion (232-277, 288-325): missing optional → `""`/`[]` (enums have no default);
missing/invalid required → `ParseFailure{missing, repair_prompt}`; unknown extras kept;
enum values matched case-insensitively.

**Repair cascade** (turn.rs:22-27, 190-242):
- ≤2 repairs per turn (`MAX_REPAIRS_PER_TURN`, turn.rs:23); each failure appends the
  repair prompt as an observation and re-runs assemble→infer (235); the 3rd failure
  falls back to the raw text as the answer, format `Repaired` (226-234). Budget is
  re-checked before every repair call (236-240).
- FormatNegotiator (contract.rs:357-404): 3 consecutive parse failures escalate
  TOON→JSON, sticky; any success resets the streak. The escalated mode reaches the
  sheet as an `OutputMode` override (turn.rs:299).
- Provider retry: ≤3 attempts per LLM call with backoff (`MAX_PROVIDER_ATTEMPTS`,
  turn.rs:25, 382-436); rate-limit `retry-after` honored (424-429).

## 5. Tools

- The model sees native tool specs only: name, description, full JSON Schema
  `input_schema` (ToolSpec, crates/core/src/tool.rs:20-26, via req.tools). No prompt-text tool
  cards — `ToolManifest.section()` is `None` (element.rs:105-110).
- Phase-effective allowlist: `phase.tools` filter ∩ the run's allowlist
  (effective_allow, turn.rs:333-342); the per-turn ToolSet is built from it
  (turn.rs:344-349) so the manifest already reflects the current phase.
- Dispatch re-checks membership (dispatch.rs:35-41); an unknown tool becomes an
  observation listing the allowed names (dispatch.rs:73-86).
- Delegate agents appear as tools named by agent id, card = name + description
  (crates/runtime/src/delegate.rs:97-120); `handoff` transfers the whole run (163-198).

## 6. Context lifecycle

History starts empty per run (crates/runtime/src/run/session.rs:177) and grows by:

| Append | Where |
|---|---|
| Assistant reply verbatim (answer text, or JSON-stringified calls) | sheet.rs:73-90 (absorb) |
| Tool observation `"{name}: {content}"` as Role::Tool | dispatch.rs:239; turn.rs:60-67 |
| Unknown-tool / denial / delegated-confirmation observations | dispatch.rs:76-86, 103-113, 136-145 |
| Repair prompts | turn.rs:235 |
| Gate failure `Gate '{name}' failed — revise. {feedback}` | crates/runtime/src/run/answer.rs:89-98 |
| Phase-exhaustion reroute / empty fan-out notes | crates/runtime/src/run/flow.rs:40-48, 90-99 |
| Final-turn nudge (Role::User, "answer now; do not call tools") | turn.rs:27, 124-135; Budgets::is_final_turn (crates/core/src/state.rs:79-81) |

Bounds — Budgets (state.rs): `max_turns` 16, `deadline_ms` 300 000, `tool_timeout_ms`
30 000, `stream_idle_timeout_ms` 30 000, `max_delegation_depth` 2, plus the context
knobs `max_context_chars` 60 000 and `max_observation_chars` 6 000. Each request sends
a WINDOWED VIEW of history (`window_history`, crates/core/src/context.rs): the first
user message + the newest messages that fit, middle elided with one
`[…N earlier messages elided…]` marker — durable history is never rewritten. Single
observations clamp at `max_observation_chars` with an explicit clip suffix, and
web_search/news_search/fetch_url/mcp_* observations carry an
`(untrusted web content)` label (run/dispatch.rs). Per-phase `max_turns` clamps loop
phases (turn.rs).

Delegation: a child's answer returns as one observation `Result (untrusted): {text}`
(delegate.rs:148-150); non-Answered terminals return as error observations (151-155).
Handoff answers verbatim and ends the calling run (dispatch.rs:243-254). Prior-phase
answers re-enter the prompt as PhaseFrame artifacts, not history (answer.rs:61, 75;
turn.rs:291-295).

## 7. Prompt-engineering knobs (agent authors)

All from `agents/` files, loaded fail-loud (crates/runtime/src/config/agent.rs).

| Knob | Where it lands in the prompt |
|---|---|
| `agents/soul.md` | Identity section prelude, before "You are …" (agent.rs:312-314; element.rs:64-76) |
| agent.md body | Identity role sentence — the role prompt (agent.rs:38-39, 58; assemble.rs:54-58) |
| `description:` | Directive section default (assemble.rs:61-65) AND the delegate tool card (delegate.rs:101-105) |
| `skills:` + `agents/skills/*.md` | `skills` section, `## name\nbody` fragments (agent.rs:82, 270-309; element.rs:78-85) |
| `contract:` | Named contract: react \| plan \| critique (crates/core/src/contracts.rs:7) or the agent's own (below) |
| `field.N.name/kind/required/desc` | Agent-local contract named by agent id; beats the registry (config/fields.rs; config/mod.rs:19-27) |
| `format: json\|toon\|text` | Initial OutputMode (agent.rs:85-92); negotiator may escalate to json (§4) |
| `phase.N.header` | PhaseFrame header text (agent.rs:197, 244) |
| `phase.N.contract` / `phase.N.tools` | Per-phase contract override + allowlist narrowing (turn.rs:296-299, 333-342) |
| `env: vm\|web\|core\|board` | Tool bundles expanded into `tools:` at load (config/env.rs:11-33) |
| `provider:` | Provider profile id on InferenceConfig (agent.rs:83; turn.rs:312-314) |
