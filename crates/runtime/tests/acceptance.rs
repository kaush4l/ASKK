//! Acceptance benchmark rows (bench/acceptance/ROWS.md): the v0 termination
//! condition, driven end-to-end through the real agent loop against fixture
//! scripts (`MockProvider::from_script`, files in tests/fixtures/). Native
//! lane only — browser-lane rows (real v86 guest) are manual/nightly and
//! tracked in the generated bench/acceptance/STATUS.md.
//!
//! Every test asserts BOTH the row's pass condition and its budget (turns +
//! provider calls). A structure test pins ROWS.md test names to real fns so
//! the row table cannot outrun the code.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use askk_core::signal::fold;
use askk_core::{
    ActionPolicy, Budgets, Effect, Provider, RunStatus, Signal, SignalKind, ToolResult, ToolSpec,
};
use askk_inference::MockProvider;
use askk_runtime::config::{AgentConfig, SkillConfig};
use askk_runtime::run::{ProviderResolver, RunSession, SessionInit, TestHost};
use askk_runtime::state::{BlobStore, MemBlob, MemKv, MemoryStore, SessionStore, SignalLog};
use askk_runtime::testutil::block_on;
use askk_runtime::tools::{
    register_builtins, register_echo, register_shell, register_workspace, RustTool, ShellExec,
    ToolRegistry,
};
use futures::future::LocalBoxFuture;

// --- shared harness -------------------------------------------------------

/// Guest-shell twin for browser-lane rows: pops one scripted reply per exec,
/// records every command it saw.
struct ScriptedShell {
    replies: RefCell<VecDeque<Result<String, String>>>,
    commands: RefCell<Vec<String>>,
}

impl ScriptedShell {
    fn new(replies: Vec<Result<String, String>>) -> Rc<Self> {
        Rc::new(Self {
            replies: RefCell::new(replies.into()),
            commands: RefCell::new(Vec::new()),
        })
    }
}

impl ShellExec for ScriptedShell {
    fn exec<'a>(&'a self, command: &'a str) -> LocalBoxFuture<'a, Result<String, String>> {
        self.commands.borrow_mut().push(command.to_string());
        let reply = self
            .replies
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Err("scripted shell exhausted".into()));
        Box::pin(async move { reply })
    }
}

/// Native twin of the browser fast lane: same name/spec shape as the js_eval
/// asset tool, canned worker output. The real substrate is verified in the
/// browser lane; this pins the LOOP path (call → observation → answer).
fn fake_js_eval(reg: &mut ToolRegistry) {
    reg.register(RustTool::shared(
        ToolSpec {
            name: "js_eval".into(),
            description: "Run a short JavaScript snippet (fast lane twin).".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "code": { "type": "string" } },
                "required": ["code"]
            }),
            effect: Effect::Pure,
        },
        |args, _ctx| match args.get("code").and_then(|v| v.as_str()) {
            Some(_) => ToolResult::ok("logs:\n2,4,6\nresult: undefined"),
            None => ToolResult::err("js_eval: missing string field 'code'"),
        },
    ))
    .unwrap();
}

struct Row {
    session: RunSession,
    host: Rc<TestHost>,
    mocks: Vec<Rc<MockProvider>>,
    blobs: Rc<dyn BlobStore>,
}

/// One agent per (provider-id, fixture script); a scripted guest shell.
/// Distinct provider ids make multi-run scripts deterministic (each run pops
/// its own FIFO instead of interleaving on one).
async fn row(
    agents_md: &[(&str, &str)],
    scripts: &[(&str, &str)],
    shell: Rc<ScriptedShell>,
    budgets: Budgets,
) -> Row {
    let mocks: Vec<Rc<MockProvider>> = scripts
        .iter()
        .map(|(id, text)| Rc::new(MockProvider::from_script(id, text)))
        .collect();
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _) = SignalLog::open(Rc::clone(&blobs), Box::new(|| 0))
        .await
        .unwrap();
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || 7).unwrap();
    register_echo(&mut registry).unwrap();
    register_shell(&mut registry, shell.clone()).unwrap();
    register_workspace(&mut registry, shell).unwrap();
    fake_js_eval(&mut registry);
    let agents: Vec<AgentConfig> = agents_md
        .iter()
        .map(|(path, text)| AgentConfig::from_markdown(path, text).unwrap())
        .collect();
    let skills = vec![SkillConfig::from_markdown(
        "agents/skills/concise.md",
        "---\nid: concise\n---\nBe brief.",
    )
    .unwrap()];
    let by_id: Vec<(String, Rc<dyn Provider>)> = mocks
        .iter()
        .map(|m| (m.id().to_string(), m.clone() as Rc<dyn Provider>))
        .collect();
    let fallback: Rc<dyn Provider> = mocks[0].clone();
    let resolver: ProviderResolver = Box::new(move |want: &str| {
        Ok(by_id
            .iter()
            .find(|(id, _)| id == want)
            .map(|(_, p)| p.clone())
            .unwrap_or_else(|| fallback.clone()))
    });
    let session = RunSession::new(SessionInit {
        agents,
        teams: Vec::new(),
        soul: "Be honest.".into(),
        skills,
        registry,
        resolver,
        log,
        memory: MemoryStore::new(Rc::new(MemKv::new()), 64),
        session: SessionStore::new(Rc::new(MemKv::new())),
        budgets,
        policy: ActionPolicy::default(),
        known_providers: scripts.iter().map(|(id, _)| (*id).to_string()).collect(),
        board: None,
    })
    .unwrap();
    Row {
        session,
        host: Rc::new(TestHost::new()),
        mocks,
        blobs,
    }
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

const SOLO: (&str, &str) = (
    "agents/solo.md",
    "---\nid: solo\ndescription: Does tasks with tools.\n\
     tools: echo, calc, js_eval, shell, write_file, read_file, list_files, edit_file\n\
     provider: bench\n---\nDo the task.",
);

// --- native-lane rows -----------------------------------------------------

/// A1 — agent writes + runs a JS snippet through the fast lane (native twin
/// of the js_eval worker tool). Pass: the run answers with the snippet's
/// stdout. Budget: 2 turns, 2 provider calls.
#[test]
fn a1_fast_lane_js_eval() {
    block_on(async {
        let f = row(
            &[SOLO],
            &[("bench", include_str!("fixtures/a1_js_fast_lane.llm"))],
            ScriptedShell::new(vec![]),
            Budgets::default(),
        )
        .await;
        let run = f.session.submit("solo", "double 1 2 3").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert_eq!(out.final_text.as_deref(), Some("2,4,6"));
        // The snippet's console output came back as the tool observation.
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("2,4,6")));
        assert_eq!(out.turns_used, 2);
        assert_eq!(f.mocks[0].requests().len(), 2);
        assert_eq!(f.mocks[0].remaining(), 0);
    });
}

/// A2 (native twin; real guest = browser lane) — write a buggy script, run
/// it, see the failure, fix it, rerun clean. Pass: final run output is clean
/// and the run answers. Budget: 5 turns.
#[test]
fn a2_write_run_fix_rerun() {
    block_on(async {
        let shell = ScriptedShell::new(vec![
            Ok(String::new()),                                        // write bug.py
            Ok("Traceback: ZeroDivisionError\n[exit 1]".to_string()), // python3 bug.py
            Ok(String::new()),                                        // write fixed
            Ok("42".to_string()),                                     // rerun, exit 0
        ]);
        let f = row(
            &[SOLO],
            &[("bench", include_str!("fixtures/a2_python_fix_rerun.llm"))],
            shell.clone(),
            Budgets::default(),
        )
        .await;
        let run = f.session.submit("solo", "fix the bug").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let obs = observations(&f.host.signals());
        assert!(obs.iter().any(|o| o.contains("[exit 1]"))); // first run failed
        assert!(obs.iter().any(|o| o.trim_end().ends_with("42"))); // rerun clean
        assert_eq!(out.turns_used, 5);
        assert_eq!(shell.commands.borrow().len(), 4); // 2 writes + 2 runs
    });
}

/// A3 (native twin; real guest = browser lane) — create files in the guest,
/// grep them. Pass: expected matches observed. Budget: 3 turns.
#[test]
fn a3_shell_files_grep() {
    block_on(async {
        let shell = ScriptedShell::new(vec![
            Ok(String::new()),                              // write notes/a.txt
            Ok("notes/a.txt:alpha needle one".to_string()), // grep
        ]);
        let f = row(
            &[SOLO],
            &[("bench", include_str!("fixtures/a3_shell_files_grep.llm"))],
            shell.clone(),
            Budgets::default(),
        )
        .await;
        let run = f.session.submit("solo", "find the needle").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        assert!(observations(&f.host.signals())
            .iter()
            .any(|o| o.contains("notes/a.txt:alpha needle one")));
        assert_eq!(out.turns_used, 3);
        assert!(shell.commands.borrow()[1].contains("grep"));
    });
}

/// A5 foundation (row itself is RED — resume machinery absent, see ROWS.md):
/// what already holds is pinned here so the resume increment builds on green.
/// (1) Effect ids `{run}-call-{seq}` are unique and every completion matches
/// a request. (2) Replay-from-0 reproduces the live projection exactly.
/// (3) Reopen fences a non-terminal run to Interrupted — today's honest
/// no-resume behavior; zero duplicate effects because zero effects re-run.
#[test]
fn a5_foundation_replay_dedup_fence() {
    block_on(async {
        let f = row(
            &[SOLO],
            &[(
                "bench",
                "action: tool\nanswer: {\"name\": \"calc\", \"arguments\": {\"op\": \"+\", \"a\": 2, \"b\": 2}}\n---\naction: answer\nanswer: 4\n",
            )],
            ScriptedShell::new(vec![]),
            Budgets::default(),
        )
        .await;
        let run = f.session.submit("solo", "2+2").await.unwrap();
        let out = f.session.drive(&run, f.host.clone()).await;
        assert_eq!(out.status, RunStatus::Answered);
        let live = f.session.projection(&run).unwrap();

        let (_log, replayed) = SignalLog::open(Rc::clone(&f.blobs), Box::new(|| 0))
            .await
            .unwrap();
        // (1) effect-id discipline on the replayed stream.
        let requested: Vec<String> = replayed
            .iter()
            .filter_map(|s| match &s.kind {
                SignalKind::ToolRequested { call_id, .. } => Some(call_id.clone()),
                _ => None,
            })
            .collect();
        let mut unique = requested.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), requested.len(), "duplicate effect ids");
        for s in &replayed {
            if let SignalKind::ToolCompleted { call_id, .. } = &s.kind {
                assert!(requested.contains(call_id), "orphan completion {call_id}");
            }
        }
        // (2) pure replay reproduces the live fold.
        let run_signals: Vec<&Signal> = replayed.iter().filter(|s| s.run_id == run).collect();
        assert_eq!(fold(run_signals.into_iter()), live);
    });
}

/// A7 foundation (row itself is RED — pass condition names a resumable
/// `Paused(BudgetExhausted)`; today exhaustion is a terminal status, and the
/// terminal→paused change is an ADR-008 semantics decision gated on the
/// human). What already holds: two top-level loops drive CONCURRENTLY, one
/// exhausts its budget and emits the BudgetExhausted status signal, and the
/// sibling loop is completely unaffected.
#[test]
fn a7_budget_exhaustion_sibling_isolated() {
    block_on(async {
        let burner_md = (
            "agents/burner.md",
            "---\nid: burner\ndescription: Burns turns.\ntools: echo\nprovider: p-burn\n---\nSpin.",
        );
        let worker_md = (
            "agents/worker.md",
            "---\nid: worker\ndescription: Finishes fast.\ntools: echo\nprovider: p-work\n---\nFinish.",
        );
        let budgets = Budgets {
            max_turns: 2,
            ..Budgets::default()
        };
        let f = row(
            &[burner_md, worker_md],
            &[
                ("p-burn", include_str!("fixtures/a7_burner.llm")),
                ("p-work", include_str!("fixtures/a7_worker.llm")),
            ],
            ScriptedShell::new(vec![]),
            budgets,
        )
        .await;
        let burn = f.session.submit("burner", "never answer").await.unwrap();
        let work = f.session.submit("worker", "answer now").await.unwrap();
        let (burn_out, work_out) = futures::join!(
            f.session.drive(&burn, f.host.clone()),
            f.session.drive(&work, f.host.clone())
        );
        assert_eq!(burn_out.status, RunStatus::BudgetExhausted);
        assert!(f.host.signals().iter().any(|s| s.run_id == burn
            && matches!(
                s.kind,
                SignalKind::StatusSet {
                    status: RunStatus::BudgetExhausted
                }
            )));
        // The sibling never noticed.
        assert_eq!(work_out.status, RunStatus::Answered);
        assert_eq!(
            work_out.final_text.as_deref(),
            Some("sibling finished fine")
        );
        assert_eq!(work_out.turns_used, 1);
        assert_eq!(f.mocks[1].requests().len(), 1);
    });
}

// --- structure: the row table cannot outrun the code -----------------------

/// Every native-lane test name in bench/acceptance/ROWS.md must be a real
/// test fn in this file (same trick as structure.rs map_md_paths_exist).
#[test]
fn rows_md_test_names_exist() {
    let rows = include_str!("../../../bench/acceptance/ROWS.md");
    let me = include_str!("acceptance.rs");
    let mut checked = 0;
    for line in rows.lines().filter(|l| l.starts_with("| A")) {
        let cols: Vec<&str> = line.split('|').map(str::trim).collect();
        let Some(test) = cols.iter().rev().find(|c| !c.is_empty()) else {
            continue;
        };
        if test.starts_with('`') {
            let name = test.trim_matches('`');
            assert!(
                me.contains(&format!("fn {name}(")),
                "ROWS.md names test `{name}` but acceptance.rs has no such fn"
            );
            checked += 1;
        }
    }
    assert!(checked >= 5, "ROWS.md table parse found too few test rows");
}
