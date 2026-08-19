//! A FACULTY: a named bundle of capability — the tools it offers and the
//! prompt blocks it contributes — selected by an agent file writing its name.
//!
//! **This is a table, not a plugin loader.** [`TABLE`] is a literal list of
//! rows and [`of`] is a lookup in it — the same shape `core::tools::tool_entry`
//! (`crates/core/src/tools.rs:107`) and `core::dispatch::builtin_entry`
//! (`crates/core/src/dispatch.rs:42`) already use: a faculty is Rust compiled
//! into this binary, and a name with no row here does not exist. Nothing is
//! fetched, nothing is registered at runtime, and no faculty can be added
//! without a rebuild. Anything else would be a MODULE SYSTEM, and this repo
//! already has one (`crates/module/`) with its own manifest, capability grants
//! and dispatch tier; a second one wearing this name would be two answers to
//! the question "what may this agent do".
//!
//! What a faculty buys is the sentence the owner asked for: *everything that
//! goes into the prompt is a component, and an agent declares which ones it
//! gets*. A chrome agent naming a `browser` faculty would get its navigation
//! tools AND its page snapshot rendered before every call, from one word in
//! one file — with no edit to `components::dynamic`, no edit to the toolbox,
//! and no new mechanism beside the one `space:` has always used.

mod memory;
mod space;

use crate::components::Block;
use crate::spec::AgentSpec;
use crate::tools::Tool;

pub use memory::MEMORY;
pub use space::SPACE;

/// A named bundle of capability: the tools it offers and the prompt blocks it
/// contributes.
pub struct Faculty {
    pub name: &'static str,
    pub tools: Vec<Tool>,
    pub blocks: Vec<Block>,
}

/// How a faculty is built, so a row can hold one.
type Build = fn() -> Faculty;

/// EVERY FACULTY THIS BUILD SHIPS. One row per faculty, and this table is the
/// ONLY list: [`of`] answers from it and [`all`] is derived from it, so a
/// faculty that exists cannot be missing from the structural walk in
/// `tests/faculty.rs`. Registering IS adding a row; there is nowhere left to
/// forget.
///
/// It used to be two independent places — a `match` and a `pub const ALL` — and
/// a faculty added to the first but not the second got ZERO structural
/// coverage while every gate stayed green. The test that would have caught it
/// was the test that walked the list it was missing from.
const TABLE: &[(&str, Build)] = &[
    (space::SPACE, space::faculty),
    (memory::MEMORY, memory::faculty),
];

/// The faculty of this name, or `None`.
///
/// `None` is not an error anywhere: an unknown name offers no tools and
/// contributes no blocks, and the agent still runs. Every capability may be
/// absent (I15), and refusing here would make the name a load-order rule
/// rather than a capability one — `spec::loader::load_agents`' discipline, and
/// `subagent::unresolved_tools`' for exactly this reason.
pub fn of(name: &str) -> Option<Faculty> {
    TABLE
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, build)| build())
}

/// Every faculty this build ships, by name. Derived from [`TABLE`] — see there.
pub fn all() -> Vec<&'static str> {
    TABLE.iter().map(|(n, _)| *n).collect()
}

/// The faculties one agent file declares, in order.
///
/// A non-empty `space:` DECLARES THE SPACE FACULTY. That is what keeps this a
/// generalisation of `space:` rather than a second mechanism beside it — the
/// old key is now one way of naming a faculty, and every shipped agent file
/// keeps working with no edit.
///
/// It asks `Space::named` rather than testing the string, because the gate has
/// to stay exactly where it was: a name that could walk out of `spaces/`
/// resolves to nothing and must therefore declare nothing, or a `..` would
/// grant the workspace tools to an agent that has no folder to use them in.
///
/// Deduplicated because two names for one faculty would be two blocks with one
/// id, which `context::validate` refuses as `DuplicateSection`
/// (`crates/context/src/law.rs:45`) — the whole document, not just the block.
pub fn declared(spec: &AgentSpec) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |name: &str| {
        if !name.is_empty() && !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    };
    if crate::space::Space::named(&spec.space).is_some() {
        add(SPACE);
    }
    for name in &spec.faculties {
        add(name);
    }
    out
}

/// Every block every declared faculty contributes, in declaration order.
/// A name that is not a faculty contributes nothing — see [`of`].
pub fn blocks_of(faculties: &[String]) -> Vec<Block> {
    faculties
        .iter()
        .filter_map(|name| of(name))
        .flat_map(|f| f.blocks)
        .collect()
}

/// Every tool one agent file's faculties offer — [`declared`] and [`tools_of`]
/// in one call, because every caller wants both.
///
/// This is where NAMING A SPACE stopped being a special case. A space's three
/// tools were attached to whoever named it rather than having to be written
/// out under `space:` too, which would only be a second place to keep in step
/// (Python `utils.load_agent`) — and its WORKSPACE tools with them (increment
/// 10): the folder is the space's, so the capability to build in it arrives
/// with the space and with nothing else. That rule is now one row of a table,
/// so a browser faculty's tools arrive by the same sentence. No faculty, no
/// tools — default deny (ADR-006).
pub fn tools_for(spec: &AgentSpec) -> Vec<Tool> {
    tools_of(&declared(spec))
}

/// Every tool every declared faculty offers, in declaration order.
///
/// AVAILABLE TO NAME, never granted: this is the `offered` set
/// `subagent::resolve` filters through the agent's own `tools:` allowlist, and
/// a faculty adding to it can only widen what a non-empty list may PICK FROM.
pub fn tools_of(faculties: &[String]) -> Vec<Tool> {
    faculties
        .iter()
        .filter_map(|name| of(name))
        .flat_map(|f| f.tools)
        .collect()
}
