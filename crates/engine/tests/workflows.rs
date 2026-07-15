//! Layer-5 workflow tests (docs/TESTING.md): full runs against a scripted
//! MockProvider. Assertions target the SIGNAL STREAM first (the log is the
//! observable behavior), then the fold.

use std::rc::Rc;

use askk_core::signal::fold;
use askk_core::{
    ActionId, ActionPolicy, Budgets, PolicyDecision, Provider, Role, RunStatus, Signal, SignalKind,
};
use askk_engine::config::{AgentConfig, SkillConfig, TeamConfig};
use askk_engine::run::{ProviderResolver, RunSession, SessionInit, TestHost};
use askk_engine::state::{BlobStore, MemBlob, MemKv, MemoryStore, SessionStore, SignalLog};
use askk_engine::testutil::block_on;
use askk_engine::tools::{register_builtins, register_echo, ToolRegistry};
use askk_inference::MockProvider;

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
const PICKER: (&str, &str) = (
    "agents/picker.md",
    "---\nid: picker\ndescription: Picks skills at runtime.\n\
     tools: skill_list, skill_read\n---\nYou pick skills on demand.",
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

// A team boundary fixture (ADR-032): the client holds ONLY the team tool
// (plus `state_note`), the team declares its own complete toolset, the lead's `state_note`
// is deliberately outside it, and the body is the principles probe.
const SQUAD_LEAD: (&str, &str) = (
    "agents/squad/lead.md",
    "---\nid: lead\ndescription: Leads the squad.\ntools: echo, mate, state_note\n---\nYou lead.",
);
const SQUAD_MATE: (&str, &str) = (
    "agents/squad/mate.md",
    "---\nid: mate\ndescription: Squad member.\ntools: calc\n---\nYou work.",
);
const SQUAD_TEAM: (&str, &str) = (
    "agents/squad/team.md",
    "---\nid: squad\nname: Squad\ndescription: Delegate squad work to the whole squad.\n\
     lead: lead\ntools: echo, calc, mate\n---\nSquad principle: measure twice, cut once.",
);
const CLIENT: (&str, &str) = (
    "agents/client.md",
    "---\nid: client\ndescription: Calls the squad.\ntools: squad, state_note\n---\nYou call the squad.",
);

struct Fixture {
    session: RunSession,
    host: Rc<TestHost>,
    mock: Rc<MockProvider>,
    blobs: Rc<dyn BlobStore>,
}

async fn fixture_full(
    files: &[(&str, &str)],
    team_files: &[(&str, &str)],
    budgets: Budgets,
    policy: ActionPolicy,
) -> Fixture {
    let mock = Rc::new(MockProvider::new("mock/test"));
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _) = SignalLog::open(Rc::clone(&blobs), Box::new(|| 0))
        .await
        .unwrap();
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry).unwrap();
    register_echo(&mut registry).unwrap();
    askk_engine::tools::register_artifacts(&mut registry, Rc::clone(&blobs), || 7).unwrap();
    let agents: Vec<AgentConfig> = files
        .iter()
        .map(|(path, text)| AgentConfig::from_markdown(path, text).unwrap())
        .collect();
    let teams: Vec<TeamConfig> = team_files
        .iter()
        .map(|(path, text)| TeamConfig::from_markdown(path, text).unwrap())
        .collect();
    let skills = vec![
        SkillConfig::from_markdown(
            "agents/skills/concise.md",
            "---\nid: concise\n---\nBe brief.",
        )
        .unwrap(),
        SkillConfig::from_markdown(
            "agents/skills/careful.md",
            "---\nid: careful\n---\nDouble-check everything.",
        )
        .unwrap(),
        SkillConfig::from_markdown(
            "agents/skills/tea.md",
            "---\nid: tea\nname: Tea brewing\n---\nSteep at 80C.\nNever boil green tea.",
        )
        .unwrap(),
    ];
    let provider: Rc<dyn Provider> = mock.clone();
    let resolver: ProviderResolver = Box::new(move |_| Ok(provider.clone()));
    let session = RunSession::new(SessionInit {
        agents,
        teams,
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

async fn fixture_with(files: &[(&str, &str)], budgets: Budgets, policy: ActionPolicy) -> Fixture {
    fixture_full(files, &[], budgets, policy).await
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

/// ADR-042 workflow-path: a scripted `phase.N.tool` step runs its tool
/// DETERMINISTICALLY — no LLM call — then advances to the LLM phase, which sees
/// the tool result. The mock supplies exactly ONE reply (the gate), proving the
/// scripted phase never touched the provider, and `{goal}` is substituted in.
#[test]
fn scripted_phase_runs_tool_without_an_llm_call() {
    block_on(async {
        const FLOW: (&str, &str) = (
            "agents/flow.md",
            "---\nid: flow\ndescription: Scripted fetch then verify.\ntools: echo\n\
             phase.1.name: fetch\nphase.1.tool: echo\nphase.1.args: {\"text\": \"{goal}\"}\n\
             phase.2.name: verify\nphase.2.contract: critique\nphase.2.gate: true\n---\nSummarize.",
        );
        let f = fixture(&[FLOW]).await;
        f.mock.push_text("verdict: pass"); // ONLY the gate phase calls the LLM
        let run = f.session.submit("flow", "berlin weather").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        // Exactly one provider call — the scripted phase made none.
        assert_eq!(f.mock.requests().len(), 1);
        assert_eq!(f.mock.remaining(), 0);
        let signals = f.host.signals();
        // `{goal}` was substituted into the scripted tool's args.
        assert!(
            observations(&signals)
                .iter()
                .any(|o| o == "echo: berlin weather"),
            "{:?}",
            observations(&signals)
        );
        // Deterministic: the scripted tool_requested has NO preceding llm_request.
        let stream = tags(&signals);
        let first_llm = stream.iter().position(|t| t == "llm_request");
        let first_tool = stream
            .iter()
            .position(|t| t == "tool_requested")
            .expect("scripted tool ran");
        assert!(
            first_llm.is_none_or(|i| i > first_tool),
            "scripted tool must run before any LLM call: {stream:?}"
        );
        assert_eq!(phases_entered(&signals), vec!["fetch", "verify"]);
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

// --- handoff (full transfer) -------------------------------------------------

const HAND: (&str, &str) = (
    "agents/hand.md",
    "---\nid: hand\ndescription: Hands work off.\ntools: handoff, helper, echo\n---\n\
     You hand off when the rest of the job is someone else's.",
);

/// Swarm-style full transfer: `handoff {agent, goal}` runs the target and the
/// PARENT run ends immediately as Answered with the child's answer VERBATIM —
/// no parent turn is spent rephrasing.
#[test]
fn handoff_transfers_the_run() {
    block_on(async {
        let f = fixture(&[HAND, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"handoff\", \"arguments\": {\"agent\": \"helper\", \"goal\": \"finish this\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: helper's final word"); // helper's turn
        let run = f.session.submit("hand", "start this").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("helper's final word"));
        // The parent consumed exactly ONE provider reply: no post-handoff turn.
        assert_eq!(out.turns_used, 1);
        assert_eq!(f.mock.remaining(), 0);
        let signals = f.host.signals();
        // The handoff ran the child as its own run...
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, goal } if agent_id == "helper" && goal == "finish this"
        )));
        // ...and the PARENT's own stream carries the Result terminal.
        assert!(signals.iter().any(|s| s.run_id == run
            && matches!(&s.kind, SignalKind::Result { final_text } if final_text == "helper's final word")));
    });
}

/// Handing off to an agent outside the caller's tools is a readable tool
/// error, not a transfer — the run continues and answers normally.
#[test]
fn handoff_outside_allowlist_is_refused_and_run_continues() {
    block_on(async {
        // `worker` exists in the session but is NOT in hand's tools.
        let f = fixture(&[HAND, HELPER, WORKER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"handoff\", \"arguments\": {\"agent\": \"worker\", \"goal\": \"finish this\"}}",
        );
        f.mock.push_text("action: answer\nanswer: kept it myself");
        let run = f.session.submit("hand", "start this").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("kept it myself"));
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("handoff: agent 'worker' is not in your tools")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// GAPS 17: cancel must kill an IN-FLIGHT provider call, not wait for the
/// turn to finish. The mock streams one delta then hangs forever, so the
/// only way drive can reach Ready is by dropping the stream mid-flight.
#[test]
fn cancel_aborts_an_in_flight_llm_call() {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    let f = block_on(fixture(&[SOLO]));
    f.mock.push_hang();
    let run = block_on(f.session.submit("solo", "slow prefill")).unwrap();
    let mut drive = Box::pin(f.session.drive(&run, f.host.clone()));
    let mut cx = Context::from_waker(Waker::noop());
    // The turn is mid-stream: one delta arrived, the reply never will.
    for _ in 0..10 {
        assert!(drive.as_mut().poll(&mut cx).is_pending());
    }
    assert!(f
        .host
        .signals()
        .iter()
        .any(|s| matches!(s.kind, SignalKind::LlmDelta { .. })));
    // Cancel while the run is out of the map (actively driving).
    let requested = block_on(f.session.cancel(&run));
    assert_eq!(requested.status, RunStatus::Running); // "cancellation requested"
                                                      // Bounded polls = "promptly"; Ready proves the hung stream was DROPPED,
                                                      // because awaiting it out is impossible.
    let mut out = None;
    for _ in 0..100 {
        if let Poll::Ready(o) = drive.as_mut().poll(&mut cx) {
            out = Some(o);
            break;
        }
    }
    let out = out.expect("cancel must end the in-flight turn promptly");
    assert_eq!(out.status, RunStatus::Interrupted);
    assert!(f
        .host
        .signals()
        .iter()
        .any(|s| matches!(s.kind, SignalKind::Interrupted)));
    // The hung call never produced a durable response.
    assert!(!f
        .host
        .signals()
        .iter()
        .any(|s| matches!(s.kind, SignalKind::LlmResponse { .. })));
    assert_eq!(f.mock.remaining(), 0);
}

// --- context budgeting (window + observation clamp) ---------------------------

/// A tiny context budget forces windowing: a later request carries a bounded
/// history with ONE elision marker, the newest observation survives, and the
/// goal still reaches the model (in this runtime the goal rides the
/// user_input SECTION, not history — window_history's first-user-message pin
/// is covered by core unit tests).
#[test]
fn context_window_bounds_later_request_history() {
    block_on(async {
        let budgets = Budgets {
            max_context_chars: 300,
            ..Budgets::default()
        };
        let f = fixture_with(&[SOLO], budgets, ActionPolicy::default()).await;
        let filler = "0123456789".repeat(12); // 120 chars per echo result
        for _ in 0..4 {
            f.mock.push_text(&format!(
                "action: tool\nanswer: {{\"name\": \"echo\", \"arguments\": {{\"text\": \"{filler}\"}}}}"
            ));
        }
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("solo", "budget goal").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let requests = f.mock.requests();
        let last = requests.last().unwrap();
        let markers: Vec<&askk_core::Message> = last
            .history
            .iter()
            .filter(|m| m.content.contains("elided to fit the context budget"))
            .collect();
        assert_eq!(markers.len(), 1, "exactly one marker: {:?}", last.history);
        let marker_chars = markers[0].content.chars().count();
        let total: usize = last.history.iter().map(|m| m.content.chars().count()).sum();
        assert!(
            total <= 300 + marker_chars,
            "history exceeds the context budget: {total} chars"
        );
        // The newest observation survived the window.
        assert!(last.history.iter().any(|m| m.content.contains(&filler)));
        // The goal still reaches the model through its user_input section.
        assert!(last
            .sections
            .iter()
            .any(|(k, text)| k.name() == "user_input" && text.contains("budget goal")));
        // The run's durable history never lost anything: the FIRST request
        // after windowing began still saw the marker, yet the final fold
        // replays cleanly (drive finished Answered above).
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// An oversized tool result is clipped BEFORE it re-enters history as an
/// observation; the durable ToolCompleted signal keeps the full content.
#[test]
fn oversized_observation_arrives_clipped() {
    block_on(async {
        let budgets = Budgets {
            max_observation_chars: 40,
            ..Budgets::default()
        };
        let f = fixture_with(&[SOLO], budgets, ActionPolicy::default()).await;
        let big = "a".repeat(120);
        f.mock.push_text(&format!(
            "action: tool\nanswer: {{\"name\": \"echo\", \"arguments\": {{\"text\": \"{big}\"}}}}"
        ));
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("solo", "echo big").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        let clipped = obs
            .iter()
            .find(|o| o.starts_with("echo: "))
            .expect("echo observation");
        assert_eq!(
            *clipped,
            format!("echo: {}…[clipped, kept 40 of 120 chars]", "a".repeat(40))
        );
        // Full fidelity stays on the durable signal.
        assert!(f.host.signals().iter().any(|s| matches!(
            &s.kind,
            SignalKind::ToolCompleted { content, .. } if content.chars().count() == 120
        )));
        // The clipped observation (not the full result) is what the next
        // request's history carries. The assistant's OWN tool-call message
        // still holds the full arg text — that is the model's output, not a
        // tool result — so the check targets the Tool-role observation.
        let last = f.mock.requests();
        let last = last.last().unwrap();
        assert!(last
            .history
            .iter()
            .any(|m| m.content.contains("[clipped, kept 40 of 120 chars]")));
        assert!(!last
            .history
            .iter()
            .any(|m| m.role == Role::Tool && m.content.contains(&big)));
        assert_eq!(f.mock.remaining(), 0);
    });
}

const PUBLISHER: (&str, &str) = (
    "agents/publisher.md",
    "---\nid: publisher\ndescription: Publishes deliverables as artifacts.\n\
     tools: artifact_publish\n---\nYou publish deliverables.",
);

/// The wave-15 artifact seam end to end: a scripted run publishes a markdown
/// deliverable; the slug lands in `RunProjection.artifacts` (via the
/// dispatch-emitted ArtifactAppended) and the blob is durable in the store.
#[test]
fn artifact_publish_lands_in_projection() {
    block_on(async {
        let policy = ActionPolicy {
            mutating_default: PolicyDecision::Auto, // publishes flow in tests
            ..Default::default()
        };
        let f = fixture_with(&[PUBLISHER], Budgets::default(), policy).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"artifact_publish\", \"arguments\": \
             {\"title\": \"Q3 Report\", \"kind\": \"markdown\", \"content\": \"# Q3\\n\\nAll good.\"}}",
        );
        f.mock.push_text("action: answer\nanswer: report published");
        let run = f
            .session
            .submit("publisher", "publish the report")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        // The signal stream carries the emission, then the fold shows it.
        assert!(tags(&f.host.signals()).contains(&"artifact_appended".to_string()));
        let proj = f.session.projection(&run).unwrap();
        assert_eq!(proj.artifacts, vec!["q3-report".to_string()]);
        // The observation names the slug the viewer will open.
        let obs = observations(&f.host.signals());
        assert!(
            obs.iter()
                .any(|o| o.contains("published artifact [q3-report]")),
            "{obs:?}"
        );
        // The blob round-trips as the JSON doc a viewer renders.
        let bytes = f.blobs.read("artifact/q3-report").await.unwrap().unwrap();
        let doc: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(doc["title"], "Q3 Report");
        assert_eq!(doc["kind"], "markdown");
        assert!(doc["content"].as_str().unwrap().contains("All good"));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// ADR-033: a published deliverable joins the run's live blocks — the NEXT
/// call's prompt carries the artifact's current body as latest state.
#[test]
fn published_artifact_body_is_a_live_block_on_the_next_call() {
    block_on(async {
        let policy = ActionPolicy {
            mutating_default: PolicyDecision::Auto,
            ..Default::default()
        };
        let f = fixture_with(&[PUBLISHER], Budgets::default(), policy).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"artifact_publish\", \"arguments\": \
             {\"title\": \"Spec\", \"kind\": \"markdown\", \"content\": \"# Spec v1\"}}",
        );
        f.mock.push_text("action: answer\nanswer: drafted");
        let run = f
            .session
            .submit("publisher", "draft the spec")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let requests = f.mock.requests();
        // Call 1: nothing published yet → no artifact section.
        assert!(!requests[0]
            .sections
            .iter()
            .any(|(k, _)| *k == askk_core::SectionKind::Artifact));
        // Call 2: the published body rides as live state, read from the blob.
        let (_, text) = requests[1]
            .sections
            .iter()
            .find(|(k, _)| *k == askk_core::SectionKind::Artifact)
            .expect("ARTIFACT block after publish");
        assert!(text.contains("ARTIFACT spec (live state"), "{text}");
        assert!(text.contains("# Spec v1"), "{text}");
    });
}

/// ADR-032 (a)+(c): delegating to a team drives the LEAD, the boundary RESETS
/// authority (echo is callable inside although the CALLER never held it), and
/// the team.md body reaches the lead's AND the delegated member's prompts —
/// but never the outside caller's.
#[test]
fn team_boundary_resets_authority_and_injects_principles() {
    block_on(async {
        let f = fixture_full(
            &[CLIENT, SQUAD_LEAD, SQUAD_MATE],
            &[SQUAD_TEAM],
            Budgets::default(),
            ActionPolicy::default(),
        )
        .await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"squad\", \"arguments\": {\"goal\": \"build the module\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"inside\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"mate\", \"arguments\": {\"goal\": \"crunch numbers\"}}",
        );
        f.mock.push_text("action: answer\nanswer: crunched");
        f.mock.push_text("action: answer\nanswer: module done");
        f.mock.push_text("action: answer\nanswer: all done");
        let run = f.session.submit("client", "need a module").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("all done"));
        let signals = f.host.signals();
        // The team tool drove the LEAD as its own run.
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, goal } if agent_id == "lead" && goal == "build the module"
        )));
        // Boundary reset: `echo` executed inside although the client lacks it.
        let obs = observations(&signals);
        assert!(obs.iter().any(|o| o == "echo: inside"));
        assert!(obs
            .iter()
            .any(|o| o.contains("Result (untrusted): crunched")));
        // Principles reached the lead and the member, not the caller.
        let requests = f.mock.requests();
        let section_text = |needle: &str| {
            requests
                .iter()
                .find(|r| r.sections.iter().any(|(_, s)| s.contains(needle)))
                .unwrap_or_else(|| panic!("no request containing '{needle}'"))
        };
        let has_principles = |r: &askk_core::InferenceRequest| {
            r.sections
                .iter()
                .any(|(k, s)| k.name() == "skills" && s.contains("measure twice, cut once"))
        };
        assert!(has_principles(section_text("build the module")), "lead");
        assert!(has_principles(section_text("crunch numbers")), "member");
        assert!(!has_principles(section_text("need a module")), "caller");
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// ADR-032 (b): the team's toolset is the CEILING inside the boundary — the
/// lead lists `state_note` and the caller even holds it, but the team does not
/// declare it, so inside the team it is unknown.
#[test]
fn team_toolset_is_the_ceiling_inside_the_boundary() {
    block_on(async {
        let f = fixture_full(
            &[CLIENT, SQUAD_LEAD, SQUAD_MATE],
            &[SQUAD_TEAM],
            Budgets::default(),
            ActionPolicy::default(),
        )
        .await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"squad\", \"arguments\": {\"goal\": \"what time\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"state_note\", \"arguments\": {\"note\": \"x\"}}",
        );
        f.mock.push_text("action: answer\nanswer: no clock in here");
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("client", "ask the squad").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("unknown tool 'state_note'") && o.contains("[echo, mate]")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// ADR-032 (e): the delegation depth cap counts through a team boundary — a
/// team call spends a depth level like any delegation.
#[test]
fn depth_cap_holds_through_team_boundary() {
    block_on(async {
        let budgets = Budgets {
            max_delegation_depth: 1,
            ..Budgets::default()
        };
        let f = fixture_full(
            &[CLIENT, SQUAD_LEAD, SQUAD_MATE],
            &[SQUAD_TEAM],
            budgets,
            ActionPolicy::default(),
        )
        .await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"squad\", \"arguments\": {\"goal\": \"go deep\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"mate\", \"arguments\": {\"goal\": \"deeper\"}}",
        );
        f.mock.push_text("action: answer\nanswer: gave up");
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("client", "push depth").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        // The lead (depth 1) hit the cap trying to reach its member.
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("delegation depth cap (1) reached")));
    });
}

// --- per-agent budgets declared in MD (the long-running director thread) -----

const DIRECTOR: (&str, &str) = (
    "agents/director.md",
    "---\nid: director\ndescription: Sustains a long goal-directed thread.\n\
     tools: echo\nbudget.max_turns: 20\n---\nYou direct the long thread.",
);

/// (a) `budget.max_turns: 20` outlives the session default 16: the run drives
/// past turn 16 un-nudged and the final-turn nudge fires at turn 20, not 16.
#[test]
fn declared_max_turns_extends_past_session_default() {
    block_on(async {
        let f = fixture(&[DIRECTOR]).await; // session default: max_turns 16
        for _ in 0..20 {
            f.mock.push_text(
                "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"on it\"}}",
            );
        }
        let run = f.session.submit("director", "long goal").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::BudgetExhausted);
        assert_eq!(out.turns_used, 20); // past the default 16
        assert_eq!(f.mock.remaining(), 0);
        let requests = f.mock.requests();
        assert_eq!(requests.len(), 20);
        // Turn 17's request carries no nudge; turn 20's does.
        let nudged = |i: usize| {
            requests[i]
                .history
                .iter()
                .any(|m| m.content.contains("final turn"))
        };
        assert!(!nudged(16), "nudged at the session default boundary");
        assert!(nudged(19), "no nudge on the declared final turn");
        // Exactly one nudge landed in the durable stream.
        let nudges = f
            .host
            .signals()
            .iter()
            .filter(|s| matches!(
                &s.kind,
                SignalKind::HistoryAppended { role: Role::User, text } if text.contains("final turn")
            ))
            .count();
        assert_eq!(nudges, 1);
    });
}

const STRETCH: (&str, &str) = (
    "agents/stretch.md",
    "---\nid: stretch\ndescription: Overrides only max_turns.\n\
     tools: echo\nbudget.max_turns: 4\n---\nYou stretch the thread.",
);

/// (b) Overrides compose per field: the agent's `budget.max_turns` wins over
/// the session value, while undeclared session fields (here the observation
/// clamp) still bind the same run.
#[test]
fn budget_override_composes_with_session_fields() {
    block_on(async {
        let budgets = Budgets {
            max_turns: 2, // session says 2; the agent declares 4
            max_observation_chars: 40,
            ..Budgets::default()
        };
        let f = fixture_with(&[STRETCH, SOLO], budgets, ActionPolicy::default()).await;
        let big = "b".repeat(120);
        f.mock.push_text(&format!(
            "action: tool\nanswer: {{\"name\": \"echo\", \"arguments\": {{\"text\": \"{big}\"}}}}"
        ));
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"more\"}}",
        );
        f.mock
            .push_text("action: answer\nanswer: outlived the session cap");
        let run = f.session.submit("stretch", "long goal").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        // 3 turns > the session's 2: the declared max_turns governed.
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.turns_used, 3);
        // The UNDECLARED session field still applied to the same run.
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("[clipped, kept 40 of 120 chars]")));

        // An agent WITHOUT overrides keeps every session default.
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
        assert_eq!(f.mock.remaining(), 0);
    });
}

// A four-agent chain: each link lists the next agent as a delegate tool (the
// membership guard gates WHO you may call; each child then runs with its own
// toolset, ADR-038). dhelper — the run CALLING the third delegation —
// declares `budget.depth: 3`.
const DPARENT: (&str, &str) = (
    "agents/dparent.md",
    "---\nid: dparent\ndescription: Top of the chain.\ntools: dworker, dhelper, dleaf\n---\nDelegate down.",
);
const DWORKER: (&str, &str) = (
    "agents/dworker.md",
    "---\nid: dworker\ndescription: Middle link.\ntools: dhelper, dleaf\n---\nPass it on.",
);
const DHELPER: (&str, &str) = (
    "agents/dhelper.md",
    "---\nid: dhelper\ndescription: Deep link with its own depth budget.\n\
     tools: dleaf\nbudget.depth: 3\n---\nGo one deeper.",
);
const DLEAF: (&str, &str) = (
    "agents/dleaf.md",
    "---\nid: dleaf\ndescription: Bottom of the chain.\n---\nAnswer directly.",
);

/// (c) `budget.depth: 3` on the calling run allows a delegation chain one
/// level deeper than the session default 2: dparent → dworker → dhelper →
/// dleaf succeeds (the same third hop is rejected under the default cap —
/// `delegation_depth_cap_rejects` covers that side).
#[test]
fn declared_depth_budget_allows_deeper_chain() {
    block_on(async {
        let f = fixture(&[DPARENT, DWORKER, DHELPER, DLEAF]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"dworker\", \"arguments\": {\"goal\": \"level two\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"dhelper\", \"arguments\": {\"goal\": \"level three\"}}",
        );
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"dleaf\", \"arguments\": {\"goal\": \"level four\"}}",
        );
        f.mock.push_text("action: answer\nanswer: leaf done"); // dleaf (depth 3)
        f.mock.push_text("action: answer\nanswer: helper done");
        f.mock.push_text("action: answer\nanswer: worker done");
        f.mock.push_text("action: answer\nanswer: chain complete");
        let run = f.session.submit("dparent", "go deep").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("chain complete"));
        let signals = f.host.signals();
        // The fourth level really ran — one hop past the default cap of 2.
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, goal } if agent_id == "dleaf" && goal == "level four"
        )));
        let obs = observations(&signals);
        assert!(obs
            .iter()
            .any(|o| o.contains("Result (untrusted): leaf done")));
        assert!(
            !obs.iter().any(|o| o.contains("depth cap")),
            "no hop may hit the cap: {obs:?}"
        );
        assert_eq!(f.mock.remaining(), 0);
    });
}

// Two skills on the agent; phase 1 narrows to one, phase 2 declares no
// filter (B1, wave-19: a phase is a complete context recipe).
const PHASED_SKILLS: (&str, &str) = (
    "agents/prepper.md",
    "---\nid: prepper\ndescription: Drafts then verifies.\nskills: concise, careful\n\
     phase.1.name: draft\nphase.1.skills: concise\nphase.1.header: Draft it.\n\
     phase.2.name: verify\nphase.2.contract: critique\nphase.2.gate: true\n---\nWork.",
);

/// `phase.N.skills` narrows which skills render THAT phase's sheet; a phase
/// without the key gets the agent's full skill set (mirrors `phase.N.tools`).
#[test]
fn phase_skill_filter_narrows_the_sheet() {
    block_on(async {
        let f = fixture(&[PHASED_SKILLS]).await;
        f.mock.push_text("action: answer\nanswer: drafted");
        f.mock.push_text("verdict: pass");
        let run = f.session.submit("prepper", "draft it").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let skills_section = |req: &askk_core::InferenceRequest| {
            req.sections
                .iter()
                .find(|(k, _)| *k == askk_core::SectionKind::Skills)
                .map(|(_, text)| text.clone())
                .expect("Skills section in the sheet")
        };
        let requests = f.mock.requests();
        // Call 1 (draft): only the filtered-in skill renders.
        let draft = skills_section(&requests[0]);
        assert!(draft.contains("Be brief."), "{draft}");
        assert!(
            !draft.contains("Double-check"),
            "filtered-out skill leaked into the draft phase: {draft}"
        );
        // Call 2 (verify, no filter): the full skill set renders.
        let verify = skills_section(&requests[1]);
        assert!(verify.contains("Be brief."), "{verify}");
        assert!(verify.contains("Double-check everything."), "{verify}");
        assert_eq!(f.mock.remaining(), 0);
    });
}

// ---- Skill discovery (wave-19 B5): progressive disclosure over the loaded
// skill set. skill_list is the cheap index; skill_read loads one body.

#[test]
fn skill_list_indexes_every_loaded_skill() {
    block_on(async {
        let f = fixture(&[PICKER]).await;
        f.mock
            .push_text("action: tool\nanswer: {\"name\": \"skill_list\", \"arguments\": {}}");
        f.mock.push_text("action: answer\nanswer: picked");
        let run = f
            .session
            .submit("picker", "what skills exist")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        // One row per loaded skill, in load order: id — name — first line.
        assert!(obs
            .iter()
            .any(|o| o.contains("concise — concise — Be brief.")
                && o.contains("tea — Tea brewing — Steep at 80C.")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

// ---- Stall guard (repeat-identical-mutating-call refusal, GAPS 50/61) ----

fn auto_mutating() -> ActionPolicy {
    ActionPolicy {
        mutating_default: PolicyDecision::Auto, // mutations flow, no gate parking
        ..Default::default()
    }
}

/// The 3rd consecutive identical mutating call is refused, not executed:
/// the model reads the structured refusal and can still answer.
#[test]
fn stall_guard_refuses_third_identical_mutating_call() {
    block_on(async {
        let f = fixture_with(&[SOLO], Budgets::default(), auto_mutating()).await;
        for _ in 0..3 {
            f.mock.push_text(
                "action: tool\nanswer: {\"name\": \"state_note\", \"arguments\": {\"note\": \"same\"}}",
            );
        }
        f.mock.push_text("action: answer\nanswer: moving on");
        let run = f.session.submit("solo", "note it").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("moving on"));
        let obs = observations(&f.host.signals());
        assert!(
            obs.iter()
                .any(|o| o.contains("repeat detected") && o.contains("state_note")),
            "missing refusal: {obs:?}"
        );
        // Side-effect count: the note landed exactly twice, never a third time.
        assert_eq!(obs.iter().filter(|o| o.contains("noted (")).count(), 2);
        assert!(!obs.iter().any(|o| o.contains("noted (3 total)")));
    });
}

/// Same tool, DIFFERENT args each time: no repeat, all three execute.
#[test]
fn stall_guard_ignores_same_tool_with_different_args() {
    block_on(async {
        let f = fixture_with(&[SOLO], Budgets::default(), auto_mutating()).await;
        for i in 0..3 {
            f.mock.push_text(&format!(
                "action: tool\nanswer: {{\"name\": \"state_note\", \"arguments\": {{\"note\": \"n{i}\"}}}}"
            ));
        }
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("solo", "note things").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(
            !obs.iter().any(|o| o.contains("repeat detected")),
            "{obs:?}"
        );
        assert!(obs.iter().any(|o| o.contains("noted (3 total)")));
    });
}

/// Pure tools are exempt: status-poll-style repetition is legitimate.
#[test]
fn stall_guard_exempts_pure_tools() {
    block_on(async {
        let f = fixture_with(&[SOLO], Budgets::default(), auto_mutating()).await;
        for _ in 0..5 {
            f.mock.push_text(
                "action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"poll\"}}",
            );
        }
        f.mock.push_text("action: answer\nanswer: polled");
        let run = f.session.submit("solo", "poll away").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(
            !obs.iter().any(|o| o.contains("repeat detected")),
            "{obs:?}"
        );
        assert_eq!(obs.iter().filter(|o| *o == "echo: poll").count(), 5);
    });
}

/// A different mutating call in between resets the streak: A, A, B, A never
/// reaches three consecutive.
#[test]
fn stall_guard_resets_on_a_different_mutating_call() {
    block_on(async {
        let f = fixture_with(&[SOLO], Budgets::default(), auto_mutating()).await;
        for note in ["a", "a", "b", "a"] {
            f.mock.push_text(&format!(
                "action: tool\nanswer: {{\"name\": \"state_note\", \"arguments\": {{\"note\": \"{note}\"}}}}"
            ));
        }
        f.mock.push_text("action: answer\nanswer: varied");
        let run = f.session.submit("solo", "note it").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(
            !obs.iter().any(|o| o.contains("repeat detected")),
            "{obs:?}"
        );
        assert!(obs.iter().any(|o| o.contains("noted (4 total)")));
    });
}

#[test]
fn skill_read_returns_the_full_body() {
    block_on(async {
        let f = fixture(&[PICKER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"skill_read\", \"arguments\": {\"id\": \"tea\"}}",
        );
        f.mock.push_text("action: answer\nanswer: brewed");
        let run = f
            .session
            .submit("picker", "read the tea skill")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        // Name header + the WHOLE body, not just the index line.
        assert!(obs.iter().any(|o| o.contains("# Tea brewing")
            && o.contains("Steep at 80C.")
            && o.contains("Never boil green tea.")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

#[test]
fn skill_read_unknown_id_names_the_valid_ids() {
    block_on(async {
        let f = fixture(&[PICKER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"skill_read\", \"arguments\": {\"id\": \"ghost\"}}",
        );
        f.mock.push_text("action: answer\nanswer: no such skill");
        let run = f.session.submit("picker", "read ghost").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        // The structured rejection is an observation; the run still answers.
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("no such skill"));
        let obs = observations(&f.host.signals());
        assert!(obs.iter().any(|o| o.contains("unknown skill 'ghost'")
            && o.contains("concise")
            && o.contains("tea")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

// --- spawn_agent: runtime sub-agents by specialization -----------------------

const SPAWNER: (&str, &str) = (
    "agents/spawner.md",
    "---\nid: spawner\ndescription: Spawns specialized sub-agents.\n\
     tools: echo, spawn_agent, deputy\n---\nYou spawn specialists.",
);
const DEPUTY: (&str, &str) = (
    "agents/deputy.md",
    "---\nid: deputy\ndescription: Mid-level worker that can spawn.\n\
     tools: echo, spawn_agent\n---\nYou work and may spawn.",
);

/// (1) Happy path: the child runs under its synthesized id with the base's
/// loop, the directive and replacement skill reach its prompt, and its
/// answer comes back untrusted like any delegation.
#[test]
fn spawn_agent_specializes_and_answers() {
    block_on(async {
        let f = fixture(&[SPAWNER, DEPUTY, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_agent\", \"arguments\": {\"base\": \"worker\", \
             \"goal\": \"summarize x\", \"directive\": \"Be terse.\", \"tools\": [\"echo\"], \
             \"skills\": [\"concise\"], \"max_turns\": 4}}",
        );
        f.mock.push_text("action: answer\nanswer: x summarized");
        f.mock.push_text("action: answer\nanswer: relayed");
        let run = f
            .session
            .submit("spawner", "spawn a summarizer")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("relayed"));
        let signals = f.host.signals();
        // The child ran as its own run under the synthesized id, with the
        // same lifecycle signals as a delegated run.
        assert!(signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, goal }
                if agent_id == "spawned-worker-1" && goal == "summarize x"
        )));
        // Its answer came back untrusted.
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("Result (untrusted): x summarized")));
        // The directive and the replacement skill reached the child's prompt.
        let child_request = f
            .mock
            .requests()
            .into_iter()
            .find(|r| r.sections.iter().any(|(_, s)| s.contains("summarize x")))
            .expect("child request");
        assert!(child_request
            .sections
            .iter()
            .any(|(_, s)| s.contains("Be terse.")));
        assert!(child_request
            .sections
            .iter()
            .any(|(_, s)| s.contains("Be brief.")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// (2) A `tools` arg outside the base's toolset is a structured error
/// observation — authority never widens — and no child run ever starts.
#[test]
fn spawn_agent_rejects_tools_outside_base() {
    block_on(async {
        let f = fixture(&[SPAWNER, DEPUTY, WORKER, HELPER]).await;
        // `calc` is a registered tool, but not one of worker's.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_agent\", \"arguments\": {\"base\": \"worker\", \
             \"goal\": \"g\", \"tools\": [\"calc\"]}}",
        );
        f.mock.push_text("action: answer\nanswer: gave up");
        let run = f.session.submit("spawner", "try widening").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("spawn_agent")
                && o.contains("tool 'calc' is not in base agent 'worker'")));
        assert!(
            !signals.iter().any(|s| matches!(
                &s.kind,
                SignalKind::RunStarted { agent_id, .. } if agent_id.starts_with("spawned-")
            )),
            "no child run may start on a rejected spawn"
        );
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// (3) An unknown skill id is a structured error observation; no child run.
#[test]
fn spawn_agent_rejects_unknown_skill() {
    block_on(async {
        let f = fixture(&[SPAWNER, DEPUTY, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_agent\", \"arguments\": {\"base\": \"worker\", \
             \"goal\": \"g\", \"skills\": [\"ghostskill\"]}}",
        );
        f.mock.push_text("action: answer\nanswer: gave up");
        let run = f.session.submit("spawner", "bad skill").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let signals = f.host.signals();
        assert!(observations(&signals)
            .iter()
            .any(|o| o.contains("spawn_agent: unknown skill 'ghostskill'")));
        assert!(!signals.iter().any(|s| matches!(
            &s.kind,
            SignalKind::RunStarted { agent_id, .. } if agent_id.starts_with("spawned-")
        )));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// (4) The same depth cap as delegation: at max depth, spawn_agent rejects
/// before resolving anything and the caller reads the structured error.
#[test]
fn spawn_agent_depth_cap_rejects() {
    block_on(async {
        let budgets = Budgets {
            max_delegation_depth: 1,
            ..Budgets::default()
        };
        let f = fixture_with(
            &[SPAWNER, DEPUTY, WORKER, HELPER],
            budgets,
            ActionPolicy::default(),
        )
        .await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"deputy\", \"arguments\": {\"goal\": \"go deep\"}}",
        );
        // deputy (depth 1) hits the cap trying to spawn.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_agent\", \"arguments\": {\"goal\": \"deeper\"}}",
        );
        f.mock.push_text("action: answer\nanswer: gave up");
        f.mock.push_text("action: answer\nanswer: done");
        let run = f.session.submit("spawner", "orchestrate").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("spawn_agent: delegation depth cap (1) reached")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

/// (5) A delegation is an authority boundary (ADR-038): the spawned child runs
/// with its BASE agent's declared toolset, so it may use a base tool the CALLER
/// does not hold — spawner has no `helper`, yet the worker-based child
/// (echo, helper) uses it successfully. The base⊆ clamp
/// (`spawn_agent_rejects_tools_outside_base`) is the only tool ceiling; the
/// caller's toolset is not.
#[test]
fn spawn_agent_child_runs_with_base_toolset() {
    block_on(async {
        let f = fixture(&[SPAWNER, DEPUTY, WORKER, HELPER]).await;
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"spawn_agent\", \"arguments\": {\"base\": \"worker\", \
             \"goal\": \"use helper\"}}",
        );
        // The child uses a base tool the caller (spawner) does not hold.
        f.mock.push_text(
            "action: tool\nanswer: {\"name\": \"helper\", \"arguments\": {\"goal\": \"sub\"}}",
        );
        f.mock.push_text("action: answer\nanswer: helped"); // helper
        f.mock.push_text("action: answer\nanswer: used helper"); // child
        f.mock.push_text("action: answer\nanswer: done"); // spawner
        let run = f.session.submit("spawner", "boundary check").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(
            !obs.iter().any(|o| o.contains("unknown tool 'helper'")),
            "child must run with the base's toolset, not caller ∩ base: {obs:?}"
        );
        assert!(obs.iter().any(|o| o.contains("Result (untrusted): helped")));
        assert_eq!(f.mock.remaining(), 0);
    });
}

// A OneShot phase that never answers exhausts its small fixed allowance
// instead of holding the phase open to the whole run budget (live wave-19
// finding: gemma re-called a filtered tool in `plan` for minutes).
const STUBBORN: (&str, &str) = (
    "agents/stubborn.md",
    "---\nid: stubborn\ndescription: Calls tools in plan forever.\ntools: echo\n\
     phase.1.name: plan\nphase.1.header: Plan it.\n\
     phase.2.name: do\nphase.2.gate: true\n---\nWork.",
);

#[test]
fn one_shot_phase_exhausts_after_its_allowance() {
    block_on(async {
        let f = fixture(&[STUBBORN]).await;
        for i in 0..4 {
            f.mock.push_text(&format!(
                "action: tool\nanswer: {{\"name\": \"echo\", \"arguments\": {{\"text\": \"{i}\"}}}}"
            ));
        }
        let run = f
            .session
            .submit("stubborn", "plan something")
            .await
            .unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        // Exhaustion without an answer is never success (ADR-008); the
        // gate phase was never reached, so the run ends Unverified.
        assert_eq!(out.status, RunStatus::Unverified);
        assert_eq!(phases_entered(&f.host.signals()), vec!["plan"]);
        assert_eq!(f.mock.remaining(), 0);
    });
}
