//! Shell-side builders for the core engine: translate the selected agent and
//! snapshot state into a [`BaseEngine`], and assemble the finalized allowlist
//! into a [`ToolSet`] — one `Rc<dyn Tool>` per name, the paradigm chosen here
//! (a compiled `RustTool`, an `McpTool` bound to a live server, an `AgentTool`
//! carrying a target agent id). This is the one place the shell's world
//! (snapshot, executor, MCP discovery) is converted into the core's world
//! (plain state + tools), and where the user's "maintain the set of tools" step
//! happens — once per run, before the loop ever dispatches.

use std::rc::Rc;

use crate::core::{BaseEngine, RustTool, Sleeper, ToolBinding, ToolSet};
use crate::inference::SubAgentInfo;
use crate::responses::FormatNegotiator;
use crate::state::{Agent, AppSnapshot, Message, ProviderConfig, Skill, ToolSpec};

use super::execution::{BrowserExecutionProvider, ExecutionProvider};

/// Build the engine's shared state record from init-time run state. Inference
/// attaches inside [`BaseEngine::new`] via the registry, exactly as the legacy
/// loop resolved it.
pub(super) fn build_base_engine(
    agent: &Agent,
    provider: ProviderConfig,
    soul: String,
    skills: Vec<Skill>,
    sub_agents: Vec<SubAgentInfo>,
    conversation: Vec<Message>,
) -> BaseEngine {
    let mut base = BaseEngine::new(provider);
    base.name = agent.name.clone();
    base.description = agent.role.clone();
    base.soul = soul;
    base.skills = skills;
    base.sub_agents = sub_agents;
    base.conversation = conversation;
    base.negotiator = FormatNegotiator::new(agent.response_format);
    base.sleeper = platform_sleeper();
    base
}

/// Assemble the finalized allowlist into the run's [`ToolSet`]: for each enabled
/// name, build the concrete `Rc<dyn Tool>` for its paradigm and insert it. An
/// MCP-backed name becomes an `McpTool` bound to the live server brought up at
/// run start; an `agent_<slug>` becomes an `AgentTool` carrying its target agent
/// id; a compiled built-in becomes a [`RustTool`] wrapping its real handler. The
/// loop then dispatches every one of them polymorphically through
/// [`crate::core::Tool::call`] — the kind is decided once, here, when the set is
/// built, never branched on in the hot path. Membership still IS the allowlist
/// gate, so an allow-listed name with no resolved paradigm keeps an entry that
/// defers to the executor (the legacy unknown-tool behavior).
pub(super) fn build_tool_set(
    executor: &BrowserExecutionProvider,
    snapshot: &AppSnapshot,
    enabled_tools: &[String],
) -> ToolSet {
    // Every advertised spec across all sources — the same merge the run uses for
    // the model's tool manifest — so each tool we build carries its real spec.
    let mut specs = executor.domain_specs_for_agent(enabled_tools);
    specs.extend(crate::tools::agent_tools::specs_for_agent(
        snapshot,
        enabled_tools,
    ));
    let spec_for = |name: &str| -> ToolSpec {
        specs
            .iter()
            .find(|spec| spec.name == name)
            .cloned()
            .unwrap_or_else(|| ToolSpec {
                name: name.to_string(),
                description: String::new(),
                input_schema: serde_json::Value::Null,
            })
    };

    let mut set = ToolSet::default();
    for name in enabled_tools {
        // MCP-backed: route to the live server's client. The server environment
        // was already started when the run brought enabled servers up. One scan
        // answers both "is it MCP?" and "which paradigm?" — tool-host servers run
        // user JavaScript functions (`Js`); every other live server is `Mcp`.
        #[cfg(target_arch = "wasm32")]
        if let Some(paradigm) = crate::mcp::registry::classify_mcp_tool(name) {
            set.insert(Rc::new(crate::mcp::registry::McpTool::new(
                spec_for(name),
                paradigm,
            )));
            continue;
        }
        // Peer-agent delegation: carries its resolved target agent id.
        if let Some(agent_id) = crate::tools::agent_tools::resolve(snapshot, name) {
            set.insert(Rc::new(crate::tools::agent_tools::AgentTool::new(
                spec_for(name),
                agent_id,
            )));
            continue;
        }
        // Compiled built-in: wrap the real handler so the call runs directly.
        if let Some(descriptor) = executor.compiled_descriptor(name) {
            set.insert(Rc::new(RustTool::new(
                descriptor.spec,
                rust_binding(descriptor.handler),
            )));
            continue;
        }
        // Allow-listed but unresolved: keep the entry (membership IS the gate)
        // and defer to the executor, which yields the structured "unknown tool"
        // error — identical to the pre-composition behavior.
        set.insert(Rc::new(RustTool::new(
            spec_for(name),
            executor_fallback(executor, name),
        )));
    }
    set
}

/// Wrap a compiled tool's `fn`-pointer handler as a core [`ToolBinding`], so a
/// built-in becomes an ordinary [`RustTool`] in the set.
fn rust_binding(handler: crate::tools::ToolHandler) -> ToolBinding {
    Rc::new(move |snapshot, args| handler(snapshot, args))
}

/// A binding for an allow-listed name with no resolved paradigm: defer to the
/// executor's domain dispatch. The binding returns only the result body; the
/// core engine owns the `ToolResult` envelope and assigns the call id.
fn executor_fallback(executor: &BrowserExecutionProvider, name: &str) -> ToolBinding {
    let executor = executor.clone();
    let name = name.to_string();
    Rc::new(move |snapshot, args| {
        let executor = executor.clone();
        let name = name.clone();
        let args = args.clone();
        Box::pin(async move {
            let result = executor
                .execute_domain_tool(snapshot, String::new(), &name, args)
                .await;
            if result.ok {
                Ok(result.content)
            } else {
                Err(result.content)
            }
        })
    })
}

/// Cooperative retry backoff in the browser: a real event-loop timer.
#[cfg(target_arch = "wasm32")]
fn platform_sleeper() -> Sleeper {
    Rc::new(|ms| {
        Box::pin(async move {
            gloo_timers::future::TimeoutFuture::new(ms).await;
        })
    })
}

/// On the host test runner there is no event-loop timer; yield immediately,
/// matching the legacy `backoff` no-op.
#[cfg(not(target_arch = "wasm32"))]
fn platform_sleeper() -> Sleeper {
    crate::core::noop_sleeper()
}

use crate::core::{AnswerVerdict, EngineHooks, ToolVerdict};
use crate::responses::{ParsedToolCall, ReActResponse, ResponseFormat};
use crate::state::{AgentEventKind, AgentRun, RunStatus, ToolCall, ToolResult, event};

use super::{
    RunSession, push_observation, truncate, try_finalize_answer, validate_tool_result_or_feedback,
};

/// The shell's [`EngineHooks`] implementation: everything the legacy loop did
/// *around* the model call — run events, observer notifications, validators,
/// memory compaction, the interrupt flag, run bookkeeping — implemented once
/// against the live [`AgentRun`], so the core loop stays pure. Event titles
/// and message strings are byte-identical to the pre-migration loop.
pub(super) struct RunHooks<'a, F: FnMut(AgentRun)> {
    /// The loop's init-time state: identity, validators, compaction deps.
    pub(super) agent_loop: &'a RunSession,
    /// The live run this invoke is driving.
    pub(super) run: &'a mut AgentRun,
    /// UI notification callback, fired after every observable state change.
    pub(super) observer: &'a mut F,
    /// Global turns taken before this invoke; the engine's local turn numbers
    /// add onto it for event numbering and the step-budget bookkeeping.
    pub(super) steps_before: u32,
}

impl<F: FnMut(AgentRun)> RunHooks<'_, F> {
    fn agent_id(&self) -> String {
        self.agent_loop.agent_id.clone()
    }

    fn observe(&mut self) {
        (self.observer)(self.run.clone());
    }
}

impl<F: FnMut(AgentRun)> EngineHooks for RunHooks<'_, F> {
    fn interrupted(&self) -> bool {
        super::interrupt_requested()
    }

    async fn before_turn(&mut self, history: &mut Vec<crate::state::Message>) {
        // Compaction operates on the run's transcript (its model call, events,
        // and persistence all live shell-side); when it rewrites the messages,
        // resync the engine's mirror so the next render sees the compact form.
        let changed = self.agent_loop.maybe_compact(self.run, self.observer).await;
        if changed {
            *history = self.run.messages.clone();
        }
    }

    fn on_turn_start(&mut self, turn: u32, conversation_len: usize, history_len: usize) {
        let global_turn = self.steps_before + turn;
        self.run.scratchpad.budgets.steps_used = global_turn;
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::LlmRequest,
            format!("Model call (turn {global_turn})"),
            format!(
                "Sending {conversation_len} prior conversation message(s), the query, and {history_len} in-run message(s)."
            ),
        ));
        self.observe();
    }

    fn on_model_response(&mut self, turn: u32, _raw_text: &str, parsed: &ReActResponse) {
        let global_turn = self.steps_before + turn;
        let thinking = if parsed.thinking.trim().is_empty() {
            parsed.observation.clone()
        } else {
            parsed.thinking.clone()
        };
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::LlmResponse,
            format!("Model responded (turn {global_turn})"),
            truncate(&thinking, 600),
        ));
        if !thinking.trim().is_empty() {
            push_observation(self.run, &self.agent_loop.agent.name, thinking);
        }
    }

    fn on_model_failure(&mut self, attempt: u32, max_attempts: u32, error: &str) {
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::Error,
            format!("Model call failed (attempt {attempt}/{max_attempts})"),
            error.to_string(),
        ));
        self.observe();
    }

    fn on_model_exhausted(&mut self) {
        // Every attempt failed: pause the run (resumable, not hard-errored) so
        // the app and conversation stay intact and the user can Resume.
        self.run.status = RunStatus::Paused;
        if self.run.final_answer.trim().is_empty() {
            self.run.final_answer = "Paused: the model provider could not be reached after several attempts. Check the Provider settings, then press Resume to continue.".to_string();
        }
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::Interrupted,
            "Run paused (provider unreachable)",
            truncate(&self.run.final_answer, 300),
        ));
        self.observe();
    }

    fn on_format_escalated(&mut self, from: ResponseFormat, to: ResponseFormat, failures: u32) {
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::Routing,
            "Response format escalated",
            format!(
                "Requesting {} after {} consecutive parse failure(s) on {}.",
                to.as_form_value(),
                failures,
                from.as_form_value()
            ),
        ));
    }

    fn on_history_appended(&mut self, message: &crate::state::Message) {
        // The run's transcript mirrors the engine's history one-to-one; this
        // funnel is the only place loop messages enter the run.
        self.run.messages.push(message.clone());
        self.observe();
    }

    fn on_tool_prepared(&mut self, call_id: &str, call: &ParsedToolCall, _allowed: bool) {
        self.run.tool_calls.push(ToolCall {
            id: call_id.to_string(),
            agent_id: self.agent_id(),
            tool_name: call.name.clone(),
            arguments: call.args.clone(),
        });
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            AgentEventKind::ToolRequested,
            format!("Tool requested: {}", call.name),
            truncate(&call.args.to_string(), 400),
        ));
        self.observe();
    }

    fn on_tool_finished(&mut self, name: &str, result: &ToolResult) -> ToolVerdict {
        let kind = if result.ok {
            AgentEventKind::ToolCompleted
        } else {
            AgentEventKind::Error
        };
        self.run.events.push(event(
            &self.run.id,
            Some(self.agent_id()),
            kind,
            format!(
                "Tool {}: {}",
                if result.ok { "completed" } else { "failed" },
                name
            ),
            truncate(&result.content, 600),
        ));
        // Tool output is untrusted DATA: a validated result enters the
        // conversation as evidence (Accept → the core appends it); a rejected
        // one re-enters as structured feedback instead (Reject).
        let feedback = validate_tool_result_or_feedback(
            &self.agent_loop.validators,
            self.run,
            Some(self.agent_id()),
            name,
            result,
        );
        let verdict = match feedback {
            None => {
                push_observation(self.run, name, truncate(&result.content, 400));
                ToolVerdict::Accept
            }
            Some(feedback) => ToolVerdict::Reject { feedback },
        };
        self.run.tool_results.push(result.clone());
        self.observe();
        if self.run.status == RunStatus::Error {
            // Terminal (validation retry budget exceeded). Keep the legacy
            // transcript shape: the rejected result's feedback message still
            // lands, even though the loop stops here. Bypassing the engine's
            // history funnel is sound only because this path is terminal —
            // the engine is dropped when the strategy stops on `None`, and a
            // Resume builds a fresh engine seeded from `run.messages`.
            if let ToolVerdict::Reject { feedback } = verdict {
                self.run.messages.push(crate::state::Message {
                    role: "user".to_string(),
                    content: feedback,
                });
            }
            return ToolVerdict::Abort;
        }
        verdict
    }

    fn on_answer(&mut self, text: &str, no_parsed_call: bool) -> AnswerVerdict {
        // The two call sites differ only in the event title, exactly as the
        // legacy loop's two `try_finalize_answer` call sites did.
        let title = if no_parsed_call {
            "Final answer (no tool call parsed)"
        } else {
            "Final answer"
        };
        match try_finalize_answer(
            &self.agent_loop.validators,
            self.run,
            &self.agent_loop.agent_id,
            text,
            title,
        ) {
            None => {
                self.observe();
                AnswerVerdict::Accept
            }
            Some(feedback) => {
                self.observe();
                if self.run.status == RunStatus::Error {
                    // Terminal: keep the legacy transcript shape (feedback
                    // message recorded) even though the loop stops here.
                    // Bypassing the engine's history funnel is sound only on
                    // this terminal path — the engine is dropped when the
                    // strategy stops, and Resume reseeds from `run.messages`.
                    self.run.messages.push(crate::state::Message {
                        role: "user".to_string(),
                        content: feedback,
                    });
                    return AnswerVerdict::Abort;
                }
                AnswerVerdict::Reject { feedback }
            }
        }
    }
}
