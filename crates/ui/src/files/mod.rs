//! `Files` — the workspace folder, browsable (15G). It owns no capability:
//! every listing and every read is the `list_files` / `read_file` tool going
//! through the gate the agent's own calls do, so the pane is a projection of
//! `ToolInvoked` facts (I8) and an agent working here updates it as it goes.

pub(crate) mod artifacts;
pub(crate) mod breadcrumbs;
pub(crate) mod editor;
pub(crate) mod listing;
pub(crate) mod openfile;
pub(crate) mod rows;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;


use crate::files::listing::{follow, opening, read, served, Listing};
use crate::ui::Card;
use editor::FileEditor;
use rows::{EntryRows, WhereYouAre};

/// One read of the folder this pane is on, and of no other.
fn here(at: &str) -> Request {
    Request::get("/files").with_header("x-at", at)
}

/// One handler for every row, told the PATH rather than an index into a list it
/// would have to rebuild to interpret. The crumbs press it too (R16-P1-4).
///
/// The listing runs in the async half, so this watches for a CHANGE rather than
/// for quiet: a cold page takes as long as the disk does. What it watches
/// against is what the POST answered, which is scoped to the NEW folder.
pub(crate) fn open(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    mut at: Signal<String>,
    mut panel: Signal<Listing>,
    watching: Signal<bool>,
    path: String,
    folder: bool,
) {
    if folder {
        at.set(path.clone());
    }
    panel.set(read(web, &agent(), opening(&path, folder)));
    follow(web, agent, at, panel, watching);
}

/// The projection, and WHEN to ask the workspace for a new one (R3-19).
/// Re-reading on every tick shows the agent's own `list_files`; ASKING is gated
/// on WHAT HAS HAPPENED IN THE WORKSPACE — `x-workspace-at`, the count of
/// `exec` and `write_file` facts, which rides the listing this pane already
/// reads, so there is no second clock and no extra trip. IT USED TO BE THE
/// AGENT'S STATUS STAMP (R14-P1-3), which a person typing into the Commands box
/// never moves: the command ran, the Commands pane showed the file in its own
/// `ls -la`, and this pane went on showing the listing from before it. The log
/// is what both panes project, so both follow it.
fn relist(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    panel: Signal<Listing>,
    watching: Signal<bool>,
) {
    let mut listed_at = use_signal(|| None::<usize>);
    let mut panel = panel;
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        // `peek`, never a read: `open` writes it, and an effect that
        // subscribed to it would re-run itself for ever.
        let folder = at.peek().clone();
        panel.set(read(web, &agent(), here(&folder)));
        // NOT FOR AN AGENT WHOSE FOLDER THIS IS NOT (R7-4). The core answers
        // the GET with an ordinary grey sentence and REFUSES the POST, so asking
        // anyway painted a normal configuration in error red. R5-1's guard.
        if !served(&panel.peek().html) {
            return;
        }
        let now = panel.peek().stamp;
        if *listed_at.peek() == Some(now) {
            return;
        }
        listed_at.set(Some(now));
        // BOUND FIRST: passing `at.peek().clone()` inline holds the borrow
        // across the call, and `open` writes `at` — a RefCell panic at mount.
        let folder = at.peek().clone();
        open(web, agent, at, panel, watching, folder, true);
    });
}

#[component]
pub fn Files(
    web: Signal<Option<Rc<WebApp>>>,
    /// Bumped by every projection, which is what makes an agent's own writes
    /// appear here while it is still working.
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// WHICH FOLDER THIS PANE IS ON (`x-at`, R4-2). The RAIL's signal rather
    /// than this pane's, because the Processes pane points it at a process's
    /// own folder to open a log (R10-6): one editor in this view.
    at: Signal<String>,
) -> Element {
    let panel = use_signal(Listing::default);
    // One watcher at a time: each tick is a full trip through the seam.
    let watching = use_signal(|| false);
    relist(web, tick, agent, at, panel, watching);
    let shown = panel.read().clone();
    // WHETHER THIS AGENT HAS A FOLDER HERE AT ALL (R5-1): no root button to
    // press and no editor to type in when the core will not serve one.
    let browsable = served(&shown.html);
    rsx! {
        // Named for the view it is in, so the nav confirms the click (F6).
        Card { title: "Files", aria_label: "Files in the folder",
            div { class: "file-form",
                if browsable {
                    WhereYouAre { web, agent, at, panel, watching }
                }
                EntryRows { web, agent, at, panel, watching, shown: shown.clone() }
                div { aria_live: "polite", dangerous_inner_html: "{shown.html}" }
                if browsable && !shown.open.is_empty() {
                    FileEditor {
                        web, agent, at, panel, watching,
                        open: shown.open.clone(),
                        on_disk: shown.body.clone(),
                    }
                }
            }
        }
    }
}
