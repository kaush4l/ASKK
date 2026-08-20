//! WHAT YOU CAN DO WITH THIS AGENT, before any run of it (32). Eight cards
//! differed in name and status word and in nothing else, so the four agents you
//! can hand a task to and the four you cannot were indistinguishable until you
//! selected one and read the launcher two views away.
//!
//! Its own file, and NOT `stage.rs` beside it, because the two answer questions
//! of different kinds off different sources. `stage.rs` folds the log and every
//! word it produces is about the turn running right now; this reads the ROSTER
//! — the agent's file, its toolbox, its pass ceiling — and every word it
//! produces is true before the run and after it. They were one file because
//! both end up on one row, which is where a card is laid out and not where its
//! facts come from.

use crate::dispatch::Ctx;

/// The standing facts a card states about an agent. The word is
/// `agents::card_sentences::can`'s — the same predicate the agent card's doors and the
/// Commands pane ask — so the board cannot come to a fifth answer about one agent.
pub(crate) struct Offer {
    /// `run`, `change` or `read` — `agents::card_sentences::can`, verbatim.
    pub(crate) can: &'static str,
    /// The clause the card's status line ends with, empty for an agent this
    /// roster holds no file for: a card says nothing rather than guessing (I15).
    pub(crate) said: String,
    /// Every tool the file really RESOLVED to, by name — the list the agent
    /// card prints in words. The Dashboard's starter tasks are chosen from it,
    /// so a task offered is a task some named tool can finish (32).
    pub(crate) toolset: String,
    /// …and the pass ceiling with it, because it is the one declared fact that
    /// separates an agent that works a goal over laps from one that answers once.
    pub(crate) laps: u16,
}

/// The fold itself, off the roster this request already holds.
pub(crate) fn offer(ctx: &Ctx, who: &str) -> Offer {
    let mut offer = Offer {
        can: "read",
        said: String::new(),
        toolset: String::new(),
        laps: 1,
    };
    let Some(spec) = ctx.agents.iter().find(|spec| spec.name == who) else {
        return offer;
    };
    let names: Vec<String> = agent::toolbox_for(spec, &ctx.agents)
        .tools
        .into_iter()
        .map(|t| t.name)
        .collect();
    offer.can = crate::agents::card_sentences::can(spec, &ctx.agents);
    offer.laps = spec.passes;
    // AN EMPTY TOOLBOX IS NOT A READING ONE (32). `can` answers `read` for both,
    // which is right for the door it guards — neither takes a task — and wrong
    // for a card that then says which tools it has.
    offer.said = match (offer.can, names.is_empty()) {
        (_, true) => "no task to give it — it has no tools at all".into(),
        ("read", _) => "no task to give it — every tool it has reads".into(),
        ("run", _) => "you can give it a task, and it runs commands".into(),
        _ => "you can give it a task; it runs no commands".into(),
    };
    // …AND HOW MANY LAPS ONE TASK MAY TAKE, where that is more than one: it is
    // the difference between handing over a goal and asking a question, and it
    // was legible on no card at all. `up to`, because `passes:` is a ceiling.
    if spec.passes > 1 {
        offer.said.push_str(&format!(
            " · it works one task over up to {} passes",
            spec.passes
        ));
    }
    offer.toolset = names.join(", ");
    offer
}
