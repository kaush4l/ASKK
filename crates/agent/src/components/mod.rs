//! Every part of the prompt, as a type that knows how to write itself down.
//!
//! This replaces a 98-line function of string literals. The difference is not
//! tidiness: a literal cannot say where it belongs, cannot say how often it
//! changes, and cannot format itself differently from the literal next to it.
//! A component does all three, which is what lets the toolbox render as call
//! signatures while the transcript renders as tagged turns.
//!
//! **What is inherited and what is overridden.** The heading each block
//! carries — `## {id}` and its one-line intent — is the frame every component
//! gets for free from `context::render`, the way every object inherits a
//! `toString` shape. The BODY is the override: it is `render()`, and it is
//! where a component says its piece in whatever form suits it. Uniform frame,
//! particular content.

mod affordances;
mod contract;
mod directive;
mod history;
mod person;
mod soul;
mod world;

pub(crate) use affordances::Affordances;
pub(crate) use contract::ResponseContract;
pub(crate) use directive::Directive;
pub(crate) use history::History;
pub(crate) use person::{Memory, User};
pub(crate) use soul::{Identity, OperatingRules, Soul};
pub(crate) use world::{Environment, Observations, Task};

use context::{Component, SectionSource, State};
use kernel::Timestamp;

/// One component's contribution to the paper.
pub(crate) fn source(c: &dyn Component, at: Timestamp) -> SectionSource {
    SectionSource {
        section: c.section(at),
        summary: None,
    }
}

/// The starting paper: every component at its opening value.
///
/// Order here is documentation, not mechanism — `assemble` sorts by slot, so
/// listing these in the wrong order would change nothing. They are listed in
/// prompt order anyway, because a reader should not have to consult the slot
/// table to picture the result.
pub(crate) fn seed() -> State {
    let at = Timestamp(0);
    State {
        sources: vec![
            source(&Soul::default(), at),
            source(&Identity::default(), at),
            source(&OperatingRules, at),
            source(&Affordances::default(), at),
            source(&User::default(), at),
            source(&Memory::default(), at),
            source(&Environment::default(), at),
            source(&Task::default(), at),
            source(&History::default(), at),
            source(&Observations::default(), at),
            source(&Directive::default(), at),
            source(&ResponseContract::default(), at),
        ],
    }
}
