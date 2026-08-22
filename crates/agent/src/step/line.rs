//! ONE LINE OF CALLS, seen as a whole. `subagent::invoke_or_refuse` is handed
//! one call and structurally cannot know its siblings, so a rule about the LINE
//! has nowhere else to live: between `on_reply` building a batch and
//! `core::batch::run_effects` `join_all`ing it, this is the only place the line
//! exists as one thing.

use kernel::{EventKind, ToolId};

use crate::effect::Effect;

/// ONE PEER MAY NOT BE NAMED TWICE ON ONE LINE, and the second naming is
/// refused IN WORDS rather than delivered.
///
/// A sub-agent is one Worker running ONE agent loop over one `core::App`
/// (`adapters_web/src/worker/mod.rs::AgentWorker::run`), and
/// `adapters_web/src/workers.rs:7` has SAID "a Worker has at most one call
/// outstanding" since increment 06 while nothing checked it (I16) — the slot in
/// `workers/spawn/reply.rs` holds ONE resolver per peer. Two goals handed to
/// one peer at the same time were therefore never two turns: the second ask
/// overwrote the first's resolver, the first promise never settled,
/// `pending_tools` never reached zero, and the lead's turn hung forever with no
/// timeout and no error card.
///
/// KEYING THE WAITERS WAS THE OTHER SHAPE, and it is the lie: N settled
/// promises against a peer that still takes one turn at a time is more
/// machinery buying a falsehood. The refusal is the truth, and it belongs HERE
/// rather than only in the adapter because the adapter is `cargo check`ed and
/// never run — a claim the gate cannot execute is not a verified claim (I17).
pub(crate) fn one_turn_each(line: Vec<Effect>) -> Vec<Effect> {
    let mut asked: Vec<String> = Vec::new();
    let mut out = Vec::with_capacity(line.len());
    for effect in line {
        let Effect::Delegate { agent, goal, .. } = &effect else {
            out.push(effect);
            continue;
        };
        match asked.contains(agent) {
            true => out.push(busy(agent, goal)),
            false => {
                asked.push(agent.clone());
                out.push(effect);
            }
        }
    }
    out
}

/// The refusal as a recorded tool result — the same `ToolInvoked` shape
/// `subagent::invoke_or_refuse` uses, so a refused delegation is one fact like
/// every other call and the round's `pending_tools` still counts it down. It
/// says what to do next, not only what went wrong (I15): a refusal the model
/// cannot act on is a dropped call wearing words.
fn busy(agent: &str, goal: &str) -> Effect {
    Effect::Emit {
        kind: EventKind::ToolInvoked {
            tool: ToolId(agent.to_string()),
            args: goal.to_string(),
            ok: false,
            output: format!(
                "{agent} takes one turn at a time and you already called it on this \
                 line, so this second goal was not delivered. Put it on a LATER line, \
                 or fold both goals into the one call above."
            ),
        },
    }
}
