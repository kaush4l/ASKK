//! The status table and the sub-agent-as-tool rules, on the host with no
//! browser (I3). These are the Python behaviours increment 06 claims parity
//! with — `core/state.py`'s six statuses and its two counting rules, and
//! `core/tools.py::Tool.from_engine`'s argument reading.

use agent::{goal_from, toolbox_for, AgentSpec, Board};
use kernel::{Status, Timestamp};

fn at(ms: i64) -> Timestamp {
    Timestamp(ms)
}

fn spec(name: &str, tools: &[&str]) -> AgentSpec {
    AgentSpec {
        name: name.into(),
        description: format!("{name} does a thing"),
        model: String::new(),
        temperature: None,
        engine: "react".into(),
        role: String::new(),
        stages: Vec::new(),
        faculties: Vec::new(),
        tools: tools.iter().map(|t| (*t).to_string()).collect(),
        space: String::new(),
        compact_at: 75,
        keep_recent: 24,
        max_rounds: 64,
        passes: 1,
        goal: agent::Goal::default(),
        prompt: "body".into(),
    }
}

/// All six, and only these six. A registered agent starts in `Starting` — its
/// Worker exists, its engine does not yet.
#[test]
fn six_statuses_and_a_fresh_agent_is_starting() {
    let mut board = Board::default();
    board.register("main", false, at(1));
    assert_eq!(board.get("main").map(|r| r.status), Some(Status::Starting));
    for status in [
        Status::Idle,
        Status::Working,
        Status::Waiting,
        Status::Failed,
        Status::Closed,
    ] {
        board.set("main", status, "", at(2));
        assert_eq!(board.get("main").unwrap().status, status);
        assert_eq!(board.get("main").unwrap().status.label(), status.label());
    }
}

/// The Python's `turns + (status is Status.WORKING)`: entering Working counts,
/// and nothing else does — an agent that idles, waits, fails and closes has
/// taken no turns at all.
#[test]
fn turns_increment_only_on_entry_to_working() {
    let mut board = Board::default();
    board.register("main", false, at(1));
    for status in [Status::Idle, Status::Waiting, Status::Failed, Status::Closed] {
        board.set("main", status, "", at(2));
    }
    assert_eq!(board.get("main").unwrap().turns, 0, "no turn was taken");

    board.set("main", Status::Working, "", at(3));
    board.set("main", Status::Waiting, "", at(4));
    board.set("main", Status::Working, "", at(5));
    board.set("main", Status::Waiting, "", at(6));
    assert_eq!(board.get("main").unwrap().turns, 2, "two turns, two entries");
    assert!(board.busy().is_empty(), "waiting is not busy");
}

/// `Waiting` and `Idle` are both "not busy" and are NOT the same thing: the
/// entry agent waits on a person, a sub-agent goes back to idle because its
/// caller already has what it asked for.
#[test]
fn waiting_is_the_entry_agent_and_idle_is_a_sub_agent() {
    let mut board = Board::default();
    board.register("main", false, at(1));
    board.register("summarizer", true, at(1));
    board.set("main", Status::Waiting, "", at(2));
    board.set("summarizer", Status::Idle, "", at(2));
    assert_ne!(Status::Waiting, Status::Idle);
    assert_eq!(board.get("main").unwrap().status, Status::Waiting);
    assert_eq!(board.get("summarizer").unwrap().status, Status::Idle);
    // Rows are by name, and the origin travels with them.
    let names: Vec<&str> = board.snapshot().iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["main", "summarizer"]);
    assert!(board.get("summarizer").unwrap().builtin);
    assert!(board.get("main").unwrap().line().contains("[agents]"));
}

/// A failure records the MESSAGE, not just the status — a board that says
/// "failed" and nothing else has told the user nothing (Python
/// `STATE.set(name, FAILED, str(e))`).
#[test]
fn a_failure_records_its_message() {
    let mut board = Board::default();
    board.register("researcher", false, at(1));
    board.set("researcher", Status::Working, "", at(2));
    board.set("researcher", Status::Failed, "endpoint unreachable", at(3));
    let row = board.get("researcher").unwrap();
    assert_eq!(row.status, Status::Failed);
    assert_eq!(row.detail, "endpoint unreachable");
    assert!(row.line().contains("endpoint unreachable"), "{}", row.line());
    assert_eq!(row.turns, 1, "the failed turn still happened");
}

/// A reload is a new process: re-registering an agent resets its row, so a
/// previous session's `working` cannot survive onto a fresh board.
#[test]
fn registering_again_resets_the_row() {
    let mut board = Board::default();
    board.register("main", false, at(1));
    board.set("main", Status::Working, "boom", at(2));
    board.register("main", false, at(3));
    let row = board.get("main").unwrap();
    assert_eq!((row.status, row.turns, row.detail.as_str()), (Status::Starting, 0, ""));
}

/// The Python's toolkit rule: an empty `tools:` means every built-in; a named
/// list is a filter over built-ins AND peers in one breath. A peer is attached
/// ONLY when named — the summarizer is nobody's tool by default.
#[test]
fn the_frontmatter_tools_list_decides_the_toolbox() {
    let peers = vec![spec("main", &[]), spec("summarizer", &[]), spec("researcher", &[])];

    let all = toolbox_for(&spec("main", &[]), &peers);
    let names: Vec<&str> = all.tools.iter().map(|t| t.name.as_str()).collect();
    // `write_agent` is in this list from increment 11 on, and deliberately:
    // "empty means every built-in" is the Python rule, and carving one tool
    // out of it would make authoring a privileged capability the toolbox
    // resolves differently from every other (I9). The consequence is that an
    // agent with an empty `tools:` can author agents — which is why the Agents
    // card prints the RESOLVED toolbox rather than the frontmatter's.
    // `spawn_agent` (increment 27) joins it on exactly that rule.
    assert_eq!(
        names,
        [
            "now",
            "list_agents",
            "read_agent",
            "write_agent",
            "spawn_agent",
            "web_search",
            // Skills are built-ins on the same rule: they run nothing, and a
            // skill's body stays out of the window until `read_skill` asks.
            "list_skills",
            "read_skill"
        ]
    );
    assert!(all.tools.iter().all(|t| !t.agent), "no peer was attached");

    let picked = toolbox_for(&spec("main", &["now", "researcher"]), &peers);
    let names: Vec<&str> = picked.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["now", "researcher"]);
    let sub = picked.get("researcher").expect("the peer is a tool");
    assert!(sub.agent, "a sub-agent is marked as one");
    assert!(sub.usage().contains("\"query\""), "{}", sub.usage());
    assert!(sub.usage().contains("researcher does a thing"));

    // Itself is not a tool, and a name that is nothing is silently nothing.
    let self_ref = toolbox_for(&spec("main", &["main", "nobody"]), &peers);
    assert!(self_ref.is_empty());
}

/// `Tool.from_engine`'s argument reading, which the Python found BY TEST: the
/// goal comes from `query`, or from whatever single string the caller did
/// write, and nothing usable is an ERROR — never an empty run, because a
/// sub-agent cannot tell an empty goal from a hard one and answers either way.
#[test]
fn a_sub_agent_is_never_started_on_an_empty_goal() {
    assert_eq!(
        goal_from("researcher", r#"{"query": "  find the price  "}"#),
        Ok("find the price".to_string())
    );
    // The wrong key still meant the same thing.
    assert_eq!(
        goal_from("researcher", r#"{"task": "find the price"}"#),
        Ok("find the price".to_string())
    );
    // `query` present but empty falls through to what WAS written.
    assert_eq!(
        goal_from("researcher", r#"{"query": "", "goal": "find it"}"#),
        Ok("find it".to_string())
    );
    for args in ["{}", r#"{"query": "   "}"#, "not json at all", "[1,2]"] {
        let refusal = goal_from("researcher", args).expect_err(args);
        assert!(refusal.contains("no goal given"), "{refusal}");
        assert!(refusal.contains("researcher({\"query\""), "{refusal}");
    }
}
