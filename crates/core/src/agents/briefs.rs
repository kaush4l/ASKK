//! WHAT EVERY STAGE IS TOLD, INSTALLED (`agent::brief`). The neighbour of
//! `install.rs` and deliberately not part of it: an agent file says who an
//! agent is, and a brief says what a STAGE is for. They arrive by the same
//! road — static files under `public/`, fetched at boot, no rebuild to edit —
//! and they are two different things once they are here.
//!
//! THE REFUSAL JOINS THE AGENTS' OWN CHANNEL. A brief that will not load lands
//! in `agent_problems`, which the Agents panel already prints beside what did
//! load, because it is the same kind of news: a file this app was told to read
//! and could not. The alternative — a console warning — is how a page comes up
//! looking fine and refuses the first turn that reaches a stage.

use crate::app::App;

/// Install the fetched `public/stages/` files. Every key or none: a half-loaded
/// set is an app that runs until the turn that needed the missing one, so
/// `agent::load_briefs` refuses the lot and this records the sentence.
///
/// The state keeps whatever it had on a refusal — which, at boot, is nothing —
/// so there is no path where a stage runs on words this build compiled in.
pub fn install_briefs(app: &mut App, fetched: Vec<(String, String)>) {
    match agent::load_briefs(fetched) {
        Ok(briefs) => {
            agent::adopt_briefs(&mut app.agent, &briefs);
            app.briefs = briefs;
        }
        Err(agent::AgentError::MalformedBrief { key, message }) => {
            app.agent_problems
                .push(format!("the {key} stage brief: {message}"));
        }
        // `load_briefs` returns no other variant; a build where it did would
        // still have to say so rather than come up looking briefed.
        Err(other) => app.agent_problems.push(format!("stage briefs: {other:?}")),
    }
}

/// ADOPT AN AGENT FILE AND THE STAGE BRIEFS TOGETHER. Two calls and never one
/// function: `adopt_spec` reads a file that says who an agent IS, `adopt_briefs`
/// writes what a STAGE is for, and folding them into one would make a brief a
/// property of the agent — the model this increment rejected. They are side by
/// side here so that no install path can do the first without the second.
pub(crate) fn adopt(app: &mut App, mine: &agent::AgentSpec, peers: &[agent::AgentSpec]) {
    agent::adopt_spec(&mut app.agent, mine, peers);
    agent::adopt_briefs(&mut app.agent, &app.briefs);
}
