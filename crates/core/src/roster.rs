//! WHO is loaded, once agents can be authored in the browser (increment 11):
//! the authored set folded out of the log, and the one function that makes the
//! running app agree with it. The ROUTES are `authoring.rs`.
//!
//! An authored agent is not a second kind of agent: it is the same `agent.md`
//! `public/agents/` serves, held as a fact in the event log instead of as a
//! file on a static host — which is why it survives a refresh (the log is
//! replayed at boot), why deleting one is just another fact (I10), and why it
//! is projected rather than stored twice (I8).
//!
//! PRECEDENCE, one rule — the Python `registry._agent_dirs` order plus one
//! step: built-ins, then `public/agents/`, then what this browser authored.
//! Last wins, so authoring `main` OVERRIDES the shipped `main` and deleting
//! that record reverts to the file. A live prompt edit is exactly this.

use kernel::{EventKind, EventLog, Status};

use crate::app::App;

/// An agent was written or replaced in this browser. Payload: `[name, text]`.
pub(crate) const AUTHORED: &str = "core.agent_authored";
/// An authored record was removed. Payload: the name.
pub(crate) const DELETED: &str = "core.agent_deleted";

/// Every agent this browser has authored and not deleted, as `(name, text)`
/// in the order they were first written — a fold over the log, like every
/// other view (I8).
pub(crate) fn authored(log: &EventLog) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = Vec::new();
    for event in log.iter() {
        let EventKind::Custom { kind, payload_json } = &event.kind else {
            continue;
        };
        if kind == DELETED {
            if let Ok(name) = serde_json::from_str::<String>(payload_json) {
                found.retain(|(n, _)| *n != name);
            }
        } else if kind == AUTHORED {
            if let Ok((name, text)) = serde_json::from_str::<(String, String)>(payload_json) {
                match found.iter().position(|(n, _)| *n == name) {
                    Some(i) => found[i].1 = text,
                    None => found.push((name, text)),
                }
            }
        }
    }
    found
}

/// What THIS process authored — what a Worker hands back (`report_authored`).
pub fn authored_here(app: &App) -> Vec<(String, String)> {
    authored(&app.log)
}

/// An agent a SUB-AGENT wrote, adopted by the page. A Worker is its own Wasm
/// instance with its own event log, so `write_agent` called there records the
/// fact THERE and the page would never see it — the create-agent superagent
/// would report success and install nothing. Not the seam (I4): the host
/// reporting a fact, exactly like `report_agent` and `report_memory`, landing
/// as the same event the page's own form emits so there is one record and one
/// precedence rule. An identical repeat is dropped — a Worker re-reports its
/// whole authored set every turn.
pub fn report_authored(app: &mut App, name: &str, text: &str) {
    if authored(&app.log)
        .iter()
        .any(|(n, t)| n == name && t == text)
    {
        return;
    }
    app.append(EventKind::Custom {
        kind: AUTHORED.into(),
        payload_json: serde_json::to_string(&(name, text)).unwrap_or_default(),
    });
}

/// Make the running app agree with the authored set the log now holds.
///
/// DEFERRED WHILE A TURN IS IN FLIGHT. Swapping an agent's prompt between the
/// model call and the reply it is waiting for would assemble the rest of that
/// turn out of one file and the history of another's — the crossed-projection
/// class of bug increment 07 already produced once. `task` is `Some` exactly
/// from the utterance that starts a turn to the answer that ends it, so this
/// takes effect at a TURN BOUNDARY and the conversation is never disturbed.
pub(crate) fn reconcile(app: &mut App) {
    let want = authored(&app.log);
    if want == app.authored || app.agent.task.is_some() {
        return;
    }
    let files = crate::install::builtin_files()
        .into_iter()
        .chain(app.files.clone())
        .chain(want.clone());
    let (specs, problems) = agent::load_agents(files);
    let gone: Vec<String> = app
        .agents
        .iter()
        .filter(|s| !specs.iter().any(|n| n.name == s.name))
        .map(|s| s.name.clone())
        .collect();
    let fresh: Vec<String> = specs
        .iter()
        .filter(|s| !app.agents.iter().any(|o| o.name == s.name))
        .map(|s| s.name.clone())
        .collect();
    (app.authored, app.agents, app.agent_problems) = (want, specs, problems);
    rows(app, &gone, &fresh);
    let peers = app.agents.clone();
    let me = app.me.clone();
    if let Some(mine) = peers.iter().find(|s| s.name == me) {
        // The prompt, the toolbox and the space change; the paper's HISTORY is
        // untouched, which is what "the next turn uses the new one with the
        // conversation intact" means.
        agent::adopt_spec(&mut app.agent, mine, &peers);
    }
    let names: Vec<&str> = app.agents.iter().map(|s| s.name.as_str()).collect();
    app.append(EventKind::Custom {
        kind: "core.agents_loaded".into(),
        payload_json: serde_json::to_string(&names).unwrap_or_else(|_| "[]".into()),
    });
}

/// Board rows for agents that just appeared or went away. Only those:
/// re-registering everyone would reset running agents to `starting` and leave
/// them there — their Workers already reported and will not again.
fn rows(app: &mut App, gone: &[String], fresh: &[String]) {
    let now = app.ports.clock.now();
    let me = app.me.clone();
    for name in gone {
        app.board.forget(name);
    }
    for name in fresh {
        app.board.register(name, false, now);
        let status = match *name == me {
            true => Status::Waiting,
            false => Status::Starting,
        };
        app.board.set(name, status, "", now);
    }
}

/// The `write_agent` tool (increment 11's superagent runs on this one). An
/// ORDINARY tool: it appends the same fact the UI's form does, so an agent a
/// model wrote and one a person wrote are the same record, get the same
/// Worker, and are told apart on screen only by who wrote them (I9). The
/// capability it ends up with still comes from its SPACE and nowhere else.
pub(crate) fn write_agent(app: &mut App, args_json: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(args_json).unwrap_or_default();
    let field = |k: &str| {
        value
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let (name, prompt) = (field("name"), field("prompt"));
    if !agent::usable_agent_name(&name) {
        return Err(format!(
            "'{name}' cannot be an agent name — letters, digits, - and _ only. Call it as \
             write_agent({{\"name\": \"<name>\", \"description\": \"<one line>\", \
             \"prompt\": \"<the system prompt>\", \"tools\": \"\", \"space\": \"\"}})"
        ));
    }
    if prompt.is_empty() {
        return Err("no prompt given. An agent with no system prompt has no instructions at \
                    all; write the whole prompt as the 'prompt' argument."
            .into());
    }
    let tools: Vec<String> = field("tools").split(',').map(|t| t.trim().to_string()).collect();
    // A space that could never BE a space is dropped rather than written into
    // the file: `Space::named` would refuse it anyway, so keeping the string
    // would only put a capability line on the card that grants nothing. A real
    // name survives untouched.
    let space = agent::Space::named(&field("space")).map(|s| s.name).unwrap_or_default();
    let spec = agent::new_spec(&name, &field("description"), &unescaped(&prompt), &tools, &space);
    let text = agent::render_agent_file(&spec);
    app.append(EventKind::Custom {
        kind: AUTHORED.into(),
        payload_json: serde_json::to_string(&(name.clone(), text)).unwrap_or_default(),
    });
    Ok(format!(
        "Wrote {name}. It is installed in this browser as soon as this turn ends — it has its \
         own Worker and its own conversation, and it is listed beside the shipped agents. \
         Tell the user it exists and what to ask it."
    ))
}

/// A prompt a model wrote with its newlines still escaped. Small local models
/// double-escape a multi-line string inside a one-line call often enough that
/// the agents they write arrive as one 400-character paragraph.
///
/// ponytail: only when there is no real newline to lose — a prompt that
/// already has line breaks is passed through untouched, so this can only fix a
/// prompt that has none.
fn unescaped(prompt: &str) -> String {
    match prompt.contains('\n') {
        true => prompt.to_string(),
        false => prompt.replace("\\n", "\n").replace("\\t", "\t"),
    }
}
