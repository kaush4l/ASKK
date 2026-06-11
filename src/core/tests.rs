//! Host-side unit tests for the core engine: the template methods (render,
//! transcript, history, tool map) and the [`ReactEngine`] loop driven end to
//! end against a scripted [`MockInference`] — the loop-level coverage that was
//! impossible while the shell hard-wired the concrete provider.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use serde_json::json;

use super::*;
use crate::inference::{InferenceOutput, InferenceProvider, InferenceRequest};
use crate::responses::{
    MAX_TOON_FAILURES, ReActAction, ReActResponse, ResponseFormat, ResponseKind,
};
use crate::state::{AgentMemory, AppResult, AppSnapshot, Message, ProviderConfig, ToolSpec};

/// Hand-drive a future to completion with no async runtime (the same
/// deterministic driver the dispatch tests use). Our futures only park briefly
/// and self-wake, so a no-op waker plus an unconditional re-poll loop suffices.
fn run_to_completion<F: Future>(fut: F) -> F::Output {
    let waker = Waker::noop();
    let mut cx = Context::from_waker(waker);
    let mut fut = Box::pin(fut);
    loop {
        if let Poll::Ready(out) = fut.as_mut().poll(&mut cx) {
            return out;
        }
    }
}

/// A scripted provider: pops one reply per `invoke_react` call and records
/// every request it saw. The blanket [`LocalInference`] impl makes it usable
/// as an [`InferenceHandle`] directly.
#[derive(Default)]
struct MockInference {
    replies: RefCell<VecDeque<AppResult<InferenceOutput<ReActResponse>>>>,
    requests: RefCell<Vec<InferenceRequest>>,
}

impl MockInference {
    fn scripted(replies: Vec<AppResult<InferenceOutput<ReActResponse>>>) -> Rc<Self> {
        Rc::new(Self {
            replies: RefCell::new(replies.into_iter().collect()),
            requests: RefCell::new(Vec::new()),
        })
    }

    fn request(&self, index: usize) -> InferenceRequest {
        self.requests.borrow()[index].clone()
    }

    fn request_count(&self) -> usize {
        self.requests.borrow().len()
    }
}

impl InferenceProvider for MockInference {
    async fn invoke_react(
        &self,
        _config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        self.requests.borrow_mut().push(request);
        self.replies
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Err("mock replies exhausted".to_string()))
    }
}

fn answer_reply(text: &str, raw: &str) -> AppResult<InferenceOutput<ReActResponse>> {
    Ok(InferenceOutput {
        raw_text: raw.to_string(),
        parsed: ReActResponse {
            observation: String::new(),
            thinking: String::new(),
            plan: Vec::new(),
            action: ReActAction::Answer,
            response: text.to_string(),
        },
    })
}

fn tool_reply(invocation: &str, raw: &str) -> AppResult<InferenceOutput<ReActResponse>> {
    Ok(InferenceOutput {
        raw_text: raw.to_string(),
        parsed: ReActResponse {
            observation: String::new(),
            thinking: String::new(),
            plan: Vec::new(),
            action: ReActAction::Tool,
            response: invocation.to_string(),
        },
    })
}

fn message(role: &str, content: &str) -> Message {
    Message {
        role: role.to_string(),
        content: content.to_string(),
    }
}

/// A binding that echoes the `q` argument, prefixed, so tests can see both
/// that the binding ran and which arguments it received.
fn echo_binding() -> ToolBinding {
    Rc::new(|_snapshot, args| {
        let q = args
            .get("q")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        Box::pin(async move { Ok(format!("observed:{q}")) })
    })
}

fn engine_with(inference: Rc<MockInference>, max_iterations: u32) -> ReactEngine {
    let base = BaseEngine::with_inference(inference, ProviderConfig::default());
    ReactEngine::new(base, max_iterations)
}

/// Records every hook firing and serves scripted verdicts, standing in for the
/// shell's `RunHooks`.
#[derive(Default)]
struct RecordingHooks {
    interrupt: bool,
    answer_verdicts: VecDeque<AnswerVerdict>,
    tool_verdicts: VecDeque<ToolVerdict>,
    answers_seen: Vec<(String, bool)>,
    prepared: Vec<(String, bool)>,
    finished: Vec<(String, bool)>,
    failures: Vec<u32>,
    exhausted: u32,
    escalations: Vec<(ResponseFormat, ResponseFormat, u32)>,
    mirrored: Vec<Message>,
    turns_started: Vec<u32>,
}

impl EngineHooks for RecordingHooks {
    fn interrupted(&self) -> bool {
        self.interrupt
    }

    fn on_turn_start(&mut self, turn: u32, _conversation_len: usize, _history_len: usize) {
        self.turns_started.push(turn);
    }

    fn on_model_failure(&mut self, attempt: u32, _max_attempts: u32, _error: &str) {
        self.failures.push(attempt);
    }

    fn on_model_exhausted(&mut self) {
        self.exhausted += 1;
    }

    fn on_format_escalated(&mut self, from: ResponseFormat, to: ResponseFormat, failures: u32) {
        self.escalations.push((from, to, failures));
    }

    fn on_history_appended(&mut self, message: &Message) {
        self.mirrored.push(message.clone());
    }

    fn on_tool_prepared(
        &mut self,
        _call_id: &str,
        call: &crate::responses::ParsedToolCall,
        allowed: bool,
    ) {
        self.prepared.push((call.name.clone(), allowed));
    }

    fn on_tool_finished(&mut self, name: &str, result: &crate::state::ToolResult) -> ToolVerdict {
        self.finished.push((name.to_string(), result.ok));
        self.tool_verdicts
            .pop_front()
            .unwrap_or(ToolVerdict::Accept)
    }

    fn on_answer(&mut self, text: &str, no_parsed_call: bool) -> AnswerVerdict {
        self.answers_seen.push((text.to_string(), no_parsed_call));
        self.answer_verdicts
            .pop_front()
            .unwrap_or(AnswerVerdict::Accept)
    }
}

// ── render / transcript / history ────────────────────────────────────────────

#[test]
fn render_fills_the_request_from_base_state() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.name = "Echo".to_string();
    engine.base.description = "A test role.".to_string();
    engine.base.soul = "soul text".to_string();
    engine.base.conversation = vec![message("user", "earlier question")];
    engine.base.history = vec![message("assistant", "earlier turn")];
    engine.base.specs = vec![ToolSpec {
        name: "web_search".to_string(),
        description: "search".to_string(),
        input_schema: json!({}),
    }];

    let request = engine.render("current goal");

    assert_eq!(request.agent_name, "Echo");
    assert_eq!(request.agent_role, "A test role.");
    assert_eq!(request.soul, "soul text");
    assert_eq!(request.goal, "current goal");
    assert_eq!(request.tools.len(), 1);
    assert_eq!(request.tools[0].name, "web_search");
    assert_eq!(
        request.history,
        vec![
            message("user", "earlier question"),
            message("user", "current goal"),
            message("assistant", "earlier turn"),
        ]
    );
    assert_eq!(
        request.format_instructions,
        ResponseKind::ReAct.instructions(ResponseFormat::Toon)
    );
    assert!(request.parts.is_empty());
}

#[test]
fn transcript_orders_conversation_then_goal_then_run_history() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.conversation = vec![message("user", "c1"), message("assistant", "c2")];
    engine.base.history = vec![message("assistant", "h1"), message("tool", "h2")];

    let transcript = engine.transcript("the goal");

    let order: Vec<&str> = transcript.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(order, vec!["c1", "c2", "the goal", "h1", "h2"]);
}

#[test]
fn format_history_returns_the_last_n_messages() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.history = (1..=5).map(|i| message("user", &format!("m{i}"))).collect();

    let last_two: Vec<&str> = engine
        .format_history(2)
        .iter()
        .map(|m| m.content.as_str())
        .collect();
    assert_eq!(last_two, vec!["m4", "m5"]);
    assert_eq!(engine.format_history(10).len(), 5);
}

#[test]
fn collectors_contribute_parts_to_the_render() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.collectors.push(Rc::new(|| {
        vec![Part::Image {
            mime: "image/png".to_string(),
            data_base64: "aGk=".to_string(),
        }]
    }));

    let request = engine.render("goal");

    assert_eq!(
        request.parts,
        vec![Part::Image {
            mime: "image/png".to_string(),
            data_base64: "aGk=".to_string(),
        }]
    );
}

// ── tool map / execute_tool ──────────────────────────────────────────────────

#[test]
fn tool_map_rebind_replaces_and_preserves_order() {
    let mut map = ToolMap::default();
    map.bind("a", echo_binding());
    map.bind("b", echo_binding());
    map.bind("a", echo_binding());

    assert_eq!(map.names(), vec!["b".to_string(), "a".to_string()]);
    assert_eq!(map.len(), 2);
    assert!(map.contains("a") && map.contains("b"));
    assert!(!map.contains("c"));
}

#[test]
fn execute_tool_unknown_name_yields_allowlist_rejection() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.tools.bind("web_search", echo_binding());
    let mut snapshot = AppSnapshot::default();

    let result = run_to_completion(engine.execute_tool(
        &mut snapshot,
        "call-1".to_string(),
        "file_write",
        &json!({}),
    ));

    assert!(!result.ok);
    assert!(
        result
            .content
            .contains("not in this agent's tool allowlist")
    );
    assert!(result.content.contains("web_search"));

    let bare = engine_with(MockInference::scripted(vec![]), 1);
    let empty = run_to_completion(bare.execute_tool(
        &mut snapshot,
        "call-2".to_string(),
        "anything",
        &json!({}),
    ));
    assert!(empty.content.contains("<empty>"));
}

#[test]
fn execute_tool_binding_error_becomes_ok_false_result() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 1);
    engine.base.tools.bind(
        "boomer",
        Rc::new(|_snapshot, _args| Box::pin(async { Err("boom".to_string()) })),
    );
    let mut snapshot = AppSnapshot::default();

    let result = run_to_completion(engine.execute_tool(
        &mut snapshot,
        "call-1".to_string(),
        "boomer",
        &json!({}),
    ));

    assert!(!result.ok);
    assert_eq!(result.content, "boom");
}

// ── the loop ─────────────────────────────────────────────────────────────────

#[test]
fn invoke_answers_on_the_first_turn() {
    let mock = MockInference::scripted(vec![answer_reply("done", "raw-1")]);
    let mut engine = engine_with(Rc::clone(&mock), 4);
    let mut snapshot = AppSnapshot::default();

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut NoHooks));

    assert_eq!(outcome.stop, StopReason::Answered);
    assert_eq!(outcome.answer.as_deref(), Some("done"));
    assert_eq!(outcome.turns_used, 1);
    assert_eq!(engine.base.history, vec![message("assistant", "raw-1")]);
    assert_eq!(mock.request_count(), 1);
}

#[test]
fn invoke_executes_tool_then_answers() {
    let mock = MockInference::scripted(vec![
        tool_reply("echo_tool({\"q\":\"x\"})", "raw-1"),
        answer_reply("final", "raw-2"),
    ]);
    let mut engine = engine_with(Rc::clone(&mock), 4);
    engine.base.tools.bind("echo_tool", echo_binding());
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks::default();

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::Answered);
    assert_eq!(outcome.answer.as_deref(), Some("final"));
    assert_eq!(outcome.turns_used, 2);
    assert_eq!(
        engine.base.history,
        vec![
            message("assistant", "raw-1"),
            message("tool", "echo_tool -> observed:x"),
            message("assistant", "raw-2"),
        ]
    );
    // The second model call saw the observation in its transcript.
    let second = mock.request(1);
    assert!(
        second
            .history
            .iter()
            .any(|m| m.role == "tool" && m.content == "echo_tool -> observed:x")
    );
    assert_eq!(hooks.prepared, vec![("echo_tool".to_string(), true)]);
    assert_eq!(hooks.finished, vec![("echo_tool".to_string(), true)]);
    // The mirror hook saw every history append, in order.
    assert_eq!(hooks.mirrored, engine.base.history);
}

#[test]
fn tool_action_without_parseable_call_is_treated_as_answer() {
    let mock = MockInference::scripted(vec![tool_reply("no call syntax here", "raw-1")]);
    let mut engine = engine_with(mock, 4);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks::default();

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::Answered);
    assert_eq!(hooks.answers_seen.len(), 1);
    assert!(hooks.answers_seen[0].1, "no_parsed_call flag must be set");
}

#[test]
fn rejected_answer_feeds_feedback_and_loop_continues() {
    let mock = MockInference::scripted(vec![
        answer_reply("v1", "raw-1"),
        answer_reply("v2", "raw-2"),
    ]);
    let mut engine = engine_with(Rc::clone(&mock), 4);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks {
        answer_verdicts: VecDeque::from(vec![
            AnswerVerdict::Reject {
                feedback: "Validator feedback: try again".to_string(),
            },
            AnswerVerdict::Accept,
        ]),
        ..Default::default()
    };

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::Answered);
    assert_eq!(outcome.answer.as_deref(), Some("v2"));
    assert_eq!(outcome.turns_used, 2);
    assert!(
        engine
            .base
            .history
            .contains(&message("user", "Validator feedback: try again"))
    );
    // The retry turn saw the feedback in its transcript.
    let second = mock.request(1);
    assert!(
        second
            .history
            .iter()
            .any(|m| m.content == "Validator feedback: try again")
    );
}

#[test]
fn abort_verdict_stops_the_loop_without_an_answer() {
    let mock = MockInference::scripted(vec![answer_reply("v1", "raw-1")]);
    let mut engine = engine_with(mock, 4);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks {
        answer_verdicts: VecDeque::from(vec![AnswerVerdict::Abort]),
        ..Default::default()
    };

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::Aborted);
    assert_eq!(outcome.answer, None);
    assert_eq!(outcome.turns_used, 1);
}

#[test]
fn budget_exhaustion_stops_after_max_iterations() {
    let mock = MockInference::scripted(vec![
        answer_reply("v1", "raw-1"),
        answer_reply("v2", "raw-2"),
    ]);
    let mut engine = engine_with(mock, 2);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks {
        answer_verdicts: VecDeque::from(vec![
            AnswerVerdict::Reject {
                feedback: "no".to_string(),
            },
            AnswerVerdict::Reject {
                feedback: "still no".to_string(),
            },
        ]),
        ..Default::default()
    };

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::BudgetExhausted);
    assert_eq!(outcome.turns_used, 2);
    assert!(outcome.last_response.is_some());
    assert_eq!(hooks.turns_started, vec![1, 2]);
}

#[test]
fn interrupt_stops_the_loop_before_any_model_call() {
    let mock = MockInference::scripted(vec![answer_reply("never", "raw-1")]);
    let mut engine = engine_with(Rc::clone(&mock), 4);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks {
        interrupt: true,
        ..Default::default()
    };

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::Interrupted);
    assert_eq!(outcome.turns_used, 0);
    assert_eq!(mock.request_count(), 0);
}

#[test]
fn provider_failure_exhausts_retries_and_pauses() {
    let mock = MockInference::scripted(vec![
        Err("down 1".to_string()),
        Err("down 2".to_string()),
        Err("down 3".to_string()),
    ]);
    let mut engine = engine_with(Rc::clone(&mock), 4);
    let mut snapshot = AppSnapshot::default();
    let mut hooks = RecordingHooks::default();

    let outcome = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(outcome.stop, StopReason::ProviderPaused);
    assert_eq!(outcome.turns_used, 1);
    assert_eq!(hooks.failures, vec![1, 2, 3]);
    assert_eq!(hooks.exhausted, 1);
    assert_eq!(mock.request_count(), 3, "one per attempt");
}

#[test]
fn format_escalation_fires_after_consecutive_toon_failures() {
    // Raw replies that do not parse as the requested TOON format; the hook
    // rejects each candidate answer so the loop keeps taking turns.
    let replies = (0..MAX_TOON_FAILURES)
        .map(|i| answer_reply(&format!("v{i}"), "plain text, not TOON"))
        .collect();
    let mock = MockInference::scripted(replies);
    let mut engine = engine_with(mock, MAX_TOON_FAILURES);
    let mut snapshot = AppSnapshot::default();
    let rejections = (0..MAX_TOON_FAILURES)
        .map(|_| AnswerVerdict::Reject {
            feedback: "rejected".to_string(),
        })
        .collect();
    let mut hooks = RecordingHooks {
        answer_verdicts: rejections,
        ..Default::default()
    };

    let _ = run_to_completion(engine.invoke("goal", &mut snapshot, &mut hooks));

    assert_eq!(
        hooks.escalations,
        vec![(
            ResponseFormat::Toon,
            ResponseFormat::Json,
            MAX_TOON_FAILURES
        )]
    );
    assert_eq!(engine.base.negotiator.format(), ResponseFormat::Json);
}

// ── dispatch ─────────────────────────────────────────────────────────────────

#[test]
fn dispatch_feeds_observations_back_in_call_order() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 4);
    engine.base.tools.bind(
        "alpha",
        Rc::new(|_s, _a| Box::pin(async { Ok("ra".to_string()) })),
    );
    engine.base.tools.bind(
        "beta",
        Rc::new(|_s, _a| Box::pin(async { Ok("rb".to_string()) })),
    );
    let mut snapshot = AppSnapshot::default();
    // Built directly: the inline-text parser yields at most one call today;
    // multi-call turns reach dispatch through other response shapes.
    let calls = vec![
        crate::responses::ParsedToolCall {
            name: "alpha".to_string(),
            args: json!({}),
        },
        crate::responses::ParsedToolCall {
            name: "beta".to_string(),
            args: json!({}),
        },
    ];

    let continued = run_to_completion(engine.dispatch_tools(&mut snapshot, calls, &mut NoHooks));

    assert!(continued);
    assert_eq!(
        engine.base.history,
        vec![
            message("tool", "alpha -> ra"),
            message("tool", "beta -> rb"),
        ]
    );
}

#[test]
fn dispatch_merges_agent_memory_deltas_into_the_real_snapshot() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 4);
    engine.base.tools.bind(
        "delegate",
        Rc::new(|snapshot, _args| {
            Box::pin(async move {
                snapshot.agent_memories.push(AgentMemory {
                    agent_id: "sub-agent".to_string(),
                    rolling_summary: "learned something".to_string(),
                    updated_at: String::new(),
                });
                Ok("delegated".to_string())
            })
        }),
    );
    let mut snapshot = AppSnapshot::default();
    let calls = crate::responses::parse_tool_calls("delegate({})");

    let continued = run_to_completion(engine.dispatch_tools(&mut snapshot, calls, &mut NoHooks));

    assert!(continued);
    assert!(snapshot.agent_memories.iter().any(|memory| {
        memory.agent_id == "sub-agent" && memory.rolling_summary == "learned something"
    }));
}

#[test]
fn dispatch_disallowed_call_reaches_hooks_as_failed_result() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 4);
    engine.base.tools.bind("allowed_tool", echo_binding());
    let mut snapshot = AppSnapshot::default();
    let calls = crate::responses::parse_tool_calls("forbidden_tool({})");
    let mut hooks = RecordingHooks::default();

    let continued = run_to_completion(engine.dispatch_tools(&mut snapshot, calls, &mut hooks));

    assert!(continued);
    assert_eq!(hooks.prepared, vec![("forbidden_tool".to_string(), false)]);
    assert_eq!(hooks.finished, vec![("forbidden_tool".to_string(), false)]);
    // The rejection text reaches the conversation as the observation, so the
    // model can see which tools it may use.
    assert!(
        engine.base.history[0]
            .content
            .contains("not in this agent's tool allowlist")
    );
}

#[test]
fn dispatch_abort_verdict_stops_processing() {
    let mock = MockInference::scripted(vec![]);
    let mut engine = engine_with(mock, 4);
    engine.base.tools.bind(
        "alpha",
        Rc::new(|_s, _a| Box::pin(async { Ok("ra".to_string()) })),
    );
    engine.base.tools.bind(
        "beta",
        Rc::new(|_s, _a| Box::pin(async { Ok("rb".to_string()) })),
    );
    let mut snapshot = AppSnapshot::default();
    let calls = vec![
        crate::responses::ParsedToolCall {
            name: "alpha".to_string(),
            args: json!({}),
        },
        crate::responses::ParsedToolCall {
            name: "beta".to_string(),
            args: json!({}),
        },
    ];
    let mut hooks = RecordingHooks {
        tool_verdicts: VecDeque::from(vec![ToolVerdict::Abort]),
        ..Default::default()
    };

    let continued = run_to_completion(engine.dispatch_tools(&mut snapshot, calls, &mut hooks));

    assert!(!continued);
    assert!(engine.base.history.is_empty(), "no observation after abort");
}
