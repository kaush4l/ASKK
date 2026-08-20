//! WHO is loaded, once agents can be authored in the browser (increment 11):
//! the one function that makes the running app agree with the authored set,
//! and the tool a model writes one with. The SET is `agents/authored.rs`, the ROUTES
//! are `agents/authoring.rs`.
//!
//! PRECEDENCE, one rule — the Python `registry._agent_dirs` order plus one
//! step: built-ins, then `public/agents/`, then what this browser authored.
//! Last wins, so authoring `main` OVERRIDES the shipped `main` and deleting
//! that record reverts to the file. A live prompt edit is exactly this.

use kernel::{EventKind, Status};

use crate::app::App;
use crate::agents::authored::{files, set, AUTHORED};

/// Make the running app agree with the authored set the log now holds.
///
/// DEFERRED WHILE A TURN IS IN FLIGHT. Swapping an agent's prompt between the
/// model call and the reply it is waiting for would assemble the rest of that
/// turn out of one file and the history of another's — the crossed-projection
/// class of bug increment 07 already produced once. `task` is `Some` exactly
/// from the utterance that starts a turn to the answer that ends it, so this
/// takes effect at a TURN BOUNDARY and the conversation is never disturbed.
pub(crate) fn reconcile(app: &mut App) {
    let want = set(&app.log);
    if want == app.authored || app.agent.task.is_some() || accepted(app) {
        return;
    }
    let files = crate::agents::install::builtin_files()
        .into_iter()
        .chain(app.files.clone())
        .chain(files(&want));
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
        crate::agents::briefs::adopt(app, mine, &peers);
    }
    let names: Vec<&str> = app.agents.iter().map(|s| s.name.as_str()).collect();
    app.append(EventKind::Custom {
        kind: "core.agents_loaded".into(),
        payload_json: serde_json::to_string(&names).unwrap_or_else(|_| "[]".into()),
    });
}

/// An utterance to THIS agent that the async half has not taken yet. `task` is
/// only set once `drive` pumps it, so between the seam accepting a message and
/// that pump there is a window where the turn has begun and `task` is still
/// None — a save landing in it swapped the agent under a turn already accepted
/// (11b walk, hit in the browser at ~100ms).
fn accepted(app: &App) -> bool {
    let me = app.me().to_string();
    app.pending.iter().any(|e| {
        matches!(&e.kind, EventKind::UserMessage { agent, .. } if agent.is_empty() || *agent == me)
    })
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
    // WHO wrote it: this process's own agent, on the record with the file, so
    // the card can say "written by main" rather than claiming your work (11b).
    let author = app.me().to_string();
    app.append(EventKind::Custom {
        kind: AUTHORED.into(),
        payload_json: serde_json::to_string(&(name.clone(), text, author)).unwrap_or_default(),
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
