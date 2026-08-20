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
mod goal;
mod history;
mod memory;
mod respond;
mod sensed;
mod soul;
mod space;
mod world;

pub(crate) use affordances::Affordances;
pub(crate) use contract::ResponseContract;
pub(crate) use directive::Directive;
pub(crate) use goal::Goal;
pub(crate) use history::History;
pub use history::SESSION_STARTED;
pub(crate) use respond::{Field, ResponseObject};
pub use memory::memory_parts;
pub use sensed::{Block, Sensed};
pub(crate) use soul::{Identity, OperatingRules, Soul};
pub use space::{space_parts, SharedSpace};
pub(crate) use world::{Environment, Observations, Task};

use context::{Component, Form, SectionSource, State};
use kernel::Timestamp;

/// One component's contribution to the paper.
/// `form` is the notation the paper is being written in; the component is
/// asked which of its own forms that maps to, so a request it cannot honour
/// costs nothing.
pub(crate) fn source(c: &dyn Component, at: Timestamp, form: Form) -> SectionSource {
    SectionSource {
        section: c.section(at, form),
        summary: None,
    }
}

/// THE SET THAT IS REBUILT FOR EVERY SINGLE CALL, named here and nowhere else.
///
/// Not a list of values but a list of things BUILT FROM STATE at call time —
/// which is why this is a function taking the phase's granted toolbox rather
/// than a constant. Each block comes from the component that owns its shape.
///
/// What the model may call and what it is TOLD it may call cannot drift,
/// because affordances and the response contract both come from one toolbox
/// (I13). The environment is fresh every request and never cached: a cached
/// clock is a wrong clock (Python `Engine.context`).
///
/// A block that belongs to THE MACHINE — the toolbox, the contract, the clock
/// — is added HERE, in order, rather than as a fourth statement in
/// `ask::call_model`.
///
/// A block that belongs to A CAPABILITY is NOT added here and adding one does
/// not mean editing this function. It arrives from the agent's own file: the
/// file declares a faculty, `faculty::blocks_of` says which blocks that
/// faculty contributes, and each is rendered by `Sensed` from whatever the
/// host most recently left in `state.senses` under the block's id. That is the
/// chrome agent's "latest page snapshot, always included" with one name
/// substituted — a line of frontmatter, not a line of Rust.
pub(crate) fn dynamic(
    state: &crate::state::AgentState,
    cfg: &crate::phase::PhaseConfig,
    tools: &crate::toolbox::Toolbox,
    at: Timestamp,
) -> Vec<Box<dyn Component>> {
    let mut blocks: Vec<Box<dyn Component>> = vec![
        Box::new(Affordances::new(tools.usages())),
        Box::new(crate::ask::stage_contract(state, cfg, tools)),
        Box::new(Environment {
            text: crate::now::environment(at),
        }),
    ];
    for block in crate::faculty::blocks_of(&state.faculties) {
        let parts = state.senses.get(block.id).cloned().unwrap_or_default();
        blocks.push(Box::new(Sensed { block, parts }));
    }
    blocks
}

/// The starting paper: every component at its opening value.
///
/// Order here is documentation, not mechanism — `assemble` sorts by slot, so
/// listing these in the wrong order would change nothing. They are listed in
/// prompt order anyway, because a reader should not have to consult the slot
/// table to picture the result.
///
/// THE SEED KNOWS NO FACULTY. `space` used to be listed below, which made the
/// starting paper carry a block that only agents naming a space would ever
/// fill; `set_component` UPSERTS, so a faculty block attaches at the first
/// call that renders it and needs no place reserved here. What is left is
/// exactly the set every agent has whatever it declared.
pub(crate) fn seed() -> State {
    let at = Timestamp(0);
    let form = Form::DEFAULT;
    State {
        sources: vec![
            source(&Soul::default(), at, form),
            source(&Identity::default(), at, form),
            source(&OperatingRules, at, form),
            source(&Affordances::default(), at, form),
            source(&Environment::default(), at, form),
            source(&Task::default(), at, form),
            source(&History::default(), at, form),
            source(&Observations::default(), at, form),
            source(&Directive::default(), at, form),
            source(&ResponseContract::default(), at, form),
        ],
        form,
    }
}
