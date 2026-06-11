//! The abstract base: [`BaseEngine`] (the shared state record) and
//! [`trait Engine`](Engine) (the template — default methods over required
//! accessors), plus the seams the loop runs through: [`LocalInference`] (a
//! dyn-safe view of any [`InferenceProvider`], so the model is injectable) and
//! [`EngineHooks`] (the shell's observation/policy surface).
//!
//! Rust has no class inheritance; the abstract-base idiom here is a trait whose
//! default methods do the inherited work through two required accessors
//! (`base()` / `base_mut()`). A concrete engine supplies the accessors and the
//! one abstract method, [`Engine::invoke`] — everything else comes "from the
//! superclass". The same idiom already shapes `InferenceProvider`, whose
//! streaming call defaults to the non-streaming one.

use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use serde_json::Value;
use uuid::Uuid;

use crate::inference::{
    InferenceOutput, InferenceProvider, InferenceRequest, SubAgentInfo, get_implementation,
};
use crate::responses::{
    FormatNegotiator, ParsedToolCall, ReActResponse, ResponseFormat, ResponseKind,
};
use crate::state::{
    AgentMemory, AppResult, AppSnapshot, Message, ProviderConfig, Skill, ToolResult, ToolSpec,
    merge_agent_memories, now_iso,
};

use super::content::{MultimodalCollector, Part};
use super::tooling::{ToolMap, disallowed_tool_result, join_in_order};

/// A dyn-safe view of an [`InferenceProvider`]. The provider trait uses `async
/// fn` (not object-safe), so this wrapper boxes the futures; the blanket impl
/// below makes every provider — including a test mock — usable as an
/// [`InferenceHandle`] with no per-provider glue.
pub trait LocalInference {
    fn invoke_react<'a>(
        &'a self,
        config: &'a ProviderConfig,
        request: InferenceRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<InferenceOutput<ReActResponse>>> + 'a>>;

    fn invoke_react_streaming<'a>(
        &'a self,
        config: &'a ProviderConfig,
        request: InferenceRequest,
        on_partial_answer: &'a mut dyn FnMut(String),
    ) -> Pin<Box<dyn Future<Output = AppResult<InferenceOutput<ReActResponse>>> + 'a>>;
}

impl<P: InferenceProvider> LocalInference for P {
    fn invoke_react<'a>(
        &'a self,
        config: &'a ProviderConfig,
        request: InferenceRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<InferenceOutput<ReActResponse>>> + 'a>> {
        Box::pin(InferenceProvider::invoke_react(self, config, request))
    }

    fn invoke_react_streaming<'a>(
        &'a self,
        config: &'a ProviderConfig,
        request: InferenceRequest,
        on_partial_answer: &'a mut dyn FnMut(String),
    ) -> Pin<Box<dyn Future<Output = AppResult<InferenceOutput<ReActResponse>>> + 'a>> {
        Box::pin(InferenceProvider::invoke_react_streaming(
            self,
            config,
            request,
            on_partial_answer,
        ))
    }
}

/// The model an engine talks to, attached at construction. `Rc<dyn ...>` so a
/// mock slots in for tests and internal calls (compaction, summaries) can share
/// the handle.
pub type InferenceHandle = Rc<dyn LocalInference>;

/// Cooperative sleep between model-call retries, injected by the shell (a gloo
/// timer in the browser; [`noop_sleeper`] on the host). Keeps the core free of
/// `cfg(target_arch)`.
pub type Sleeper = Rc<dyn Fn(u32) -> Pin<Box<dyn Future<Output = ()>>>>;

/// A sleeper that yields immediately — the host-side default and the test value.
pub fn noop_sleeper() -> Sleeper {
    Rc::new(|_ms| Box::pin(async {}))
}

/// The shell's verdict on a candidate final answer (validators live above the
/// core; the loop only honors the verdict).
#[derive(Clone, Debug, PartialEq)]
pub enum AnswerVerdict {
    /// Accept: the loop stops with this answer.
    Accept,
    /// Reject: `feedback` re-enters the conversation as a user message and the
    /// loop continues.
    Reject { feedback: String },
    /// Abort: stop the loop without an answer (e.g. validation retry budget
    /// exceeded — the shell has already recorded why).
    Abort,
}

/// The shell's verdict on one tool result, mirroring [`AnswerVerdict`]: accept
/// it into the conversation as evidence, replace it with feedback, or abort.
#[derive(Clone, Debug, PartialEq)]
pub enum ToolVerdict {
    /// Accept: the observation enters the conversation as untrusted evidence.
    Accept,
    /// Reject: `feedback` enters the conversation instead of the raw result.
    Reject { feedback: String },
    /// Abort: stop the loop (the shell has already recorded why).
    Abort,
}

/// Why an [`Engine::invoke`] returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// A final answer was produced and accepted.
    Answered,
    /// The iteration budget ran out before an accepted answer.
    BudgetExhausted,
    /// The shell signalled an interrupt between turns.
    Interrupted,
    /// Every model attempt failed; the shell paused the run (resumable).
    ProviderPaused,
    /// A hook verdict aborted the loop.
    Aborted,
}

/// What one [`Engine::invoke`] produced.
#[derive(Clone, Debug)]
pub struct EngineOutcome {
    /// The last parsed model response, if any model call succeeded.
    pub last_response: Option<ReActResponse>,
    /// The accepted final answer, when `stop` is [`StopReason::Answered`].
    pub answer: Option<String>,
    /// Turns actually taken (model calls attempted, 1-based count).
    pub turns_used: u32,
    /// Why the loop stopped.
    pub stop: StopReason,
}

/// The shell's observation and policy surface. Every method defaults to a
/// no-op/accept, so the bare loop runs with [`NoHooks`]; the shell implements
/// this once to attach events, persistence, validators, compaction, and the
/// interrupt flag without those concerns living inside the loop.
pub trait EngineHooks {
    /// Polled between turns; `true` stops the loop with
    /// [`StopReason::Interrupted`].
    fn interrupted(&self) -> bool {
        false
    }

    /// Per-turn memory maintenance, called before each model call with the
    /// in-run history. The shell's compaction policy rewrites the transcript
    /// here; the core does not care how.
    #[allow(async_fn_in_trait)]
    async fn before_turn(&mut self, history: &mut Vec<Message>) {
        let _ = history;
    }

    /// A turn is starting (1-based), with the current transcript sizes.
    fn on_turn_start(&mut self, turn: u32, conversation_len: usize, history_len: usize) {
        let _ = (turn, conversation_len, history_len);
    }

    /// The model replied and parsed; fired after the raw text entered history.
    fn on_model_response(&mut self, turn: u32, raw_text: &str, parsed: &ReActResponse) {
        let _ = (turn, raw_text, parsed);
    }

    /// One model attempt failed (the loop may retry).
    fn on_model_failure(&mut self, attempt: u32, max_attempts: u32, error: &str) {
        let _ = (attempt, max_attempts, error);
    }

    /// Every model attempt failed; the loop is stopping with
    /// [`StopReason::ProviderPaused`]. The shell pauses the run here.
    fn on_model_exhausted(&mut self) {}

    /// The format negotiator escalated (e.g. TOON → JSON) after consecutive
    /// parse failures on the previously requested format.
    fn on_format_escalated(&mut self, from: ResponseFormat, to: ResponseFormat, failures: u32) {
        let _ = (from, to, failures);
    }

    /// A message entered the engine's history (fired before the push). The
    /// shell mirrors the in-run transcript here.
    fn on_history_appended(&mut self, message: &Message) {
        let _ = message;
    }

    /// A tool call was prepared: id assigned and the allowlist gate decided.
    /// The shell records the request and emits its event here.
    fn on_tool_prepared(&mut self, call_id: &str, call: &ParsedToolCall, allowed: bool) {
        let _ = (call_id, call, allowed);
    }

    /// One tool finished (results arrive in call order). The shell validates,
    /// records, and rules on the result; the loop honors the verdict.
    fn on_tool_finished(&mut self, name: &str, result: &ToolResult) -> ToolVerdict {
        let _ = (name, result);
        ToolVerdict::Accept
    }

    /// The model proposed a final answer (`no_parsed_call` marks the "chose a
    /// tool but produced no parseable call" path). The shell validates and
    /// rules; the loop honors the verdict.
    fn on_answer(&mut self, text: &str, no_parsed_call: bool) -> AnswerVerdict {
        let _ = (text, no_parsed_call);
        AnswerVerdict::Accept
    }
}

/// The hook impl that accepts everything and observes nothing — the bare loop.
pub struct NoHooks;

impl EngineHooks for NoHooks {}

/// The shared state record every engine owns — the Rust shape of the
/// reference's `BaseAgent` fields. Construction attaches the inference object
/// from the provider config (the reference's "inference attached in `__init__`
/// from `model_id`"); everything else is plain data the shell fills in.
pub struct BaseEngine {
    /// Agent display name, rendered into the prompt ("You are {name}").
    pub name: String,
    /// Agent role/description, rendered into the prompt.
    pub description: String,
    /// The shared soul/persona prompt.
    pub soul: String,
    /// Provider config for every model call this engine makes.
    pub provider: ProviderConfig,
    /// The model, attached at construction (registry) or injected (tests).
    pub inference: InferenceHandle,
    /// The callable tools; membership is the allowlist gate.
    pub tools: ToolMap,
    /// The tool manifest shown to the model. Deliberately separate from
    /// `tools`: a phase may show a subset of specs while the dispatch gate
    /// stays the full map (today's specs-vs-allowlist split).
    pub specs: Vec<ToolSpec>,
    /// Workspace skills rendered into the prompt (post phase filtering).
    pub skills: Vec<Skill>,
    /// Peer agents this engine can see and delegate to.
    pub sub_agents: Vec<SubAgentInfo>,
    /// Prior-session conversation prefix, fixed for the run.
    pub conversation: Vec<Message>,
    /// The in-run transcript (the reference's `history`). Grows through
    /// [`Engine::append_history`] so the shell can mirror it.
    pub history: Vec<Message>,
    /// The response contract for this engine's turns.
    pub response_kind: ResponseKind,
    /// Cross-turn format negotiation (escalates to JSON on parse failures).
    pub negotiator: FormatNegotiator,
    /// Multimodal collectors run at every render.
    pub collectors: Vec<MultimodalCollector>,
    /// Cooperative sleep used between model-call retries.
    pub sleeper: Sleeper,
}

impl BaseEngine {
    /// Construct with inference attached from `provider` via the cached
    /// registry.
    pub fn new(provider: ProviderConfig) -> Self {
        let inference: InferenceHandle = Rc::new(get_implementation(&provider));
        Self::with_inference(inference, provider)
    }

    /// Construct with an explicit inference handle — tests inject a mock here.
    pub fn with_inference(inference: InferenceHandle, provider: ProviderConfig) -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            soul: String::new(),
            provider,
            inference,
            tools: ToolMap::default(),
            specs: Vec::new(),
            skills: Vec::new(),
            sub_agents: Vec::new(),
            conversation: Vec::new(),
            history: Vec::new(),
            response_kind: ResponseKind::ReAct,
            negotiator: FormatNegotiator::new(ResponseFormat::Toon),
            collectors: Vec::new(),
            sleeper: noop_sleeper(),
        }
    }
}

/// How many times one [`Engine::call_model`] retries before giving up.
const MAX_MODEL_ATTEMPTS: u32 = 3;

/// The abstract base. Concrete engines supply the two accessors and
/// [`Engine::invoke`]; every other method has a default body — the inherited
/// common functionality of the reference's `BaseAgent`.
pub trait Engine {
    /// The shared state record (the "superclass fields").
    fn base(&self) -> &BaseEngine;

    /// Mutable access to the shared state record.
    fn base_mut(&mut self) -> &mut BaseEngine;

    /// The one abstract method: drive `goal` to an outcome. Concrete engines
    /// define the loop shape; [`super::ReactEngine`] is the bounded ReAct loop.
    #[allow(async_fn_in_trait)]
    async fn invoke<H: EngineHooks>(
        &mut self,
        goal: &str,
        snapshot: &mut AppSnapshot,
        hooks: &mut H,
    ) -> EngineOutcome;

    /// Assemble the one big sheet of paper for a turn: identity, soul, skills,
    /// tool manifest, sub-agent roster, the ordered transcript, the current
    /// time, the negotiated format instructions (always last on the wire), and
    /// any multimodal parts. The provider maps this onto its wire format; it
    /// never composes prompt sections itself.
    fn render(&self, goal_text: &str) -> InferenceRequest {
        let base = self.base();
        InferenceRequest {
            agent_name: base.name.clone(),
            agent_role: base.description.clone(),
            soul: base.soul.clone(),
            skills: base.skills.clone(),
            goal: goal_text.to_string(),
            history: self.transcript(goal_text),
            tools: base.specs.clone(),
            sub_agents: base.sub_agents.clone(),
            now: now_iso(),
            format_instructions: base.response_kind.instructions(base.negotiator.format()),
            parts: self.collect_multimodal(),
        }
    }

    /// The full ordered transcript for a turn: prior conversation, the goal as
    /// a user message, then the in-run history.
    fn transcript(&self, goal_text: &str) -> Vec<Message> {
        let base = self.base();
        let mut messages = base.conversation.clone();
        messages.push(Message {
            role: "user".to_string(),
            content: goal_text.to_string(),
        });
        messages.extend(base.history.iter().cloned());
        messages
    }

    /// The last `limit` in-run messages.
    fn format_history(&self, limit: usize) -> &[Message] {
        let history = &self.base().history;
        &history[history.len().saturating_sub(limit)..]
    }

    /// The single funnel for history growth: fires the mirror hook, then
    /// pushes. All loop writes to the transcript go through here so the shell
    /// sees every message exactly once.
    fn append_history<H: EngineHooks>(&mut self, hooks: &mut H, role: &str, content: String) {
        let message = Message {
            role: role.to_string(),
            content,
        };
        hooks.on_history_appended(&message);
        self.base_mut().history.push(message);
    }

    /// Run every collector and gather the parts for this render.
    fn collect_multimodal(&self) -> Vec<Part> {
        self.base()
            .collectors
            .iter()
            .flat_map(|collect| collect())
            .collect()
    }

    /// Parse `tool_name({...})` invocations out of model text. Static helper,
    /// mirroring the reference's `parse_tool_calls`.
    fn parse_tool_calls(text: &str) -> Vec<ParsedToolCall>
    where
        Self: Sized,
    {
        crate::responses::parse_tool_calls(text)
    }

    /// Call the model with retry and backoff, then score the reply against the
    /// requested format and feed the negotiator. Returns `None` when every
    /// attempt failed — the shell has been told via
    /// [`EngineHooks::on_model_exhausted`] and decides what that means (today:
    /// pause the run, resumable).
    #[allow(async_fn_in_trait)]
    async fn call_model<H: EngineHooks>(
        &mut self,
        request: InferenceRequest,
        hooks: &mut H,
    ) -> Option<InferenceOutput<ReActResponse>> {
        let requested_format = self.base().negotiator.format();
        let mut sink = |_partial: String| {};
        let mut attempt = 0u32;
        let output = loop {
            attempt += 1;
            let result = {
                let base = self.base();
                base.inference
                    .invoke_react_streaming(&base.provider, request.clone(), &mut sink)
                    .await
            };
            match result {
                Ok(output) => break output,
                Err(error) => {
                    hooks.on_model_failure(attempt, MAX_MODEL_ATTEMPTS, &error);
                    if attempt < MAX_MODEL_ATTEMPTS {
                        let backoff = (self.base().sleeper)(300 * attempt);
                        backoff.await;
                        continue;
                    }
                    hooks.on_model_exhausted();
                    return None;
                }
            }
        };

        // Score this reply against the format we requested: a clean parse in
        // the requested format resets the streak; anything else moves the
        // negotiator toward requesting JSON.
        let parse_outcome = self.base().response_kind.parsed_format(&output.raw_text);
        let base = self.base_mut();
        base.negotiator
            .record(parse_outcome.honors(requested_format));
        let next_format = base.negotiator.format();
        if next_format != requested_format {
            let failures = base.negotiator.consecutive_failures();
            hooks.on_format_escalated(requested_format, next_format, failures);
        }
        Some(output)
    }

    /// One model attempt: no retry, no negotiator feedback, no hooks. For
    /// best-effort internal calls (compaction, rolling summaries) and one-shot
    /// phases.
    #[allow(async_fn_in_trait)]
    async fn call_model_once(
        &self,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        let base = self.base();
        base.inference.invoke_react(&base.provider, request).await
    }

    /// Execute one tool by name. Never errors: an unbound name yields the
    /// structured allowlist rejection, and a binding failure becomes an
    /// `ok: false` result — the reference's "never raises, returns error
    /// string" contract.
    #[allow(async_fn_in_trait)]
    async fn execute_tool(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        name: &str,
        args: &Value,
    ) -> ToolResult {
        let base = self.base();
        let Some(binding) = base.tools.get(name) else {
            return disallowed_tool_result(&call_id, name, &base.tools.names());
        };
        match binding(snapshot, args).await {
            Ok(content) => ToolResult {
                call_id,
                ok: true,
                content,
            },
            Err(content) => ToolResult {
                call_id,
                ok: false,
                content,
            },
        }
    }

    /// Execute every call from one model turn concurrently and feed the
    /// observations back in call order.
    ///
    /// Each call runs against its own clone of `snapshot` (cooperative
    /// concurrency on the one event loop — the futures must not alias one
    /// `&mut`); the clone's `agent_memories` is the single mutation that
    /// survives, merged back in call order so a sub-agent delegation's rolling
    /// summary reaches the parent. Tool output is untrusted DATA: the shell
    /// rules on each result via [`EngineHooks::on_tool_finished`], and an
    /// accepted observation enters the conversation as evidence, never as an
    /// instruction.
    ///
    /// Returns `false` when a verdict aborted the loop.
    #[allow(async_fn_in_trait)]
    async fn dispatch_tools<H: EngineHooks>(
        &mut self,
        snapshot: &mut AppSnapshot,
        calls: Vec<ParsedToolCall>,
        hooks: &mut H,
    ) -> bool {
        let mut prepared: Vec<(String, ParsedToolCall)> = Vec::with_capacity(calls.len());
        for call in calls {
            let call_id = Uuid::new_v4().to_string();
            let allowed = self.base().tools.contains(&call.name);
            hooks.on_tool_prepared(&call_id, &call, allowed);
            prepared.push((call_id, call));
        }

        // Build one future per call (each owns its snapshot clone), then drive
        // them together; `join_all` yields outputs in input order = call order.
        let dispatched: Vec<(ToolResult, Vec<AgentMemory>)> = {
            let this = &*self;
            let futures = prepared.iter().map(|(call_id, call)| {
                let mut call_snapshot = snapshot.clone();
                let call_id = call_id.clone();
                let name = call.name.clone();
                let args = call.args.clone();
                async move {
                    let result = this
                        .execute_tool(&mut call_snapshot, call_id, &name, &args)
                        .await;
                    (result, call_snapshot.agent_memories)
                }
            });
            join_in_order(futures).await
        };

        let mut memory_batches: Vec<Vec<AgentMemory>> = Vec::with_capacity(dispatched.len());
        let mut results: Vec<ToolResult> = Vec::with_capacity(dispatched.len());
        for (result, memories) in dispatched {
            results.push(result);
            memory_batches.push(memories);
        }

        let mut aborted = false;
        for ((_, call), result) in prepared.iter().zip(results) {
            match hooks.on_tool_finished(&call.name, &result) {
                ToolVerdict::Accept => {
                    self.append_history(
                        hooks,
                        "tool",
                        format!("{} -> {}", call.name, result.content),
                    );
                }
                ToolVerdict::Reject { feedback } => {
                    self.append_history(hooks, "user", feedback);
                }
                ToolVerdict::Abort => {
                    aborted = true;
                    break;
                }
            }
        }

        // Merge each call's surfaced memory delta into the real snapshot, in
        // call order (later calls win on the same agent).
        merge_agent_memories(&mut snapshot.agent_memories, memory_batches);
        !aborted
    }
}
