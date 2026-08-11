//! Who is loaded, and what state they are in. Split from `agents.rs` (which
//! renders the listing) so both hold the 200-line rule (I12).
//!
//! Agents are DATA, not code — `public/agents/<name>/agent.md`, served as
//! static assets and fetched at boot, so editing a file and redeploying
//! changes an agent's behaviour with no rebuild.

use kernel::{EventKind, EventLog, Status};

use crate::app::App;

/// Agents compiled into the binary, so a first paint (or a failed fetch) is
/// never an app with no agents at all. The summarizer is the Python
/// project's built-in — `core/agents/summarizer` there, the same file here.
/// It is listed FIRST wherever it is merged, which is what makes a project
/// agent of the same name replace it (Python `registry._agent_dirs`).
pub fn builtin_files() -> Vec<(String, String)> {
    vec![(
        "summarizer".into(),
        include_str!("../../../public/agents/summarizer/agent.md").into(),
    )]
}

/// Install the fetched `public/agents/` files: built-ins first so a project
/// agent of the same name wins, malformed files skipped (they cost that one
/// agent, never the boot), and `main`'s prompt adopted by the running agent.
/// Called by the composition root right after `boot`.
pub fn install_agents(app: &mut App, fetched: Vec<(String, String)>) {
    install_agents_as(app, fetched, crate::app::ENTRY_AGENT)
}

/// What a replayed log already says about one agent: how many turns it has
/// taken, and whether the last thing that happened to it was a failure.
///
/// A reload is a new process, so nobody is Working or Starting any more — but
/// a turn count and a failure are facts about the PAST, and wiping them made
/// the board disagree with the transcript beside it (`ux-walker`, 06).
fn replayed(log: &EventLog, name: &str) -> (u32, Option<String>) {
    let mut turns = 0u32;
    let mut last: Option<(Status, String)> = None;
    for event in log.iter() {
        let EventKind::AgentStatus {
            agent,
            status,
            detail,
        } = &event.kind
        else {
            continue;
        };
        if agent != name {
            continue;
        }
        turns += u32::from(*status == Status::Working);
        last = Some((*status, detail.clone()));
    }
    match last {
        Some((Status::Failed, detail)) => (turns, Some(detail)),
        _ => (turns, None),
    }
}

/// The same install, for an agent that is NOT `main` — a sub-agent booting in
/// its own Worker adopts its own file and gets its own toolbox (increment 06).
/// One function, two callers, so a sub-agent's engine is built exactly the way
/// the lead's is (I9).
pub fn install_agents_as(app: &mut App, fetched: Vec<(String, String)>, adopt: &str) {
    let from_project: Vec<String> = fetched.iter().map(|(n, _)| n.clone()).collect();
    let compiled_in: Vec<String> = builtin_files().into_iter().map(|(n, _)| n).collect();
    let files = builtin_files().into_iter().chain(fetched);
    let (specs, problems) = agent::load_agents(files);
    app.agents = specs;
    app.agent_problems = problems;
    app.me = adopt.to_string();
    // Every loaded agent gets a row, the way the Python registers one per
    // thread. Registration is NOT an event: a reload is a new process, so a
    // replayed `working` must not survive into it.
    let now = app.ports.clock.now();
    let peers = app.agents.clone();
    for spec in &peers {
        // A project agent of the same name REPLACES the built-in (increment
        // 03); the row says "agents" because the file that won is the
        // project's, exactly as the Python's `_agent_dirs` decides the origin.
        let is_builtin = compiled_in.contains(&spec.name) && !from_project.contains(&spec.name);
        app.board.register(&spec.name, is_builtin, now);
        let (turns, failure) = replayed(&app.log, &spec.name);
        app.board.restore(&spec.name, turns);
        // This process's OWN agent has no Worker to come up — it is the loop
        // reading this line. Everyone else is `Starting` until their Worker
        // says otherwise (Python `_start`: register STARTING, then IDLE), and
        // a Worker that never reports is visibly still coming up rather than
        // pretending to be an idle agent nobody has called.
        let status = match (&failure, spec.name == adopt) {
            (Some(_), _) => Status::Failed,
            (None, true) => Status::Waiting,
            (None, false) => Status::Starting,
        };
        app.board
            .set(&spec.name, status, failure.as_deref().unwrap_or(""), now);
    }
    if let Some(mine) = peers.iter().find(|s| s.name == adopt) {
        agent::adopt_spec(&mut app.agent, mine, &peers);
    }
    let names: Vec<&str> = app.agents.iter().map(|s| s.name.as_str()).collect();
    app.append(EventKind::Custom {
        kind: "core.agents_loaded".into(),
        payload_json: serde_json::to_string(&names).unwrap_or_else(|_| "[]".into()),
    });
}

/// What the composition root knows and the core cannot: an agent's Worker came
/// up, refused to start, or was stopped. The Python's `_start` and `aclose`
/// write exactly these — `Status::FAILED` with `str(e)`, `Status::CLOSED` after
/// the thread stops — and before this an agent with NO WORKER AT ALL rendered
/// as "idle — nobody has called it", the one row that should have said the
/// agent is unusable.
///
/// Not the seam: this is not a UI interaction (I4), it is the host reporting a
/// lifecycle fact, and it lands as an `AgentStatus` event like every other
/// status move (I8).
pub fn report_agent(app: &mut App, agent: &str, status: Status, detail: &str) {
    // A REBOOT IS NOT AN OUTCOME. Every sub-agent's Worker is constructed again
    // on every page load and announces `Starting` then `Idle`; letting that
    // overwrite a replayed `Failed` made the board say "idle — it answered"
    // beside a transcript in which every turn of that agent had failed, while
    // `main` — which has no Worker — correctly stayed failed (`ux-walker`,
    // increment 07). A fresh load means the same thing for both kinds of agent
    // now: the last recorded outcome, until a new turn produces another one.
    let failed = app
        .board
        .get(agent)
        .is_some_and(|r| r.status == Status::Failed);
    if failed && matches!(status, Status::Starting | Status::Idle) {
        return;
    }
    app.set_status(agent, status, detail);
}

/// What a sub-agent's Worker says about its OWN working memory: how many
/// entries it holds and whether the oldest are a summary. The page cannot
/// compute this — that window lives in another Wasm instance — and an
/// increment whose headline is per-agent memory that showed one agent out of
/// three was the finding this closes (`ux-walker`, increment 08).
///
/// Not the seam (I4): the host reporting a fact, exactly like `report_agent`,
/// and it lands as an event so the pane stays a projection (I8). Unchanged
/// reports are dropped — a number that did not move is not news.
pub fn report_memory(app: &mut App, agent: &str, window: usize, summary: Option<&str>) {
    let payload = serde_json::json!({
        "agent": agent,
        "window": window,
        "summary": summary,
    })
    .to_string();
    let already = app
        .log
        .iter()
        .filter_map(|e| match &e.kind {
            EventKind::Custom { kind, payload_json } if kind == "core.agent_memory" => {
                (crate::told::agent_of(payload_json) == agent).then(|| payload_json.clone())
            }
            _ => None,
        })
        .last();
    if already.as_deref() == Some(payload.as_str()) {
        return;
    }
    app.append(EventKind::Custom {
        kind: "core.agent_memory".into(),
        payload_json: payload,
    });
}
