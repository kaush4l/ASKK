//! THE OPEN FILE: what is on disk, what you have typed over it, and the save.
//!
//! "You can change what the agent wrote and save it", not an IDE — and
//! read-only for a machine record (R11-12). `openfile.rs` owns both of those
//! modes and the markup; this owns the draft and the trip through the seam.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::files::listing::{follow, Listing};

/// Write the file back through the seam.
///
/// The write and the re-read BOTH happen in the async half, so this only
/// WATCHES afterwards: asking for a listing here logged the same `read_file`
/// call twice (R5-12).
fn save(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    panel: Signal<Listing>,
    watching: Signal<bool>,
    path: &str,
    text: &str,
) {
    let Some(app) = web.peek().clone() else { return };
    app.handle(
        Request::post_form("/files", &[("path", path), ("contents", text)])
            .with_header("x-agent", &agent()),
    );
    follow(web, agent, at, panel, watching);
}

#[component]
pub(crate) fn FileEditor(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    panel: Signal<Listing>,
    watching: Signal<bool>,
    /// The path the pane has open.
    open: String,
    /// …and its bytes as the workspace last reported them.
    on_disk: String,
) -> Element {
    // What the editor holds, and for which file. `None` means "showing what is
    // on disk": a draft belongs to one path, and switching files must not carry
    // your edit to the next one.
    let mut draft = use_signal(|| None::<(String, String)>);
    let editing = draft.read().clone().filter(|(path, _)| *path == open);
    let text = match &editing {
        Some((_, text)) => text.clone(),
        None => on_disk.clone(),
    };
    let dirty = editing.is_some() && text != on_disk;
    rsx! {
        crate::files::openfile::FileEdit {
            open: open.clone(),
            text: text.clone(),
            dirty,
            on_input: {
                let path = open.clone();
                move |v: String| draft.set(Some((path.clone(), v)))
            },
            on_discard: move |_| draft.set(None),
            on_save: move |(path, body): (String, String)| {
                save(web, agent, at, panel, watching, &path, &body);
                draft.set(None);
            },
        }
    }
}
