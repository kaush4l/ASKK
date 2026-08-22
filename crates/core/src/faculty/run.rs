//! THE RUN: which hosts an app starts with, the walk that refreshes every
//! faculty an agent declared before a pass, and the dispatch of one call to
//! whichever host claims it.
//!
//! `super` is the CONTRACT — the two traits and the record a host reads. This
//! is the machinery that uses it, and nothing outside this crate calls in
//! here: a composition root installs through the doors upstairs and never
//! drives the walk itself. The two are one mechanism read in two directions,
//! perception and action, which is why [`refresh_all`] and [`run_hosted`] sit
//! beside each other rather than beside the traits they each use.

use std::cell::RefCell;
use std::rc::Rc;

use crate::app::{App, Ports};

use super::{Sense, Sensing, ToolHost};

/// The senses every app has before a composition root adds any.
///
/// The space is in here rather than special-cased upstream so that an app
/// built by a test with no browser at all still renders its shared space —
/// and renders it through the same path a browser faculty would use.
///
/// WHERE A HOST LIVES IS DECIDED BY WHERE ITS CAPABILITY IS REACHABLE: a
/// faculty whose capability is a CORE PORT is hosted here, one whose capability
/// is a browser in `adapters_web` through the public door
/// (`super::install_sense`). `memory` is here because durable storage is an
/// injected port (I3).
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
    let args = context::Args::parse(args_json);
    let (ok, output) = match host.run(&tool.0, &args).await {
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
/// One sense failing costs that BLOCK and not the turn, which is why `Sense`
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
            tools: a.agent.toolbox.clone(),
        },
    )
}
