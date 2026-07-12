//! Layer-5 workflow tests (docs/TESTING.md): full runs against a scripted
//! MockProvider. Assertions target the SIGNAL STREAM first (the log is the
//! observable behavior), then the fold.

use std::rc::Rc;

use askk_core::signal::fold;
use askk_core::{
    ActionId, ActionPolicy, Budgets, PolicyDecision, Provider, Role, RunStatus, Signal, SignalKind,
};
use askk_inference::MockProvider;
use askk_runtime::config::{AgentConfig, SkillConfig};
use askk_runtime::run::{ProviderResolver, RunSession, SessionInit, TestHost};
use askk_runtime::state::{BlobStore, MemBlob, MemKv, MemoryStore, SessionStore, SignalLog};
use askk_runtime::testutil::block_on;
use askk_runtime::tools::{register_builtins, ToolRegistry};

const SOLO: (&str, &str) = (
    "agents/solo.md",
    "---\nid: solo\ndescription: Answers questions using tools.\n\
     tools: echo, calc, state_note\nskills: concise\n---\nYou answer questions.",
);

const CODER: (&str, &str) = (
    "agents/coder.md",
    "---\nid: coder\ndescription: Plans, executes, verifies.\ntools: echo\n\
     phase.1.name: plan\nphase.1.contract: plan\nphase.1.header: Produce a plan.\n\
     phase.2.name: execute\nphase.2.contract: react\nphase.2.loop: loop\n\
     phase.3.name: verify\nphase.3.contract: critique\nphase.3.gate: true\n\
     phase.3.on_fail: execute\n---\nDo the work.",
);

const PARENT: (&str, &str) = (
    "agents/parent.md",
    "---\nid: parent\ndescription: Orchestrates sub-agents.\ntools: echo, worker, helper\n---\n\
     You orchestrate.",
);
const WORKER: (&str, &str) = (
    "agents/worker.md",
    "---\nid: worker\ndescription: Does subtasks.\ntools: echo, helper\n---\nYou do subtasks.",
);
const HELPER: (&str, &str) = (
    "agents/helper.md",
    "---\nid: helper\ndescription: Helps.\n---\nYou help.",
);
const SCRUM: (&str, &str) = (
    "agents/scrum.md",
    "---\nid: scrum\ndescription: Works the kanban board.\n\
     tools: board_add, board_list, board_move, board_check\n---\n\
     You track work on the kanban board.",
);

const ORCH: (&str, &str) = (
    "agents/orch.md",
    "---\nid: orch\ndescription: Manages loops.\n\
     tools: echo, worker, helper, spawn_run, check_run, wait_run, steer_run, cancel_run\n---\n\
     You manage parallel loops.",
);
const CUSTOM: (&str, &str) = (
    "agents/custom.md",
    "---\nid: custom\ndescription: Uses its own response format.\ntools: echo\ncontract: custom\n\
     field.1.name: observation\nfield.1.kind: list\nfield.1.required: false\n\
     field.2.name: action\nfield.2.kind: enum: tool|answer\n\
     field.3.name: answer\nfield.3.required: false\nfield.3.desc: final text or the tool call\n\
     ---\nYou answer with your own format.",
);
const FAN: (&str, &str) = (
    "agents/fan.md",
    "---\nid: fan\ndescription: Plans then fans the steps out.\ntools: worker\n\
     phase.1.name: plan\nphase.1.contract: plan\n\
     phase.2.name: fanout\nphase.2.contract: react\nphase.2.loop: loop\n\
     phase.2.fan_out: worker\nphase.2.parts: steps\n\
     phase.3.name: verify\nphase.3.contract: critique\nphase.3.gate: true\n---\nFan out.",
);
const RETRY: (&str, &str) = (
    "agents/retry.md",
    "---\nid: retry\ndescription: Retries via prep when work stalls.\ntools: echo\n\
     phase.1.name: prep\nphase.1.contract: react\n\
     phase.2.name: work\nphase.2.contract: react\nphase.2.loop: loop\n\
     phase.2.max_turns: 2\nphase.2.on_fail: prep\n\
     phase.3.name: verify\nphase.3.contract: critique\nphase.3.gate: true\n---\nWork.",
);

struct Fixture {
    session: RunSession,
    host: Rc<TestHost>,
    mock: Rc<MockProvider>,
    blobs: Rc<dyn BlobStore>,
}

async fn fixture_with(files: &[(&str, &str)], budgets: Budgets, policy: ActionPolicy) -> Fixture {
    let mock = Rc::new(MockProvider::new("mock/test"));
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _) = SignalLog::open(Rc::clone(&blobs), Box::new(|| 0))
        .await
        .unwrap();
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || 7).unwrap();
    askk_runtime::tools::register_board(&mut registry, Rc::new(MemKv::new())).unwrap();
    let agents: Vec<AgentConfig> = files
        .iter()
        .map(|(path, text)| AgentConfig::from_markdown(path, text).unwrap())
        .collect();
    let skills = vec![SkillConfig::from_markdown(
        "agents/skills/concise.md",
        "---\nid: concise\n---\nBe brief.",
    )
    .unwrap()];
    let provider: Rc<dyn Provider> = mock.clone();
    let resolver: ProviderResolver = Box::new(move |_| Ok(provider.clone()));
    let session = RunSession::new(SessionInit {
        agents,
        soul: "Be honest.".into(),
        skills,
        registry,
        resolver,
        log,
        memory: MemoryStore::new(Rc::new(MemKv::new()), 64),
        session: SessionStore::new(Rc::new(MemKv::new())),
        budgets,
        policy,
        known_providers: vec!["default".into()],
    })
    .unwrap();
    Fixture {
        session,
        host: Rc::new(TestHost::new()),
        mock,
        blobs,
    }
}

async fn fixture(files: &[(&str, &str)]) -> Fixture {
    fixture_with(files, Budgets::default(), ActionPolicy::default()).await
}

/// Flat `kind` tags of a signal slice, for order assertions.
fn tags(signals: &[Signal]) -> Vec<String> {
    signals
        .iter()
        .map(|s| {
            serde_json::to_value(s).unwrap()["kind"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect()
}

fn observations(signals: &[Signal]) -> Vec<String> {
    signals
        .iter()
        .filter_map(|s| match &s.kind {
            SignalKind::ObservationAppended { text } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn phases_entered(signals: &[Signal]) -> Vec<String> {
    signals
        .iter()
        .filter_map(|s| match &s.kind {
            SignalKind::PhaseEntered { name } => Some(name.clone()),
            _ => None,
        })
        .collect()
}

fn parse_outcomes(signals: &[Signal]) -> Vec<(bool, String)> {
    signals
        .iter()
        .filter_map(|s| match &s.kind {
            SignalKind::ParseOutcome { ok, format, .. } => Some((*ok, format.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn happy_answer() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock.push_text("action: answer\nanswer: 4");
        let run = f.session.submit("solo", "what is 2+2").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("4"));
        assert_eq!(out.turns_used, 1);
        // Signal stream (host sees everything after submit), in order.
        assert_eq!(
            tags(&f.host.signals()),
            vec![
                "phase_entered",
                "llm_request",
                "llm_delta",
                "llm_response",
                "parse_outcome",
                "history_appended",
                "result",
            ]
        );
        // Then the fold.
        let proj = f.session.projection(&run).unwrap();
        assert_eq!(proj.status, RunStatus::Answered);
        assert_eq!(proj.turns_used, 1);
    });
}

#[test]
fn tool_loop_echo_then_answer() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"hi\"}}",
        );
        f.mock.push_text("action: answer\nanswer: echoed");
        let run = f.session.submit("solo", "echo hi").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.turns_used, 2);
        let signals = f.host.signals();
        let stream = tags(&signals);
        for needle in ["tool_requested", "action_verdict", "tool_completed"] {
            assert!(stream.contains(&needle.to_string()), "missing {needle}");
        }
        assert_eq!(observations(&signals), vec!["echo: hi".to_string()]);
        assert_eq!(f.mock.remaining(), 0);
    });
}

#[test]
fn action_confirm_then_approve() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"state_note\", \"arguments\": {\"note\": \"remember\"}}");
        f.mock.push_text("action: answer\nanswer: noted");
        let run = f.session.submit("solo", "note this").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Running); // parked, not terminal
        assert_eq!(f.host.confirm_calls(), 1);
        let proj = f.session.projection(&run).unwrap();
        assert_eq!(proj.pending_actions.len(), 1);
        assert_eq!(proj.pending_actions[0].proposal.tool, "state_note");
        // Ids are run-qualified and unique (no cross-run ActionId collisions).
        let pending_id = proj.pending_actions[0].proposal.id.clone();
        assert_eq!(pending_id, ActionId(format!("{}-call-0", run.0)));

        let out = f
            .session
            .resolve_action(&run, &pending_id, true, f.host.clone())
            .await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        assert!(signals
            .iter()
            .any(|s| matches!(&s.kind, SignalKind::StateWritten { key } if key == "notes")));
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("noted (1 total)")));
        let proj = f.session.projection(&run).unwrap();
        assert!(proj.pending_actions.is_empty()); // resolved actions leave the fold
    });
}

#[test]
fn action_deny_then_model_adapts() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"state_note\", \"arguments\": {\"note\": \"secret\"}}");
        f.mock.push_text("action: answer\nanswer: skipped it");
        let run = f.session.submit("solo", "note this").await.unwrap();
        f.session.drive(&run, f.host.clone()).await;
        let pending_id = f.session.projection(&run).unwrap().pending_actions[0]
            .proposal
            .id
            .clone();
        let out = f
            .session
            .resolve_action(&run, &pending_id, false, f.host.clone())
            .await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("skipped it"));
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("denied by user")));
        assert!(f
            .session
            .projection(&run)
            .unwrap()
            .pending_actions
            .is_empty());
    });
}

#[test]
fn gate_phase_fail_revise_pass() {
    block_on(async {
        let f = fixture(&[CODER]).await;
        f.mock.push_text("steps:\n- write it\nrationale: simple");
        f.mock.push_text("action: answer\nanswer: draft v1");
        f.mock.push_text("verdict: revise\nfeedback: tighten it");
        f.mock.push_text("action: answer\nanswer: draft v2");
        f.mock.push_text("verdict: pass");
        let run = f.session.submit("coder", "build the thing").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered); // only the gate pass answers
        assert_eq!(out.turns_used, 5);
        let signals = f.host.signals();
        assert_eq!(
            phases_entered(&signals),
            vec!["plan", "execute", "verify", "execute", "verify"]
        );
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("Gate 'verify' failed") && o.contains("tighten it")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

#[test]
fn budget_exhaustion_with_final_turn_nudge() {
    block_on(async {
        let budgets = Budgets {
            max_turns: 2,
            ..Budgets::default()
        };
        let f = fixture_with(&[SOLO], budgets, ActionPolicy::default()).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"a\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"b\"}}",
        );
        let run = f.session.submit("solo", "never answers").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::BudgetExhausted);
        assert_eq!(out.turns_used, 2);
        let signals = f.host.signals();
        // The nudge is visible in the stream before the terminal.
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::HistoryAppended { role: Role::User, text } if text.contains("final turn")
        )));
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::StatusSet {
                status: RunStatus::BudgetExhausted
            }
        )));
        assert_eq!(
            f.session.projection(&run).unwrap().status,
            RunStatus::BudgetExhausted
        );
    });
}

/// FINDING 2 regression: the budget guard holds INSIDE the repair loop —
/// a run out of turns never spends extra provider calls on repairs.
#[test]
fn budget_guard_holds_inside_the_repair_loop() {
    block_on(async {
        let budgets = Budgets {
            max_turns: 1,
            ..Budgets::default()
        };
        let f = fixture_with(&[SOLO], budgets, ActionPolicy::default()).await;
        f.mock.push_text("gibberish the contract cannot parse");
        f.mock.push_text("gibberish again"); // must never be consumed
        let run = f.session.submit("solo", "answer me").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::BudgetExhausted);
        assert_eq!(out.turns_used, 1);
        assert_eq!(f.mock.requests().len(), 1); // exactly one provider call
        assert_eq!(f.mock.remaining(), 1);
        assert!(f.host.signals().iter().any(|s| matches!(
            &s.kind,
            SignalKind::StatusSet {
                status: RunStatus::BudgetExhausted
            }
        )));
    });
}

#[test]
fn interrupt_mid_run() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"a\"}}",
        );
        f.host.interrupt_after(1); // first turn runs; the next check trips
        let run = f.session.submit("solo", "slow work").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Interrupted);
        assert!(f
            .host
            .signals()
            .iter()
            .any(|s| matches!(s.kind, SignalKind::Interrupted)));
        assert_eq!(f.mock.remaining(), 0); // the first turn did run
    });
}

#[test]
fn malformed_reply_repairs_then_succeeds() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock.push_text("total gibberish without structure");
        f.mock.push_text("action: answer\nanswer: fixed");
        let run = f.session.submit("solo", "answer me").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("fixed"));
        let signals = f.host.signals();
        let outcomes = parse_outcomes(&signals);
        assert!(!outcomes[0].0);
        assert!(outcomes[1].0);
        // The repair prompt reached the model as an observation.
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("Missing or invalid required")));
    });
}

#[test]
fn malformed_thrice_escalates_format_and_falls_back_to_raw() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        for _ in 0..3 {
            f.mock.push_text("still not structured output");
        }
        let run = f.session.submit("solo", "answer me").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        // Two repairs, then the raw text is the answer candidate.
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(
            out.final_text.as_deref(),
            Some("still not structured output")
        );
        let outcomes = parse_outcomes(&f.host.signals());
        // Escalation visible in the stream: third failure reports JSON mode.
        assert_eq!(
            outcomes,
            vec![
                (false, "toon".to_string()),
                (false, "toon".to_string()),
                (false, "json".to_string()),
            ]
        );
    });
}

#[test]
fn unknown_tool_gets_structured_rejection() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"ghost\", \"arguments\": {\"x\": 1}}");
        f.mock.push_text("action: answer\nanswer: ok then");
        let run = f.session.submit("solo", "use ghost").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let rejections = observations(&f.host.signals());
        assert!(rejections
            .iter()
            .any(|o| o.contains("unknown tool 'ghost'") && o.contains("echo")));
    });
}

#[test]
fn delegation_happy_path() {
    block_on(async {
        let f = fixture(&[PARENT, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"worker\", \"arguments\": {\"goal\": \"do sub\"}}",
        );
        f.mock.push_text("action: answer\nanswer: sub-result");
        f.mock.push_text("action: answer\nanswer: combined");
        let run = f.session.submit("parent", "orchestrate").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("combined"));
        let signals = f.host.signals();
        // The child ran as its own run with its own signals.
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, goal } if agent_id == "worker" && goal == "do sub"
        )));
        // The child's answer came back as an untrusted observation.
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("Result (untrusted): sub-result")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

#[test]
fn delegation_depth_cap_rejects() {
    block_on(async {
        let budgets = Budgets {
            max_delegation_depth: 1,
            ..Budgets::default()
        };
        let f = fixture_with(&[PARENT, WORKER, HELPER], budgets, ActionPolicy::default()).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"worker\", \"arguments\": {\"goal\": \"go deep\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"helper\", \"arguments\": {\"goal\": \"deeper\"}}",
        );
        f.mock.push_text("action: answer\nanswer: gave up");
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("parent", "orchestrate").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        // worker (depth 1) hit the cap trying to delegate to helper.
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("delegation depth cap (1) reached")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// Loop management arc: spawn two parts, watch them, steer one, then wait —
/// both loops drive CONCURRENTLY inside wait_run and the steering note is
/// visible to the steered loop's model on its next (first) turn.
#[test]
fn spawn_check_steer_wait_collects_parallel_loops() {
    block_on(async {
        let f = fixture(&[ORCH, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_run\", \"arguments\": {\"agent\": \"worker\", \"goal\": \"part one\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_run\", \"arguments\": {\"agent\": \"helper\", \"goal\": \"part two\"}}",
        );
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"check_run\", \"arguments\": {}}");
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"steer_run\", \"arguments\": {\"run_id\": \"run-2\", \"note\": \"focus on brevity\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"wait_run\", \"arguments\": {\"run_ids\": [\"run-2\", \"run-3\"]}}",
        );
        f.mock.push_text("action: answer\nanswer: one done"); // worker (run-2)
        f.mock.push_text("action: answer\nanswer: two done"); // helper (run-3)
        f.mock
            .push_text("action: answer\nanswer: both parts assembled");
        let run = f.session.submit("orch", "do both parts").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("both parts assembled"));
        let obs = observations(&f.host.signals());
        // spawn returned ids immediately; check saw both parked and Running.
        assert!(obs
            .iter()
            .any(|o| o.contains("spawned worker") && o.contains("run-2")));
        assert!(obs
            .iter()
            .any(|o| o.contains("run-2") && o.contains("run-3") && o.contains("Running")));
        // wait collected both answers, in id order.
        let wait_obs = obs.iter().find(|o| o.contains("one done")).unwrap();
        assert!(wait_obs.contains("run-2 (worker) answered (untrusted): one done"));
        assert!(wait_obs.contains("run-3 (helper) answered (untrusted): two done"));
        // The steering note reached the steered loop's model.
        let steered_request = f
            .mock
            .requests()
            .into_iter()
            .find(|r| r.sections.iter().any(|(_, s)| s.contains("part one")))
            .expect("worker request");
        assert!(steered_request
            .history
            .iter()
            .any(|m| m.content.contains("Steering note: focus on brevity")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// A spawned loop can be cancelled before it ever drives; wait_run on it
/// reports the Interrupted terminal instead of an answer.
#[test]
fn spawned_loop_cancels_cleanly() {
    block_on(async {
        let f = fixture(&[ORCH, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_run\", \"arguments\": {\"agent\": \"worker\", \"goal\": \"doomed part\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"cancel_run\", \"arguments\": {\"run_id\": \"run-2\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"wait_run\", \"arguments\": {\"run_ids\": [\"run-2\"]}}",
        );
        f.mock
            .push_text("action: answer\nanswer: abandoned that part");
        let run = f.session.submit("orch", "start then stop").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(obs.iter().any(|o| o.contains("run-2 ended Interrupted")));
        assert!(obs
            .iter()
            .any(|o| o.contains("run-2 (worker) ended Interrupted")));
        // The cancelled loop never consumed a provider reply.
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// Slice 1: a `field.N.*` custom contract drives a tool call then an answer
/// end-to-end — the rendered contract is the agent's own, not a built-in.
#[test]
fn custom_contract_drives_tool_call_and_answer() {
    block_on(async {
        let f = fixture(&[CUSTOM]).await;
        f.mock.push_text(
            "observation:\n- need the echo\naction: tool\n\
             answer: {\"name\": \"echo\", \"arguments\": {\"text\": \"hi\"}}",
        );
        f.mock
            .push_text("observation:\n- echoed fine\naction: answer\nanswer: custom done");
        let run = f.session.submit("custom", "echo hi").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("custom done"));
        let signals = f.host.signals();
        assert!(observations(&signals).iter().any(|o| o == "echo: hi"));
        // Both parses succeeded against the custom contract, and the model
        // was shown the custom contract by name.
        assert!(parse_outcomes(&signals).iter().all(|(ok, _)| *ok));
        assert!(f
            .mock
            .requests()
            .iter()
            .all(|r| r.contract.name == "custom"));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// Slice 3: plan → declared fan-out (one worker per plan step, concurrently)
/// → gate. The two workers are ordinary delegate calls batched by dispatch.
#[test]
fn declared_fan_out_runs_workers_from_plan_steps() {
    block_on(async {
        let f = fixture(&[FAN, WORKER, HELPER]).await;
        f.mock
            .push_text("steps:\n- part one\n- part two\nrationale: split it");
        f.mock.push_text("action: answer\nanswer: did one"); // worker 1
        f.mock.push_text("action: answer\nanswer: did two"); // worker 2
        f.mock.push_text("action: answer\nanswer: assembled"); // fanout phase turn
        f.mock.push_text("verdict: pass"); // gate
        let run = f.session.submit("fan", "do the parts").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        // Child worker runs mirror their own "main" phase into the shared
        // host log — the declared sequence is asserted on the parent only.
        let parent: Vec<Signal> = signals
            .iter()
            .filter(|s| s.run_id == run)
            .cloned()
            .collect();
        assert_eq!(phases_entered(&parent), vec!["plan", "fanout", "verify"]);
        // Both workers ran as their own runs, spawned in step order.
        let started: Vec<String> = signals
            .iter()
            .filter_map(|s| match &s.kind {
                SignalKind::RunStarted { agent_id, goal } => Some(format!("{agent_id}:{goal}")),
                _ => None,
            })
            .collect();
        assert_eq!(started, vec!["worker:part one", "worker:part two"]);
        // Their results landed as ordinary observations, in call order,
        // before the fanout phase's own turn answered.
        let obs = observations(&signals);
        let one = obs
            .iter()
            .position(|o| o.contains("Result (untrusted): did one"))
            .expect("worker one result");
        let two = obs
            .iter()
            .position(|o| o.contains("Result (untrusted): did two"))
            .expect("worker two result");
        assert!(one < two);
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// Slice 3 fallback: an artifact with no `parts` items degrades to an
/// observation and the phase runs normally — never a hard failure.
#[test]
fn fan_out_without_items_degrades_to_observation() {
    block_on(async {
        let f = fixture(&[FAN, WORKER, HELPER]).await;
        // A valid plan whose `steps` list is empty: nothing to fan out.
        f.mock
            .push_text(r#"{"steps": [], "rationale": "nothing to split"}"#);
        f.mock.push_text("action: answer\nanswer: did it alone");
        f.mock.push_text("verdict: pass");
        let run = f.session.submit("fan", "do the parts").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("no 'steps' list items")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// Slice 2: a loop phase exhausting `max_turns` with a declared on_fail
/// routes back like a failed gate; the gate must still pass to answer.
#[test]
fn loop_exhaustion_with_on_fail_routes_back() {
    block_on(async {
        let f = fixture(&[RETRY]).await;
        f.mock.push_text("action: answer\nanswer: prepped"); // prep
        for text in ["a", "b"] {
            f.mock.push_text(&format!(
                "action: tool\nanswer: {{\"name\": \"echo\", \"arguments\": {{\"text\": \"{text}\"}}}}"
            )); // work turns 1-2 → exhausted
        }
        f.mock.push_text("action: answer\nanswer: prepped again"); // prep (rewound)
        f.mock.push_text("action: answer\nanswer: work done"); // work (fresh clamp)
        f.mock.push_text("verdict: pass"); // gate
        let run = f.session.submit("retry", "do it").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        assert_eq!(
            phases_entered(&signals),
            vec!["prep", "work", "prep", "work", "verify"]
        );
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("exhausted its turn budget") && o.contains("'prep'")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

#[test]
fn replay_fold_matches_final_projection() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"calc\", \"arguments\": {\"op\": \"+\", \"a\": 2, \"b\": 2}}");
        f.mock.push_text("action: answer\nanswer: 4");
        let run = f.session.submit("solo", "2+2").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let live = f.session.projection(&run).unwrap();

        // Reopen the log over the same blobs: replay from 0 must reproduce
        // the exact projection (ADR-003).
        let (_log, replayed) = SignalLog::open(Rc::clone(&f.blobs), Box::new(|| 0))
            .await
            .unwrap();
        let run_signals: Vec<&Signal> = replayed.iter().filter(|s| s.run_id == run).collect();
        assert_eq!(fold(run_signals.into_iter()), live);
    });
}

#[test]
fn parallel_calls_fan_out_two_delegates() {
    block_on(async {
        let f = fixture(&[PARENT, WORKER, HELPER]).await;
        // One turn, two delegate calls: they execute concurrently (join_all),
        // each nested run pops its own scripted reply.
        f.mock.push_text(
            r#"{"action": "tool",
                "answer": "{\"name\": \"worker\", \"arguments\": {\"goal\": \"part one\"}}\n{\"name\": \"helper\", \"arguments\": {\"goal\": \"part two\"}}"}"#,
        );
        f.mock.push_text("action: answer\nanswer: one done");
        f.mock.push_text("action: answer\nanswer: two done");
        f.mock.push_text("action: answer\nanswer: both parts done");
        let run = f.session.submit("parent", "do both parts").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("both parts done"));

        let signals = f.host.signals();
        let started: Vec<String> = signals
            .iter()
            .filter_map(|s| match &s.kind {
                SignalKind::RunStarted { agent_id, .. } => Some(agent_id.clone()),
                _ => None,
            })
            .collect();
        // Parent's own RunStarted precedes host install (GAPS 12); the two
        // nested fan-out runs both started, in call order.
        assert_eq!(started, vec!["worker", "helper"]);
        // Parent absorbed BOTH sub-results as observations, in call order.
        let parent_obs: Vec<String> = signals
            .iter()
            .filter(|s| s.run_id == run)
            .filter_map(|s| match &s.kind {
                SignalKind::ObservationAppended { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(parent_obs.len(), 2);
        assert!(parent_obs.iter().all(|o| o.contains("Result (untrusted)")));
        // Both tool calls completed ok on the parent run.
        let completed_ok = signals
            .iter()
            .filter(|s| s.run_id == run)
            .filter(|s| matches!(s.kind, SignalKind::ToolCompleted { ok: true, .. }))
            .count();
        assert_eq!(completed_ok, 2);
    });
}

/// Board foundation smoke: an agent adds a card with criteria, gets refused
/// Done while one is open, records the verdicts, then finishes the card —
/// the whole kanban rule set exercised through the real loop.
#[test]
fn board_card_lifecycle_through_the_loop() {
    block_on(async {
        let policy = ActionPolicy {
            mutating_default: PolicyDecision::Auto, // board writes flow in tests
            ..Default::default()
        };
        let f = fixture_with(&[SCRUM], Budgets::default(), policy).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_add\", \"arguments\": \
             {\"title\": \"Ship it\", \"goal\": \"build the thing\", \"criteria\": [\"works\"], \
             \"stage\": \"doing\"}}",
        );
        // Premature finish: refused while the criterion is unmet.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-it\", \"stage\": \"done\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_check\", \"arguments\": \
             {\"id\": \"ship-it\", \"criterion\": 1, \"note\": \"ran it\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-it\", \"stage\": \"done\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: card done and verified");
        let run = f.session.submit("scrum", "work the board").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(obs.iter().any(|o| o.contains("added [ship-it]")), "{obs:?}");
        assert!(
            obs.iter().any(|o| o.contains("unmet criteria")),
            "premature done must be refused: {obs:?}"
        );
        assert!(obs.iter().any(|o| o.contains("0 unmet remain")), "{obs:?}");
        assert!(
            obs.iter()
                .any(|o| o.contains("moved [ship-it] doing -> done")),
            "{obs:?}"
        );
        assert_eq!(f.mock.remaining(), 0);
    });
}

const KANBAN: (&str, &str) = (
    "agents/kanban.md",
    "---\nid: kanban\ndescription: Plans cards, dispatches them, accepts only met criteria.\n\
     tools: board_add, board_list, board_move, board_check, tester, echo\n---\n\
     You work goals through the kanban board.",
);
const TESTER: (&str, &str) = (
    "agents/tester.md",
    "---\nid: tester\ndescription: Verifies card criteria and records verdicts.\n\
     tools: board_list, board_check, board_move\n---\nYou verify cards.",
);

/// The full team arc: the orchestrator plans a card and pushes it to testing;
/// the tester delegate finds a criterion unmet and BOUNCES the card back to
/// planning with a note; after the fix a second tester pass marks it met and
/// only then does the card reach done.
#[test]
fn kanban_bounce_until_criteria_met() {
    block_on(async {
        let policy = ActionPolicy {
            mutating_default: PolicyDecision::Auto,
            ..Default::default()
        };
        let f = fixture_with(&[KANBAN, TESTER], Budgets::default(), policy).await;
        // Parent: plan the card, dispatch it, push to testing.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_add\", \"arguments\": \
             {\"title\": \"Ship widget\", \"goal\": \"build the widget\", \
             \"criteria\": [\"widget works\"], \"stage\": \"planning\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-widget\", \"stage\": \"doing\", \"assignee\": \"kanban\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-widget\", \"stage\": \"testing\"}}",
        );
        // Parent delegates verification; the tester fails the criterion and
        // bounces the card back to planning with a note.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"tester\", \"arguments\": \
             {\"goal\": \"verify card ship-widget\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_check\", \"arguments\": \
             {\"id\": \"ship-widget\", \"criterion\": 1, \"met\": false, \
             \"note\": \"widget crashes on start\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-widget\", \"stage\": \"planning\", \
             \"note\": \"bounced: widget crashes on start\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: criterion 1 unmet; bounced to planning");
        // Parent reads the bounce note, re-dispatches, delegates again; the
        // tester now passes the criterion and finishes the card.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_list\", \"arguments\": {\"id\": \"ship-widget\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-widget\", \"stage\": \"testing\", \"note\": \"fix applied\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"tester\", \"arguments\": \
             {\"goal\": \"re-verify card ship-widget\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_check\", \"arguments\": \
             {\"id\": \"ship-widget\", \"criterion\": 1, \"met\": true, \
             \"note\": \"starts cleanly now\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_move\", \"arguments\": \
             {\"id\": \"ship-widget\", \"stage\": \"done\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: all criteria met; card done");
        f.mock.push_text("action: answer\nanswer: widget shipped");
        let run = f.session.submit("kanban", "ship the widget").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("widget shipped"));
        let signals = f.host.signals();
        // Both verification passes ran as real tester delegate runs.
        let tester_runs = signals
            .iter()
            .filter(|s| matches!(&s.kind, SignalKind::RunStarted { agent_id, .. } if agent_id == "tester"))
            .count();
        assert_eq!(tester_runs, 2);
        let obs = observations(&signals);
        // The explicit planning bounce happened, and it happened BEFORE done.
        let bounce = obs
            .iter()
            .position(|o| o.contains("moved [ship-widget] testing -> planning"))
            .expect("bounce observation");
        let done = obs
            .iter()
            .position(|o| o.contains("moved [ship-widget] testing -> done"))
            .expect("done observation");
        assert!(bounce < done, "{obs:?}");
        // The bounce note is on the card (parent read it back via board_list).
        assert!(
            obs.iter()
                .any(|o| o.contains("notes:") && o.contains("widget crashes on start")),
            "{obs:?}"
        );
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// The tester delegate's verdicts are visible to the parent (its answer comes
/// back as an untrusted Result observation) and PERSIST on the shared board:
/// a follow-up board_list turn in the parent run shows the checked boxes.
#[test]
fn tester_delegate_records_verdicts() {
    block_on(async {
        let policy = ActionPolicy {
            mutating_default: PolicyDecision::Auto,
            ..Default::default()
        };
        let f = fixture_with(&[KANBAN, TESTER], Budgets::default(), policy).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_add\", \"arguments\": \
             {\"title\": \"Audit login\", \"goal\": \"audit the login page\", \
             \"criteria\": [\"a11y pass\", \"loads fast\"], \"stage\": \"testing\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"tester\", \"arguments\": \
             {\"goal\": \"verify card audit-login\"}}",
        );
        // Tester: one criterion by substring (met defaults true), one by
        // number, explicitly unmet.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_check\", \"arguments\": \
             {\"id\": \"audit-login\", \"criterion\": \"a11y\", \"note\": \"screen reader ok\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_check\", \"arguments\": \
             {\"id\": \"audit-login\", \"criterion\": 2, \"met\": false, \"note\": \"3s load time\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: a11y met, load speed unmet");
        // Parent re-reads the card in a follow-up turn, then answers.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"board_list\", \"arguments\": {\"id\": \"audit-login\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: verdicts recorded");
        let run = f.session.submit("kanban", "audit login").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        let obs = observations(&signals);
        // The tester's board_check verdicts landed in the stream.
        assert!(
            obs.iter()
                .any(|o| o.contains("criterion 1 of [audit-login] met")),
            "{obs:?}"
        );
        assert!(
            obs.iter()
                .any(|o| o.contains("criterion 2 of [audit-login] unmet")),
            "{obs:?}"
        );
        // The tester's summary reached the PARENT run as an untrusted result.
        let parent_obs: Vec<String> = signals
            .iter()
            .filter(|s| s.run_id == run)
            .filter_map(|s| match &s.kind {
                SignalKind::ObservationAppended { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert!(
            parent_obs
                .iter()
                .any(|o| o.contains("Result (untrusted): a11y met, load speed unmet")),
            "{parent_obs:?}"
        );
        // Criterion state persisted across runs: the parent's own board_list
        // sees the checked box states the tester wrote.
        let detail = parent_obs
            .iter()
            .find(|o| o.contains("[audit-login] Audit login"))
            .expect("board_list detail");
        assert!(detail.contains("1. [x] a11y pass"), "{detail}");
        assert!(detail.contains("2. [ ] loads fast"), "{detail}");
        assert_eq!(f.mock.remaining(), 0);
    });
}
