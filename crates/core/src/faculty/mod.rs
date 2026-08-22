//! THE HOST HALF OF A FACULTY, AS A SEAM: what a host is handed, what it may
//! hand back, and the two doors a composition root installs one through.
//!
//! A faculty has two halves and they live in different crates on purpose. The
//! PURE half is a declaration — its name, its tools, the blocks it contributes
//! and where they sit — and it is one row of `agent::faculty`'s table
//! (`crates/agent/src/faculty/mod.rs:65`), compiled in, testable on the host.
//! The IMPURE half is this: something that reads the outside world and leaves
//! parts for `components::Sensed` (`crates/agent/src/components/sensed.rs:47`)
//! to render.
//!
//! Splitting them is what keeps `core` abstract. Before this, one faculty —
//! the space — had its state written by hand in `space::shared::refresh`, so
//! the sentence "a chrome agent gets the latest page snapshot in every prompt"
//! would have cost an edit HERE, in wiring that must never learn what a page
//! is. Now the browser-shaped half of that lives wherever a browser is
//! reachable (`adapters_web`), arrives through [`install_sense`], and this
//! file names nothing it senses.
//!
//! The space itself went through the same door on the way out
//! (`crate::space::sense::SpaceSense`). That is the point: one mechanism, and
//! the oldest faculty is an ordinary user of it.
//!
//! WHAT IS HERE AND WHAT IS IN [`run`]: this file is the CONTRACT — the two
//! traits, the record they read, and the two `install_` doors — and it is what
//! a composition root and an outside crate need to see. `run` is the LOOP that
//! walks a turn's faculties and dispatches one call, which nothing outside this
//! crate may touch. The two were one file at exactly the 200-line ceiling, and
//! the seam could not grow a field without the loop paying for it.

use std::rc::Rc;

use context::{Args, Part};
use kernel::BoxFuture;

use crate::app::App;

mod run;

pub(crate) use run::{hosts_by_default, installed_by_default, refresh_all, run_hosted};

/// What a sense may know about the agent it is sensing for. Read-only.
pub struct Sensing {
    /// The agent whose turn this is.
    pub agent: String,
    /// Its shared space, where it named one.
    pub space: Option<agent::Space>,
    /// What that agent may actually CALL, resolved (`AgentState.toolbox`).
    /// A sense writes the words a model reads, and words that name a tool the
    /// agent was never granted advertise a capability that is not there — the
    /// one failure I15 forbids by name. So the grant travels WITH the subject
    /// rather than being looked up by whoever happens to render the block.
    pub tools: agent::Toolbox,
}

/// A HOST that produces fresh state for one faculty, before every pass.
///
/// The impure half of a faculty: the declaration is pure Rust in `agent`,
/// this reads the outside world. Implemented in whatever crate can actually
/// reach that world — `adapters_web` for anything needing a browser — so
/// `core` stays abstract and a new faculty costs no edit here.
pub trait Sense {
    /// The faculty name this senses for, matching `agent::faculty::of`.
    fn faculty(&self) -> &'static str;
    /// Fresh parts, keyed by BLOCK ID. Empty is legitimate and must be
    /// harmless: an unwritten block renders nothing and elides (I15).
    fn read<'a>(&'a self, of: &'a Sensing) -> BoxFuture<'a, Vec<(String, Vec<Part>)>>;
}

/// Install a host-side sense. The composition root's door: `adapters_web`
/// calls this for anything needing a browser, and `core` never names it.
pub fn install_sense(app: &mut App, sense: Rc<dyn Sense>) {
    app.senses.push(sense);
}

/// A HOST that RUNS the tools of one faculty.
///
/// [`Sense`] fills a faculty's prompt block; this runs its calls. The two are
/// separate because a faculty may have either without the other: a clock
/// faculty senses and offers nothing to call, and a faculty could offer tools
/// and contribute no block.
///
/// Without it the two halves of a faculty were not symmetric. Perception
/// arrived from outside through [`install_sense`]; ACTION could not, because
/// `tools::tool_entry` (`crates/core/src/tools.rs:107`) is a closed `match` in
/// this crate — so a browser faculty's `navigate` would have been listed in the
/// affordances, rendered beside a fresh page snapshot, and then refused on
/// every call by a table only an edit to `core` could widen.
pub trait ToolHost {
    /// The tool names this host answers to. Checked before [`ToolHost::run`].
    fn handles(&self, tool: &str) -> bool;
    /// Run one call. `Ok`/`Err` both become a recorded `ToolInvoked` fact —
    /// NOTHING HERE RAISES, because that text is what lets the model correct
    /// itself on the next pass (`crates/core/src/tools.rs:116-118`).
    ///
    /// The arguments arrive PARSED. A host handed the raw string would have to
    /// re-decide what a missing key and a blank value mean, which is how
    /// sixteen copies of that read came to disagree; [`context::Args`] makes the
    /// choice between an identifier and content explicit instead. The bytes the
    /// model sent are still there — `Args::raw` — for a host that records them.
    fn run<'a>(&'a self, tool: &'a str, args: &'a Args)
        -> BoxFuture<'a, Result<String, String>>;
}

/// Install a host-side tool runner. The composition root's door, exactly as
/// [`install_sense`] is for perception.
pub fn install_tool_host(app: &mut App, host: Rc<dyn ToolHost>) {
    app.tool_hosts.push(host);
}
