//! THE HOST HALF OF A FACULTY: the port that fills `AgentState.senses` before
//! every model call, and the port that RUNS what the faculty offers to call.
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

use std::cell::RefCell;
use std::rc::Rc;

use context::Part;
use kernel::BoxFuture;

use crate::app::{App, Ports};

/// What a sense may know about the agent it is sensing for. Read-only.
pub struct Sensing {
    /// The agent whose turn this is.
    pub agent: String,
    /// Its shared space, where it named one.
    pub space: Option<agent::Space>,
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

/// The senses every app has before a composition root adds any.
///
/// The space is in here rather than special-cased upstream so that an app
/// built by a test with no browser at all still renders its shared space —
/// and renders it through the same path a browser faculty would use.
///
/// WHERE A HOST LIVES IS DECIDED BY WHERE ITS CAPABILITY IS REACHABLE: a
/// faculty whose capability is a CORE PORT is hosted here, one whose capability
/// is a browser in `adapters_web` through the public door ([`install_sense`]).
/// `memory` is here because durable storage is an injected port (I3).
pub(crate) fn installed_by_default(ports: &Ports) -> Vec<Rc<dyn Sense>> {
    let memory = crate::memory::sense::MemorySense::new(Rc::clone(&ports.store));
    vec![Rc::new(crate::space::sense::SpaceSense), Rc::new(memory)]
}

/// The tool hosts every app has, by the same rule — the ACTION twin above.
/// Computed in `boot` and not by a composition root so that a forgotten host is
/// impossible: the pure table offers `keep` the moment a file names the
/// faculty, so an app missing this would list the tool and refuse every call.
pub(crate) fn hosts_by_default(ports: &Ports) -> Vec<Rc<dyn ToolHost>> {
    let (store, clock) = (Rc::clone(&ports.store), Rc::clone(&ports.clock));
    vec![Rc::new(crate::memory::host::MemoryHost::new(store, clock))]
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
    fn run<'a>(&'a self, tool: &'a str, args_json: &'a str)
        -> BoxFuture<'a, Result<String, String>>;
}

/// Install a host-side tool runner. The composition root's door, exactly as
/// [`install_sense`] is for perception.
pub fn install_tool_host(app: &mut App, host: Rc<dyn ToolHost>) {
    app.tool_hosts.push(host);
}

/// Run one call on the installed host that claims it, if any.
///
/// The ACTION twin of [`refresh_all`], and its caller states the precedence it
/// sits in the middle of: the built-in table first, then this, then the local
/// `tools::run` (`crate::batch::invoke`). `agent::builtin_tools` is
/// the authority for the names `run` holds and the table does not claim, so a
/// host cannot shadow a compiled-in tool by declaring its name — a faculty
/// widens what an agent may do and never redefines what it already did.
///
/// `None` means no host answered, which is not a failure: the local table then
/// refuses the name in words, the same silence an unsensed faculty gets (I15).
pub(crate) async fn run_hosted(
    app: &Rc<RefCell<App>>,
    tool: &kernel::ToolId,
    args_json: &str,
) -> Option<kernel::EventKind> {
    if agent::builtin_tools().get(&tool.0).is_some() {
        return None;
    }
    // The handle is CLONED OUT of a borrow that ends on this line, for the
    // reason `about` below states: a guard alive across the await panics the
    // next `borrow_mut`, and there always is a next one.
    let host = {
        let a = app.borrow();
        a.tool_hosts
            .iter()
            .find(|h| h.handles(&tool.0))
            .map(Rc::clone)
    }?;
    let (ok, output) = match host.run(&tool.0, args_json).await {
        Ok(output) => (true, output),
        Err(error) => (false, error),
    };
    Some(kernel::EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok,
        output,
    })
}

/// Refresh every faculty this agent declared, before a pass.
///
/// A faculty with NO installed sense is skipped in silence. That is I15 read
/// literally — every capability may be absent — and the same discipline
/// `agent::faculty::of` already applies to an unknown name: it offers no
/// tools, contributes no block, and the agent still runs.
///
/// One sense failing costs that BLOCK and not the turn, which is why [`Sense`]
/// returns a `Vec` rather than a `Result`: there is no outcome a host could
/// report here that would be worth ending a conversation over, and an empty
/// answer is already spelled "elided" by the paper.
pub(crate) async fn refresh_all(app: &Rc<RefCell<App>>) {
    let (faculties, senses, of) = about(app);
    for name in faculties {
        let Some(sense) = senses.iter().find(|s| s.faculty() == name) else {
            continue;
        };
        let fresh = sense.read(&of).await;
        let mut a = app.borrow_mut();
        // CLEARED FIRST, so a sense that came back empty leaves the prompt
        // saying nothing rather than saying what it saw last turn. A stale
        // snapshot is the one answer worse than no snapshot.
        for block in agent::faculty_of(&name).map(|f| f.blocks).unwrap_or_default() {
            a.agent.senses.remove(block.id);
        }
        for (id, parts) in fresh {
            a.agent.senses.insert(id, parts);
        }
    }
}

/// What the loop above needs, taken in ONE borrow that ends with this call.
///
/// A borrow held across an await panics the next `borrow_mut`, and the seam's
/// chat poll spawns a second `drive` every 400 ms, so there always is a next
/// one (`crate::batch::single`).
fn about(app: &Rc<RefCell<App>>) -> (Vec<String>, Vec<Rc<dyn Sense>>, Sensing) {
    let a = app.borrow();
    (
        a.agent.faculties.clone(),
        a.senses.clone(),
        Sensing {
            agent: a.me().to_string(),
            space: a.agent.space.clone(),
        },
    )
}
