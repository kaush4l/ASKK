//! [`InstancePanel`] — the **per-instance agent slot**, the literal realization of
//! the fleet vision: every engine instance gets an identical panel, and the fleet
//! renders exactly one per instance by mapping over the live collection.
//!
//! A panel takes ONE instance's data — its id, status, and projected [`AgentRun`]
//! — and renders that run's view: a header (label / lane / status pill), the live
//! phase line while it works, its clean ReAct event log, and a per-instance Stop
//! control that interrupts only this run by id. The panel is **read-only over the
//! projection**: it never mutates the instance, so N panels over N instances can't
//! interfere with one another. A failed / interrupted instance renders that state
//! in its header and a banner; the controls hide once the run is terminal.
//!
//! ## Why a separate component (vs. `ConversationTurn`)
//! `chat_panel`'s `ConversationTurn` renders a turn in *conversation* framing (user
//! bubble → assistant bubble), threaded into a single session transcript. The fleet
//! needs the *instance* framing instead: one self-contained card per run, addressed
//! by id, with its own controls — the building blocks (the ReAct step log mapping,
//! the working/error label helpers) are shared as pure functions
//! ([`view`](self::view)) so the two surfaces don't drift.

use dioxus::prelude::*;

use crate::state::{AgentRun, EngineInstance, RunStatus};

use self::view::{PanelInputs, react_steps, working_label};

/// One engine instance rendered as an identical panel slot. Reads ONLY this
/// instance's projection (the [`AgentRun`]) plus its id/status — never mutating it
/// — so a fleet of these is just a map over the collection.
///
/// `live_controls` gates the per-instance Stop button: the live fleet passes `true`
/// so a running instance can be interrupted by id; a static render (or the host
/// test path) passes `false`. The button is additionally hidden once the run is
/// terminal, so the flag only matters while the run is live.
#[component]
pub fn InstancePanel(instance: EngineInstance, live_controls: bool) -> Element {
    let inputs = PanelInputs::from_instance(&instance);
    let run = instance.projection;
    let run_id = inputs.id.clone();
    let running = inputs.status == RunStatus::Running;
    let show_stop = live_controls && running;

    rsx! {
        article { class: "fleet-card", key: "{inputs.id}",
            header { class: "fleet-card-head",
                // SectionHeading look: the run label as heading, lane as a soft sub-tag.
                div { class: "fleet-heading",
                    span { class: "fleet-card-label", "{inputs.label}" }
                    span { class: "fleet-card-lane", "{inputs.lane}" }
                }
                div { class: "fleet-card-controls",
                    StatusPill { status: inputs.status }
                    if show_stop {
                        button {
                            class: "fleet-stop",
                            onclick: move |_| stop_instance(&run_id),
                            "Stop"
                        }
                    }
                }
            }

            // The live phase line while the run is actively working — what it is
            // doing right now ("Phase: review", "calling tool…").
            if running {
                p { class: "fleet-working",
                    if let Some(phase) = inputs.phase.as_ref() {
                        "{phase}"
                    } else {
                        "{working_label(&run)}"
                    }
                }
            }

            // A terminal banner so a failed / interrupted instance reads its own state.
            match inputs.status {
                RunStatus::Error => rsx! {
                    p { class: "fleet-banner fleet-banner-error", "{inputs.error}" }
                },
                RunStatus::Interrupted => rsx! {
                    p { class: "fleet-banner fleet-banner-interrupted", "Run interrupted." }
                },
                _ => rsx! {},
            }

            // The final answer (or provisional answer) once any has formed.
            if !run.final_answer.trim().is_empty() {
                p { class: "fleet-answer", "{run.final_answer}" }
            }

            // This instance's clean ReAct event log — its own steps only.
            InstanceEventLog { run: run.clone() }
        }
    }
}

/// The status pill — a soft pill mirroring the run's lifecycle status, with a
/// StatusDot leading the label (Badge + StatusDot look). The dot and pill share
/// the state's tint via `currentColor`, so the colour-key lives in one modifier.
#[component]
fn StatusPill(status: RunStatus) -> Element {
    let (modifier, label) = match status {
        RunStatus::Running => ("fleet-status-running", "running"),
        RunStatus::Paused => ("fleet-status-paused", "paused"),
        RunStatus::Complete => ("fleet-status-complete", "complete"),
        RunStatus::Unverified => ("fleet-status-unverified", "unverified"),
        RunStatus::Error => ("fleet-status-error", "error"),
        RunStatus::Interrupted => ("fleet-status-interrupted", "interrupted"),
    };
    rsx! {
        span { class: "fleet-status {modifier}",
            span { class: "fleet-status-dot" }
            "{label}"
        }
    }
}

/// This instance's ReAct step log — the same readable flow `chat_panel` shows, but
/// scoped to this one run and rendered inline (no conversation framing).
#[component]
fn InstanceEventLog(run: AgentRun) -> Element {
    let steps = react_steps(&run);
    rsx! {
        if steps.is_empty() {
            div { class: "empty-state fleet-empty", "No steps yet." }
        } else {
            div { class: "fleet-log scroll-area",
                for step in steps.iter() {
                    article { class: "fleet-log-row {step.css}", key: "{step.key}",
                        div { class: "fleet-log-row-head",
                            span { class: "fleet-log-label", "{step.label}" }
                            span { class: "fleet-log-title", "{step.title}" }
                        }
                        if !step.body.is_empty() {
                            pre { "{step.body}" }
                        }
                    }
                }
            }
        }
    }
}

/// Interrupt only this instance by id, leaving every other live run untouched.
fn stop_instance(run_id: &str) {
    crate::worker::client::request_run_cancel(run_id, "user requested stop");
}

/// Pure, host-testable view projection: the inputs a panel renders from, derived
/// read-only from an [`EngineInstance`]. Kept free of Dioxus so the
/// collection→ordered-inputs mapping and the per-run step projection are unit-tested
/// on the host (where the rsx surface can't run), and so the same projection logic
/// can't drift between `instance_panel` and `chat_panel`.
pub mod view {
    use crate::state::{AgentEventKind, AgentRun, EngineInstance, InstanceCollection, RunStatus};

    /// The read-only inputs one [`InstancePanel`](super::InstancePanel) renders from,
    /// projected out of an instance. Carrying these as a value (rather than reading
    /// fields ad hoc in the view) is what makes the mapping host-testable.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct PanelInputs {
        /// The instance's stable id (the run id).
        pub id: String,
        /// Human label for the panel header — the run's goal, trimmed to a line.
        pub label: String,
        /// The run's routed lane label.
        pub lane: String,
        /// The run's lifecycle status.
        pub status: RunStatus,
        /// The active phase name while running (newest `PhaseStarted`), if any.
        pub phase: Option<String>,
        /// The last error message, for a failed run (empty otherwise).
        pub error: String,
    }

    impl PanelInputs {
        /// Project a panel's inputs from one instance — read-only.
        pub fn from_instance(instance: &EngineInstance) -> Self {
            let run = &instance.projection;
            PanelInputs {
                id: instance.id.as_str().to_string(),
                label: header_label(run),
                lane: run.lane.as_label().to_string(),
                // Read the authoritative projection status (not the cached field),
                // matching `EngineInstance::is_live`.
                status: run.status,
                phase: active_phase(run),
                error: last_error(run),
            }
        }
    }

    /// Map a whole collection to the ordered panel inputs the fleet renders — one
    /// per instance, in the collection's chronological (spawn/queue) order. This is
    /// the literal "one identical slot per instance" mapping, pulled out as a pure
    /// function so the ordering contract is host-tested.
    pub fn panel_inputs(collection: &InstanceCollection) -> Vec<PanelInputs> {
        collection.iter().map(PanelInputs::from_instance).collect()
    }

    /// One rendered ReAct step: the projected view of a logged event.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct ReactStep {
        /// Stable key for the rendered list (the event id).
        pub key: String,
        /// Short step label ("LLM call", "Tool result", …).
        pub label: &'static str,
        /// CSS modifier keying the step's accent.
        pub css: &'static str,
        /// The event title.
        pub title: String,
        /// The step body (empty when hidden or blank).
        pub body: String,
    }

    /// Project a run's events into the clean ReAct step log — the same flow
    /// `chat_panel`'s `RunDetails` shows (LLM call → response → tool call/result →
    /// answer, errors inline), shared so the two surfaces can't drift.
    pub fn react_steps(run: &AgentRun) -> Vec<ReactStep> {
        run.events
            .iter()
            .filter_map(|event| {
                let (label, css) = log_step(&event.kind)?;
                let body = if step_shows_body(&event.kind) && !event.body.trim().is_empty() {
                    event.body.clone()
                } else {
                    String::new()
                };
                Some(ReactStep {
                    key: event.id.clone(),
                    label,
                    css,
                    title: event.title.clone(),
                    body,
                })
            })
            .collect()
    }

    /// The header label for a run: its goal collapsed to a single line, falling back
    /// to the run id when the goal is blank.
    fn header_label(run: &AgentRun) -> String {
        let goal = run.goal.trim();
        if goal.is_empty() {
            run.id.clone()
        } else {
            goal.lines().next().unwrap_or(goal).trim().to_string()
        }
    }

    /// The active phase name (newest `PhaseStarted` event), only meaningful while a
    /// run is `Running`. Returns `None` for a clean (no-phase) or finished run.
    fn active_phase(run: &AgentRun) -> Option<String> {
        if run.status != RunStatus::Running {
            return None;
        }
        run.events
            .iter()
            .rev()
            .find(|event| event.kind == AgentEventKind::PhaseStarted)
            .map(|event| event.title.clone())
    }

    /// The working line for a live run with no streamed text yet — the newest
    /// non-empty event title, or a generic fallback.
    pub fn working_label(run: &AgentRun) -> String {
        run.events
            .iter()
            .rev()
            .find(|event| !event.title.trim().is_empty())
            .map(|event| format!("{}…", event.title))
            .unwrap_or_else(|| "Working…".to_string())
    }

    /// The last error body for a failed run, or a generic fallback.
    fn last_error(run: &AgentRun) -> String {
        run.events
            .iter()
            .rev()
            .find(|event| event.kind == AgentEventKind::Error)
            .map(|event| event.body.clone())
            .unwrap_or_else(|| "Run failed.".to_string())
    }

    /// Map an event to its place in the clean ReAct log: `(label, css class)`, or
    /// `None` to hide it. Mirrors `chat_panel::log_step`.
    fn log_step(kind: &AgentEventKind) -> Option<(&'static str, &'static str)> {
        match kind {
            AgentEventKind::LlmRequest => Some(("LLM call", "step-llm-call")),
            AgentEventKind::LlmResponse => Some(("Response", "step-llm-response")),
            AgentEventKind::ToolRequested => Some(("Tool call", "step-tool-call")),
            AgentEventKind::ToolCompleted => Some(("Tool result", "step-tool-result")),
            AgentEventKind::McpConnected => Some(("MCP", "step-mcp")),
            AgentEventKind::McpToolsListed => Some(("MCP tools", "step-mcp")),
            AgentEventKind::FinalAnswer => Some(("Answer", "step-answer")),
            AgentEventKind::Error => Some(("Error", "step-error")),
            AgentEventKind::Interrupted => Some(("Interrupted", "step-error")),
            AgentEventKind::Started
            | AgentEventKind::Routing
            | AgentEventKind::MetaTool
            | AgentEventKind::Workflow
            | AgentEventKind::PhaseStarted
            | AgentEventKind::PhaseCompleted
            | AgentEventKind::MemoryCompacted
            | AgentEventKind::RollingSummaryUpdated
            | AgentEventKind::Verification
            | AgentEventKind::WorkerStarted
            | AgentEventKind::WorkerCompleted => None,
        }
    }

    /// The `LLM call` step's body is just bookkeeping; every other step's body is
    /// worth showing. Mirrors `chat_panel::step_shows_body`.
    fn step_shows_body(kind: &AgentEventKind) -> bool {
        !matches!(kind, AgentEventKind::LlmRequest)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::state::event;

        fn run(id: &str, goal: &str, status: RunStatus) -> AgentRun {
            AgentRun {
                id: id.to_string(),
                goal: goal.to_string(),
                status,
                lane: Default::default(),
                scratchpad: Default::default(),
                messages: Vec::new(),
                events: Vec::new(),
                tool_calls: Vec::new(),
                tool_results: Vec::new(),
                final_answer: String::new(),
                created_at: "now".to_string(),
            }
        }

        #[test]
        fn panel_inputs_preserve_collection_order_one_per_instance() {
            let mut collection = InstanceCollection::new();
            collection.upsert_run(run("a", "first goal", RunStatus::Complete));
            collection.upsert_run(run("b", "second goal", RunStatus::Running));
            collection.upsert_run(run("c", "third goal", RunStatus::Error));

            let inputs = panel_inputs(&collection);
            // Exactly one panel input per instance, in spawn/queue order.
            assert_eq!(
                inputs.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
                vec!["a", "b", "c"],
            );
            assert_eq!(inputs[0].label, "first goal");
            assert_eq!(inputs[1].status, RunStatus::Running);
            assert_eq!(inputs[2].status, RunStatus::Error);
        }

        #[test]
        fn single_instance_yields_exactly_one_panel() {
            let mut collection = InstanceCollection::new();
            collection.upsert_run(run("solo", "only goal", RunStatus::Running));
            let inputs = panel_inputs(&collection);
            assert_eq!(inputs.len(), 1);
            assert_eq!(inputs[0].id, "solo");
            assert_eq!(inputs[0].label, "only goal");
        }

        #[test]
        fn empty_collection_yields_no_panels() {
            let collection = InstanceCollection::new();
            assert!(panel_inputs(&collection).is_empty());
        }

        #[test]
        fn header_label_falls_back_to_id_for_a_blank_goal() {
            let inputs = PanelInputs::from_instance(&EngineInstance::from_run(run(
                "run-7",
                "   ",
                RunStatus::Running,
            )));
            assert_eq!(inputs.label, "run-7");
        }

        #[test]
        fn header_label_uses_only_the_first_line_of_a_multiline_goal() {
            let inputs = PanelInputs::from_instance(&EngineInstance::from_run(run(
                "r",
                "line one\nline two",
                RunStatus::Running,
            )));
            assert_eq!(inputs.label, "line one");
        }

        #[test]
        fn phase_is_only_surfaced_while_running() {
            let mut running = run("r", "g", RunStatus::Running);
            running.events.push(event(
                "r",
                None,
                AgentEventKind::PhaseStarted,
                "Phase: review",
                "",
            ));
            assert_eq!(
                PanelInputs::from_instance(&EngineInstance::from_run(running.clone())).phase,
                Some("Phase: review".to_string()),
            );

            // A completed run with the same event carries no live phase line.
            let mut done = running;
            done.status = RunStatus::Complete;
            assert_eq!(
                PanelInputs::from_instance(&EngineInstance::from_run(done)).phase,
                None,
            );
        }

        #[test]
        fn error_input_carries_the_last_error_body() {
            let mut failed = run("r", "g", RunStatus::Error);
            failed.events.push(event(
                "r",
                None,
                AgentEventKind::Error,
                "boom",
                "the tool exploded",
            ));
            let inputs = PanelInputs::from_instance(&EngineInstance::from_run(failed));
            assert_eq!(inputs.status, RunStatus::Error);
            assert_eq!(inputs.error, "the tool exploded");
        }

        #[test]
        fn react_steps_project_the_clean_flow_and_hide_bookkeeping() {
            let mut r = run("r", "g", RunStatus::Running);
            // Bookkeeping (hidden) + a visible LLM-call/response/answer flow.
            r.events
                .push(event("r", None, AgentEventKind::Started, "started", "x"));
            r.events.push(event(
                "r",
                None,
                AgentEventKind::LlmRequest,
                "calling model",
                "3 messages",
            ));
            r.events.push(event(
                "r",
                None,
                AgentEventKind::LlmResponse,
                "model replied",
                "the response text",
            ));
            r.events.push(event(
                "r",
                None,
                AgentEventKind::FinalAnswer,
                "answer",
                "the answer",
            ));

            let steps = react_steps(&r);
            assert_eq!(
                steps.iter().map(|s| s.label).collect::<Vec<_>>(),
                vec!["LLM call", "Response", "Answer"],
            );
            // The LLM-call body (bookkeeping) is suppressed; the others keep theirs.
            assert_eq!(steps[0].body, "");
            assert_eq!(steps[1].body, "the response text");
            assert_eq!(steps[2].body, "the answer");
        }
    }
}
