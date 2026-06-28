//! Shell-side builders for the core engine: translate the selected agent and
//! snapshot state into a [`BaseEngine`], and assemble the finalized allowlist
//! into a [`ToolSet`] — one `Rc<dyn Tool>` per name, the paradigm chosen here
//! (a compiled `RustTool`, an `McpTool` bound to a live server, an `EngineTool`
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
/// run start; an `agent_<slug>` becomes an `EngineTool` carrying its target agent
/// id; a compiled built-in becomes a [`RustTool`] wrapping its real handler. The
/// loop then dispatches every one of them polymorphically through
/// [`crate::core::Tool::call`] — the kind is decided once, here, when the set is
/// built, never branched on in the hot path. Membership still IS the allowlist
/// gate, so an allow-listed name with no resolved paradigm keeps an entry that
/// rejects the call with the structured unknown-tool error.
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
        // Peer-agent delegation: the engine-as-a-tool, carrying its resolved
        // target agent id (resolved lazily against the live snapshot at call time).
        if let Some(agent_id) = crate::tools::agent_tools::resolve(snapshot, name) {
            set.insert(Rc::new(crate::tools::engine_tool::EngineTool::for_agent(
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
        // Allow-listed but unresolved (not MCP, not an agent, not a compiled
        // built-in): keep the entry so membership stays the allowlist gate, and
        // reject the call with the same structured "unknown compiled tool" error
        // the legacy executor dispatch produced — byte-identical content.
        set.insert(Rc::new(RustTool::new(spec_for(name), unknown_tool(name))));
    }
    set
}

/// Wrap a compiled tool's `fn`-pointer handler as a core [`ToolBinding`], so a
/// built-in becomes an ordinary [`RustTool`] in the set.
fn rust_binding(handler: crate::tools::ToolHandler) -> ToolBinding {
    Rc::new(move |snapshot, args| handler(snapshot, args))
}

/// A binding for an allow-listed name with no resolved paradigm: reject the call
/// with the same structured "unknown compiled tool" error the legacy executor
/// dispatch produced (byte-identical content). The entry exists only so membership
/// stays the allowlist gate; the call itself can never succeed. The binding returns
/// only the result body; the core engine owns the `ToolResult` envelope.
fn unknown_tool(name: &str) -> ToolBinding {
    let name = name.to_string();
    Rc::new(move |_snapshot, _args| {
        let name = name.clone();
        Box::pin(async move {
            Err(crate::error::EngineError::Tool(format!("Unknown compiled tool: {name}")).into())
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

use crate::core::event::{InstanceName, SignalKind};
use crate::core::{AnswerVerdict, EngineHooks, ToolVerdict};
use crate::responses::{ParsedToolCall, ReActResponse, ResponseFormat};
use crate::state::{
    AgentEventKind, AgentRun, RunArtifact, RunStatus, ScratchpadObservation, ToolCall, ToolResult,
    event, merge_artifacts,
};

use super::{
    RunSession, push_observation, truncate, try_finalize_answer, validate_tool_result_or_feedback,
};

/// Whether a tool's result is captured into the run's live-output ring (see
/// [`super::output_capture`]). These are the code-execution tools whose stdout is
/// the run's ground-truth output a verify phase reads back; every other tool's
/// result is recorded as a normal observation only.
fn is_execution_tool(name: &str) -> bool {
    matches!(name, "run_js" | "run_command" | "run_python")
}

/// The Signal SINK threaded alongside the observer: a borrowed, paradigm-pure
/// callback the engine/hook layer pushes `(instance, kind)` pairs into. It is
/// deliberately *not* a full [`crate::core::event::Signal`] — the hook layer must
/// stay pure (no clock, no `seq`/`ts`/`run_id` assignment), so it emits only the
/// two fields it actually knows. The worker boundary owns the rest (see
/// [`crate::worker::runtime`]). `None` for every non-worker caller, which keeps
/// the inline/host observer path byte-for-byte intact.
///
/// On the worker path the sink is now AUTHORITATIVE: the worker runtime stamps
/// each `(instance, kind)` into a full [`crate::core::event::Signal`], the
/// page-side [`crate::runtime::RunReducer`] folds the stream back into a
/// renderable `AgentRun`, and a terminal snapshot reconcile fills the rest.
/// Because the bus carries the live view there, [`RunHooks::observe`] skips its
/// full-`AgentRun` clone+push whenever this sink is `Some` (the Phase-2 cutover).
pub(super) type SignalSink<'a> = Option<&'a mut (dyn FnMut(InstanceName, SignalKind) + 'static)>;

/// The shell's [`EngineHooks`] implementation: everything the legacy loop did
/// *around* the model call — run events, observer notifications, validators,
/// memory compaction, the interrupt flag, run bookkeeping — implemented once
/// against the live [`AgentRun`], so the core loop stays pure. Event titles
/// and message strings are byte-identical to the pre-migration loop.
pub(super) struct RunHooks<'a, 's, F: FnMut(AgentRun)> {
    /// The loop's init-time state: identity, validators, compaction deps.
    pub(super) agent_loop: &'a RunSession,
    /// The live run this invoke is driving.
    pub(super) run: &'a mut AgentRun,
    /// UI notification callback, fired after every observable state change.
    pub(super) observer: &'a mut F,
    /// The parallel Signal sink (DUAL-EMIT). `Some` only on the worker path; the
    /// hook emits `(instance, kind)` pairs into it *in addition to* — never
    /// instead of — the observer/event push above. `None` keeps the legacy
    /// observer-only behavior unchanged. Its lifetime `'s` is deliberately
    /// distinct from `'a`: the caller threads one long-lived sink across many
    /// short-lived per-phase `RunHooks`, so binding it to the run/observer borrow
    /// would over-extend those borrows and block their reuse after the phase.
    pub(super) signal: SignalSink<'s>,
    /// Global turns taken before this invoke; the engine's local turn numbers
    /// add onto it for event numbering and the step-budget bookkeeping.
    pub(super) steps_before: u32,
    /// How many of `run.scratchpad.artifacts` have already been emitted as
    /// `ArtifactAppended` signals. Seeded from the run's current artifact count
    /// when the hooks are built (so a fresh invoke does not re-emit artifacts a
    /// prior phase already announced), then advanced as new artifacts appear.
    pub(super) artifacts_emitted: usize,
}

impl<F: FnMut(AgentRun)> RunHooks<'_, '_, F> {
    fn agent_id(&self) -> String {
        self.agent_loop.agent_id.clone()
    }

    /// The emitting component's stable bus address: the running engine's
    /// [`crate::core::BaseEngine`] `name`, which `build_base_engine` sets from
    /// the agent's display name. (Sub-agent instance refinement is a later phase.)
    fn instance(&self) -> InstanceName {
        InstanceName(self.agent_loop.agent.name.clone())
    }

    /// Push the current run to the legacy observer — the live-snapshot stream on
    /// the inline/host path. When a Signal sink is wired (the worker path) the bus
    /// is authoritative: the page rebuilds the live view from the Signal stream
    /// and a terminal snapshot reconcile, so this full-`AgentRun` clone+push is
    /// redundant. Skipping it is the Phase-2 cutover — it drops the hot-path clone
    /// the run used to pay on every observable state change. With no sink the
    /// observer remains the sole live stream, byte-for-byte unchanged.
    fn observe(&mut self) {
        if self.signal.is_some() {
            return;
        }
        (self.observer)(self.run.clone());
    }

    /// Push one delta onto the Signal bus (DUAL-EMIT). A no-op when the sink is
    /// `None`. The hook supplies only `(instance, kind)`; the worker boundary
    /// stamps `seq`/`ts_ms`/`run_id` and posts the full
    /// [`crate::core::event::Signal`].
    fn emit(&mut self, kind: SignalKind) {
        let instance = self.instance();
        if let Some(sink) = self.signal.as_deref_mut() {
            sink(instance, kind);
        }
    }
}

impl<F: FnMut(AgentRun)> EngineHooks for RunHooks<'_, '_, F> {
    fn interrupted(&self) -> bool {
        // Per-instance: consult only THIS run's flag, so a Stop on one fleet
        // instance never halts another.
        super::interrupt_requested(&crate::state::RunId::from(self.run.id.clone()))
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

    async fn workspace_block(&self) -> String {
        // Build the `## WORKSPACE` block from THIS run's live open-set: the OPFS tree,
        // each open file's CURRENT content, and the live-output tail. Empty when the
        // agent has nothing open (keeps the prompt byte-identical to legacy).
        super::workspace_block::build_workspace_block(&self.run.id, &self.run.scratchpad.workspace)
            .await
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
        // DUAL-EMIT: the steps counter advanced, and a model request is going out.
        self.emit(SignalKind::StepsUsedSet {
            steps_used: global_turn,
        });
        self.emit(SignalKind::LlmRequest);
    }

    fn on_model_delta(&mut self, partial: &str) {
        // Stream the reply forming live: stash the parsed partial as the run's
        // streaming preview (the inline path renders it via `observe`) and emit it
        // on the bus (the worker path) so the page folds it into the live view.
        self.run.scratchpad.streaming = Some(partial.to_string());
        self.observe();
        self.emit(SignalKind::LlmDelta {
            text: partial.to_string(),
        });
    }

    fn on_model_response(&mut self, turn: u32, _raw_text: &str, parsed: &ReActResponse) {
        // The full turn landed; drop the streaming preview — the real text replaces it.
        self.run.scratchpad.streaming = None;
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
        // DUAL-EMIT: the model's turn text (matches the legacy LlmResponse body).
        self.emit(SignalKind::LlmResponse {
            text: truncate(&thinking, 600),
        });
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
        // DUAL-EMIT: a (possibly-retried) model attempt failed.
        self.emit(SignalKind::Error {
            message: error.to_string(),
        });
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
        // DUAL-EMIT: the run paused (resumable), then the explicit interrupt edge.
        self.emit(SignalKind::StatusSet {
            status: RunStatus::Paused,
        });
        self.emit(SignalKind::Interrupted);
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
        // DUAL-EMIT: the full appendable tool-call row, real arguments included.
        self.emit(SignalKind::ToolRequested {
            call_id: call_id.to_string(),
            name: call.name.clone(),
            arguments: call.args.clone(),
        });
    }

    fn on_artifacts_appended(&mut self, artifacts: Vec<RunArtifact>) {
        // The authoritative in-flight store for artifacts is THIS run's
        // scratchpad — the one the observer/signal bus read. A tool produced
        // these on its own snapshot clone; union them in by id (accumulate, do
        // not overwrite). The `ArtifactAppended` signals fire from the diff in
        // `on_tool_finished`, which runs right after this for the same call and
        // picks up everything past `self.artifacts_emitted`.
        merge_artifacts(&mut self.run.scratchpad.artifacts, artifacts);
    }

    fn on_workspace_changed(&mut self, view: crate::state::WorkspaceView) {
        // The authoritative open-set is THIS run's scratchpad — the source of truth
        // both the prompt block and the IDE read. A `workspace_open`/`workspace_close`
        // tool changed it on its snapshot clone; fold the new view onto the live run
        // (last-writer-wins), notify the inline/host observer, and DUAL-EMIT the
        // delta so the worker-path page rebuilds the view from the bus.
        self.run.scratchpad.workspace = view.clone();
        self.observe();
        self.emit(SignalKind::WorkspaceChanged { view });
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
        // Capture execution-tool output into this run's bounded live-output ring
        // so a LATER phase (e.g. the coder's verify gate) can read the real run
        // output via `read_run_output` — output the actor produced but a fresh
        // phase otherwise can't see. Other tools' results are not "run output".
        if is_execution_tool(name) {
            super::output_capture::capture(&self.run.id, &result.content);
        }
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
        // On Accept, an observation was just appended to
        // `recent_observations`; capture it so the bus carries the same delta.
        let mut appended_observation: Option<ScratchpadObservation> = None;
        let verdict = match feedback {
            None => {
                push_observation(self.run, name, truncate(&result.content, 400));
                appended_observation = self.run.scratchpad.recent_observations.last().cloned();
                ToolVerdict::Accept
            }
            Some(feedback) => ToolVerdict::Reject { feedback },
        };
        self.run.tool_results.push(result.clone());
        // Any artifacts the tool appended to this run's scratchpad since the last
        // tool finished (e.g. a camera/screenshot capture) — captured before the
        // observer fires so the bus carries the same append deltas. A no-op for
        // the common case where a tool adds none.
        let new_artifacts: Vec<_> = self
            .run
            .scratchpad
            .artifacts
            .iter()
            .skip(self.artifacts_emitted)
            .cloned()
            .collect();
        self.artifacts_emitted = self.run.scratchpad.artifacts.len();
        self.observe();
        // DUAL-EMIT: the settled tool result, then (on Accept) the observation
        // it produced, then any newly-appended artifacts, then (if validation
        // just turned the run terminal) the status flip — each mirroring the
        // event/observer/scratchpad pushes above.
        self.emit(SignalKind::ToolCompleted {
            call_id: result.call_id.clone(),
            ok: result.ok,
            content: truncate(&result.content, 600),
        });
        if let Some(observation) = appended_observation {
            self.emit(SignalKind::ObservationAppended { observation });
        }
        for artifact in new_artifacts {
            self.emit(SignalKind::ArtifactAppended { artifact });
        }
        if self.run.status == RunStatus::Error {
            self.emit(SignalKind::StatusSet {
                status: RunStatus::Error,
            });
        }
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
                // DUAL-EMIT: the validated final answer landed in `final_answer`,
                // and the verification gate passed.
                let final_text = self.run.final_answer.clone();
                self.emit(SignalKind::Result { final_text });
                self.emit(SignalKind::Verification { passed: true });
                AnswerVerdict::Accept
            }
            Some(feedback) => {
                self.observe();
                // DUAL-EMIT: the verification gate rejected this answer.
                self.emit(SignalKind::Verification { passed: false });
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
                    // The validation retry budget was exceeded: the run just
                    // turned terminal-Error.
                    self.emit(SignalKind::StatusSet {
                        status: RunStatus::Error,
                    });
                    return AnswerVerdict::Abort;
                }
                AnswerVerdict::Reject { feedback }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::BrowserExecutionProvider;
    use crate::engine::LoopParams;
    use crate::state::AppSnapshot;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn fresh_session_and_run() -> (RunSession, AgentRun) {
        let snapshot = AppSnapshot::default();
        let session = RunSession::new(
            BrowserExecutionProvider::new(),
            &snapshot,
            "demo goal",
            &LoopParams::default(),
        );
        let run = session.build_run("demo goal", &snapshot, &session.enabled_tools);
        (session, run)
    }

    // No Signal sink (inline / host path): the observer IS the live stream, so
    // `observe()` clones the run and fires it — byte-for-byte the legacy path.
    #[test]
    fn observe_pushes_to_the_observer_without_a_signal_sink() {
        let (session, mut run) = fresh_session_and_run();
        let calls = Rc::new(RefCell::new(0usize));
        let counter = Rc::clone(&calls);
        let mut observer = move |_run: AgentRun| {
            *counter.borrow_mut() += 1;
        };
        let artifacts_emitted = run.scratchpad.artifacts.len();
        let mut hooks = RunHooks {
            agent_loop: &session,
            run: &mut run,
            observer: &mut observer,
            signal: None,
            steps_before: 0,
            artifacts_emitted,
        };

        hooks.observe();

        assert_eq!(*calls.borrow(), 1);
    }

    // A Signal sink present (the worker path) means the bus is authoritative: the
    // page rebuilds the live view from the Signal stream, so `observe()` must NOT
    // also clone+push the whole run — that hot-path clone is exactly what the
    // cutover drops.
    #[test]
    fn observe_is_suppressed_when_a_signal_sink_is_present() {
        let (session, mut run) = fresh_session_and_run();
        let calls = Rc::new(RefCell::new(0usize));
        let counter = Rc::clone(&calls);
        let mut observer = move |_run: AgentRun| {
            *counter.borrow_mut() += 1;
        };
        let mut sink = |_instance: InstanceName, _kind: SignalKind| {};
        let artifacts_emitted = run.scratchpad.artifacts.len();
        let mut hooks = RunHooks {
            agent_loop: &session,
            run: &mut run,
            observer: &mut observer,
            signal: Some(&mut sink),
            steps_before: 0,
            artifacts_emitted,
        };

        hooks.observe();

        assert_eq!(*calls.borrow(), 0);
    }
}
