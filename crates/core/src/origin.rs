//! WHERE AN AGENT CAME FROM, and what it can therefore do, in one sentence.
//! Split from `authoring.rs`, which owns the three routes that WRITE an agent,
//! so both hold the 200-line rule (I12). It is not a route and it belongs to
//! neither of its two callers: the agent card and the identity panel both draw
//! this line, and the point of it being one function is that those two cannot
//! come to say different things about the same agent. The card's OTHER derived
//! sentences live here for that reason and to hold I12: which tools it really
//! has and which names resolved to nothing (R18-P1-7), who it can hand work to,
//! the loop it runs, what its next turn would really call — and, since 29, what
//! its tools let it DO at all.

use agent::AgentSpec;

/// WHAT THIS AGENT'S TOOLS LET IT DO — the one question anything that OFFERS an
/// agent work must ask before making the offer (29). 27 took the task door off
/// the critic by asking whether its file said `role: critic`, the wrong axis by
/// the same mistake it was fixing: `scout` is read-only under the identical
/// allowlist and kept `Give scout a task`. The launcher asked a third thing —
/// whether the agent had a FOLDER — and offered the critic ``Run `uname -a` in
/// the folder`` under the words "all three of these work". A folder is not
/// permission to write in it and a name is not a capability. The RESOLVED
/// toolbox is both, and it is the list `meta_line` prints and dispatch checks
/// against, so an offer cannot contradict the card carrying it: `run` starts
/// commands, `change` alters something (a file, an agent, the space's notes) or
/// hands work to an agent that can — a peer call is another agent's whole turn —
/// and `read` does neither. A WORD because it is rendered as one: `data-can` on
/// the card is how `crates/ui` learns it, depending on neither `agent` nor
/// `core` (ARCHITECTURE §4).
pub(crate) fn can(spec: &AgentSpec, peers: &[AgentSpec]) -> &'static str {
    let box_ = agent::toolbox_for(spec, peers);
    let has = |names: &[&str]| names.iter().any(|n| box_.get(n).is_some());
    match () {
        _ if has(&["exec", "start_process", "stop_process"]) => "run",
        _ if has(&["write_file", "write_agent", "remember", "forget", "post_note"])
            || box_.tools.iter().any(|t| t.agent) => "change",
        _ => "read",
    }
}

/// WHO wrote this agent, and what it can therefore do (increment 11). A model
/// can author an agent that runs with real capabilities, so the page states
/// which agents are this browser's rather than leaving it to be inferred — and
/// states the grant honestly: the space IS the grant, and the shell is
/// unrestricted inside the tab's Linux, which is the sandbox. (That `read_file`'s
/// path check is legibility, not containment, is a fact about our code: it stays
/// in this comment and off the card — R10-10.)
///
/// `mine` is `Some(author)`: an empty author is the person at this keyboard, a
/// named one is the agent that wrote it. Both used to read "Authored in this
/// browser", so an agent a model wrote was indistinguishable from your own work
/// (11b walk).
pub(crate) fn origin_line(spec: &AgentSpec, mine: Option<&str>) -> String {
    let origin = match mine {
        Some("") => "Written by you in this browser".to_string(),
        Some(author) => format!("Written by the {author} agent, in this browser"),
        // NO REPOSITORY PATH (R4-16). "as public/agents/main/agent.md" is a path
        // in a source tree the reader of this page cannot open, on the first line
        // they read about an agent. Where the file lives is the maintainer's
        // business; where the agent CAME FROM is the reader's.
        None => "Shipped with this site".to_string(),
    };
    // THREE THINGS WERE CALLED "space" (R5-13) and then two (shared space,
    // workspace folder). ONE NOW (R16-1): a WORKSPACE. Naming one in the agent's
    // file is what gives the agent a folder and a shell.
    let Some(space) = agent::Space::named(&spec.space) else {
        let none = "Its file names no space, so it has no folder and cannot run commands.";
        return format!("{origin}. {none}");
    };
    // …AND WHAT THAT MEANS, NOT HOW IT IS IMPLEMENTED (R10-10). WHICH claim is
    // the toolbox's to make and not the space's — a non-empty `tools:` list can
    // take the folder and leave the shell behind — so it asks `can`, with `&[]`
    // because peers only move the answer between `change` and `read`. The old
    // false arm claimed the agent "can look at that Linux and not change it",
    // which a `write_file` without an `exec` disproves.
    let granted = match can(spec, &[]) {
        "run" => "a shell, the four file tools, processes it can start and leave running, and \
                 one question it can ask about the machine itself. Its shell is a full one: it \
                 can read anything in that Linux, not only its own folder, and the Linux in this \
                 tab is as far as it goes",
        _ => "reached only through the tools its own file names, which are listed under how it \
                  is set up. There is no shell among them, so it cannot run anything in that \
                  Linux",
    };
    format!(
        "{origin}. It works in the '{}' space: a folder in Linux at {}, and the facts \
         and notes that space shares — {granted}.",
        space.name, space.path()
    )
}

/// WHAT THIS AGENT'S NEXT TURN WOULD REALLY CALL. It read `Model: local` — the agent file's `model:` field, printed verbatim —
/// on every card on the Agents view, at the same moment the header said "The
/// next turn calls openrouter — openai/gpt-4o-mini" and openrouter.ai was
/// returning a real 401. Both were on one screen: somebody who changes the
/// endpoint and is refused reads the card and concludes the change did not take
/// (cold walk, 21). Two more errors — `model:` is a CATALOGUE KEY, not a model
/// id (`catalogue::Catalogue::resolve`), so `Model: local` labelled an endpoint
/// as a model; and an agent naming no key printed "Uses the endpoint's default
/// model", which names nothing at all.
///
/// `found` is `ModelPort::resolves` — `None` when this build's port has no
/// catalogue to answer with, and then the file's own words are all that is
/// said. A file that names nothing must not have a model id invented for it.
pub(crate) fn model_line(spec: &AgentSpec, found: Option<(&str, &str)>) -> String {
    let asked = spec.model.trim();
    let Some((entry, model)) = found else {
        return match asked.is_empty() {
            true => "Its file names no endpoint, so the one chosen in Settings decides what the \
                     next turn calls."
                .to_string(),
            false => format!(
                "Its file asks for the {asked} endpoint. Which model that is today is decided \
                 by the catalogue and by Settings."
            ),
        };
    };
    if asked.is_empty() {
        return format!(
            "Next turn: {model}, at the {entry} endpoint. Its file names none, so Settings \
             decides."
        );
    }
    // A key that IS an entry, and a key that is a MODEL ID the default entry
    // serves, are both the file getting what it asked for — the catalogue
    // resolves them by two different rules and neither is an override.
    if asked == entry || asked == model {
        return format!("Next turn: {model}, at the {entry} endpoint its file asks for.");
    }
    format!(
        "Next turn: {model}, at the {entry} endpoint — its file asks for {asked}, and the \
         choice in Settings overrides it."
    )
}

/// THE LOOP THIS AGENT RUNS, in one line. Increment 20 shipped a declared
/// plan→work→verify→critique loop and no surface named it: `verify`, `stage`,
/// `loop` and `delegat` each occurred zero times in the rendered text of all six
/// views (cold walk, 21). `stages:` is the whole source — this invents no state (I8).
pub(crate) fn loop_line(spec: &AgentSpec) -> String {
    match spec.stages.is_empty() {
        // NOT "one reply": with no `stages:` a react agent still takes as many
        // tool rounds as it needs. What it does not do is plan first or check
        // afterwards, and that is the difference worth stating.
        true => "Runs no stages: it works and answers in one go, with no plan before it and no \
                 check after."
            .to_string(),
        false => format!("Runs in stages: {}.", spec.stages.join(" → ")),
    }
}

/// The split itself: `(peer agents, plain tools)`, both as the model sees them.
fn split(spec: &AgentSpec, peers: &[AgentSpec]) -> (Vec<String>, Vec<String>) {
    let (agents, tools): (Vec<_>, Vec<_>) =
        agent::toolbox_for(spec, peers).tools.into_iter().partition(|t| t.agent);
    let names = |set: Vec<agent::Tool>| set.into_iter().map(|t| t.name).collect();
    (names(agents), names(tools))
}

/// WHO THIS AGENT CAN HAND WORK TO — on the FACE of the card, not inside it
/// (cold walk, 21). Delegation is the one thing on this page that makes an agent
/// more than a chat window, and the only sentence naming it sat three layers
/// down, inside a collapsed disclosure, on one view. `None` is silence rather
/// than "none": most agents delegate to nobody, and saying so on five cards out
/// of six would bury the one card where it matters.
pub(crate) fn peer_line(spec: &AgentSpec, peers: &[AgentSpec]) -> Option<String> {
    let (agents, _) = split(spec, peers);
    match agents.is_empty() {
        true => None,
        // The wording is unchanged from the settings fold it came out of: it
        // was the right sentence, in the wrong place.
        false => Some(format!("Other agents it can hand work to: {}", agents.join(", "))),
    }
}

/// Built-ins and peers are ONE list to the model on purpose (it is never told
/// which is which — `Tool::from_engine`), but they are not one list to a person:
/// `researcher` read as a fourth built-in tool, when calling it hands a goal to
/// another agent with its own Worker, history and row on the board (`ux-walker`,
/// increment 06). The peer half is `peer_line`.
pub(crate) fn tool_lines(spec: &AgentSpec, peers: &[AgentSpec]) -> Vec<String> {
    let (_, tools) = split(spec, peers);
    // "named", because one of them is called `now` and a bare list of names
    // reads as a sentence that has lost its verbs.
    let mut out = vec![match tools.is_empty() {
        true => "No tools".to_string(),
        false => format!("Tools it can use, named: {}", tools.join(", ")),
    }];
    // A NAME THAT RESOLVED TO NOTHING IS SAID, NOT DROPPED (R18-P1-7). `tools:
    // [nope_tool]` produced `No tools` here — the card reporting a silent drop
    // back as a fact about the agent. The list is the file's own words, because
    // the file is where the typo is.
    let missing = agent::unresolved_tools(spec, peers);
    if !missing.is_empty() {
        let (it, named) = (match missing.len() { 1 => "it", _ => "them" }, missing.join(", "));
        out.push(format!("Named in its file but not installed here, so it cannot use {it}: {named}"));
    }
    out
}
