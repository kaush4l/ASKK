//! Layer-5 workflow tests (docs/TESTING.md): full runs against a scripted
//! MockProvider. Assertions target the SIGNAL STREAM first (the log is the
//! observable behavior), then the fold.

use std::rc::Rc;

use askk_core::signal::fold;
use askk_core::{ActionId, ActionPolicy, Budgets, Provider, Role, RunStatus, Signal, SignalKind};
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
        f.mock.push_text("action: answer\nresponse: 4");
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
        f.mock
            .push_text("action: tool\ntool: echo\nargs: {\"text\": \"hi\"}");
        f.mock.push_text("action: answer\nresponse: echoed");
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
            .push_text("action: tool\ntool: state_note\nargs: {\"note\": \"remember\"}");
        f.mock.push_text("action: answer\nresponse: noted");
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
            .push_text("action: tool\ntool: state_note\nargs: {\"note\": \"secret\"}");
        f.mock.push_text("action: answer\nresponse: skipped it");
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
        f.mock.push_text("action: answer\nresponse: draft v1");
        f.mock.push_text("verdict: revise\nfeedback: tighten it");
        f.mock.push_text("action: answer\nresponse: draft v2");
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
        f.mock
            .push_text("action: tool\ntool: echo\nargs: {\"text\": \"a\"}");
        f.mock
            .push_text("action: tool\ntool: echo\nargs: {\"text\": \"b\"}");
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
        f.mock
            .push_text("action: tool\ntool: echo\nargs: {\"text\": \"a\"}");
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
        f.mock.push_text("action: answer\nresponse: fixed");
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
            .push_text("action: tool\ntool: ghost\nargs: {\"x\": 1}");
        f.mock.push_text("action: answer\nresponse: ok then");
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
        f.mock
            .push_text("action: tool\ntool: worker\nargs: {\"goal\": \"do sub\"}");
        f.mock.push_text("action: answer\nresponse: sub-result");
        f.mock.push_text("action: answer\nresponse: combined");
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
        f.mock
            .push_text("action: tool\ntool: worker\nargs: {\"goal\": \"go deep\"}");
        f.mock
            .push_text("action: tool\ntool: helper\nargs: {\"goal\": \"deeper\"}");
        f.mock.push_text("action: answer\nresponse: gave up");
        f.mock.push_text("action: answer\nresponse: done");
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

#[test]
fn replay_fold_matches_final_projection() {
    block_on(async {
        let f = fixture(&[SOLO]).await;
        f.mock
            .push_text("action: tool\ntool: calc\nargs: {\"op\": \"+\", \"a\": 2, \"b\": 2}");
        f.mock.push_text("action: answer\nresponse: 4");
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
