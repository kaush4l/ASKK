//! ADOPTING AN AGENT FILE. One `AgentSpec` written onto one `AgentState`:
//! which model it calls, what it may call, the loop it walks, who reviews it,
//! and the two blocks its own markdown becomes.
//!
//! It is the paper's neighbour rather than the paper itself because it is the
//! one operation that turns a FILE into a running agent — `spec.rs` reads the
//! bytes, this decides what they mean to a live state, and `mod.rs` only knows
//! how to write a block down. Nothing about `main` is hardcoded on this path;
//! that is what makes the `public/agents/` loader real rather than decorative.

use kernel::Timestamp;

use super::set_component;
use crate::spec::AgentSpec;
use crate::state::AgentState;

/// Adopt an agent's own file: the markdown body of `agent.md` IS this
/// agent's system prompt (the `soul` section), and its description is the
/// identity line. `peers` are the other loaded agents, from which this one's
/// `tools:` list picks its sub-agents — so a change to the file changes the
/// toolbox with no rebuild, exactly as it changes the prompt.
pub fn adopt_spec(state: &mut AgentState, spec: &AgentSpec, peers: &[AgentSpec]) {
    state.model = spec.model.clone();
    state.temperature = spec.temperature;
    // Naming the space IS the request: the tools come with it rather than
    // having to be listed too (Python `utils.load_agent`), and a name that
    // could walk out of `spaces/` attaches nothing at all.
    state.space = crate::space::Space::named(&spec.space);
    adopt_faculties(state, spec);
    state.toolbox = crate::subagent::toolbox_for(spec, peers);
    (state.compact_at, state.keep_recent) = (spec.compact_at, spec.keep_recent);
    state.max_rounds = spec.max_rounds;
    // THE LOOP THIS AGENT RUNS, from its own file and nowhere else (20).
    state.declared = spec.stages.clone();
    state.stages = spec.stages.clone();
    // …and how many times it may walk it (22).
    state.passes = spec.passes;
    // …and WHAT IT IS FOR (26). The three declared lines onto the state; the
    // two observed ones start empty, because nothing has been checked yet.
    state.standing.goal = spec.goal.clone();
    adopt_goal(state, spec);
    // THE SUMMARIZER IS NOT AN AGENT ANY MORE. Compaction builds its own
    // sheet with its own prompt (`window::SUMMARIZE`) and runs on this agent's
    // model, so there is no peer to find and no role to hold. Three fields and
    // a lookup went with it.
    state.critic = critic_among(spec, peers);
    // The agent file IS the soul and the identity — rebuilt through the
    // components that own those shapes, so adopting a spec cannot produce a
    // section shaped differently from a seeded one.
    let soul = crate::components::Soul { text: spec.prompt.clone() };
    let identity = crate::components::Identity {
        name: spec.name.clone(),
        description: spec.description.clone(),
    };
    set_component(&mut state.paper, &soul, Timestamp(0));
    set_component(&mut state.paper, &identity, Timestamp(0));
}

/// THE STANDING GOAL, INTO THE PROMPT (26). A goal that only reached the Rust
/// would be a setting that looks applied — the loop gated on an outcome the
/// model was never told — so `outcome` and `done_when` become a block the model
/// reads, and `components::goal` holds why the CHECK is deliberately not one.
///
/// AND A FILE THAT DECLARED NOTHING ATTACHES NOTHING. `set_component` upserts,
/// so an absent block is absent rather than empty: every agent written before
/// this key assembles the paper it always did, byte for byte, which is the same
/// compatibility rule `stages:` and `passes:` ship with.
fn adopt_goal(state: &mut AgentState, spec: &AgentSpec) {
    if spec.goal.outcome.is_empty() && spec.goal.done_when.is_empty() {
        return;
    }
    let goal = crate::components::Goal {
        outcome: spec.goal.outcome.clone(),
        done_when: spec.goal.done_when.clone(),
    };
    set_component(&mut state.paper, &goal, Timestamp(0));
}

/// WHAT EVERY STAGE IS TOLD (`crate::brief`), onto the state that will walk
/// them. Its own function beside `adopt_spec` and deliberately not inside it:
/// briefs are not a property of the spec, and folding them in would make them
/// one — the per-agent model this increment rejected. The same set goes onto
/// every agent in the process, which is what makes `verify` mean one thing.
pub fn adopt_briefs(state: &mut AgentState, briefs: &crate::brief::Briefs) {
    state.briefs = briefs.clone();
}

/// WHAT THIS FILE DECLARED IT CAN DO (`crate::faculty`). Naming a space
/// declares the space faculty; any other is named in `faculties:`. The list is
/// the whole set, in the order the file wrote them, and it is what puts blocks
/// in the prompt and tools in the toolbox.
///
/// It writes the DECLARATION and never a block's contents. A faculty block
/// renders whatever a HOST last left under its id, and this crate has no host
/// in it — so an agent adopted here starts with every sensed block empty, which
/// renders as nothing at all until something outside fills it (I15). That is
/// why there is no `senses` write beside this line: one for the space would be
/// the one faculty this pure crate knows by name, and the seam would be a
/// generalisation everywhere except at its own first entry.
fn adopt_faculties(state: &mut AgentState, spec: &AgentSpec) {
    state.faculties = crate::faculty::declared(spec);
}

/// WHO REVIEWS THIS AGENT'S WORK (25), by the job the file declares and not by
/// the name `critic` — 20's rule, for the same reason: a hardcoded name means
/// renaming the folder silently unhooks the machinery.
///
/// It is recorded even where this agent cannot CALL the critic, because the
/// field only decides whether a tool result is read as a verdict, and a result
/// can only arrive from a tool the allowlist already granted. An agent that is
/// itself the critic gets an empty name: nothing here reviews itself.
fn critic_among(spec: &AgentSpec, peers: &[AgentSpec]) -> String {
    crate::spec::loader::role_holder(peers, crate::spec::ROLE_CRITIC)
        .filter(|c| c.name != spec.name)
        .map(|c| c.name.clone())
        .unwrap_or_default()
}
