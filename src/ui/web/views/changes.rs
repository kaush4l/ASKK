//! The workspace tabs of an open engine's panel: Diff (what the last run changed) and Files
//! (the tree, and a file to read). Each is drawn only while its tab is chosen, so it asks only
//! then, and again when the engine changes. A build that has no workspace (the tab) says so.
use crate::api::{workspace_diff, workspace_file, workspace_view};
use crate::ui::web::components::{DiffView, FilesView};
use dioxus::prelude::*;

#[component]
pub fn DiffTab(path: String) -> Element {
    let m = super::live::use_manifest();
    let key = m.engine(&path);
    let live = super::live::use_live(move || key.clone());
    let diff = use_resource(move || {
        let _ = live();
        workspace_diff(path.clone())
    });
    let now = diff.read().clone();
    match now {
        None => rsx! { p { class: "dim", role: "status", "Reading what changed…" } },
        Some(Err(e)) => rsx! { p { class: "dim", role: "status", "{e}" } },
        Some(Ok(d)) => rsx! { DiffView { diff: d } },
    }
}

#[component]
pub fn FilesTab(path: String) -> Element {
    let m = super::live::use_manifest();
    let key = m.engine(&path);
    let live = super::live::use_live(move || key.clone());
    let p1 = path.clone();
    let tree = use_resource(move || {
        let _ = live();
        workspace_view(p1.clone())
    });
    let mut chosen = use_signal(String::new);
    let file = use_resource(move || {
        let _ = live();
        let (path, f) = (path.clone(), chosen());
        async move {
            if f.is_empty() {
                return Ok(String::new());
            }
            workspace_file(path, f).await.map_err(|e| e.to_string())
        }
    });
    let (text, error) = match &*file.read() {
        Some(Ok(t)) => (t.clone(), String::new()),
        Some(Err(e)) => (String::new(), e.clone()),
        None => (String::new(), String::new()),
    };
    let now = tree.read().clone();
    match now {
        None => rsx! { p { class: "dim", role: "status", "Reading the files…" } },
        Some(Err(e)) => rsx! { p { class: "dim", role: "status", "{e}" } },
        Some(Ok(v)) => match v.workspace {
            // The tab answers a workspace with nothing in it: it has none to show.
            None if cfg!(feature = "local") => rsx! { p { class: "dim", role: "status", "A workspace needs askk on a machine; this tab has no files to show (see what this build has, under Settings)." } },
            None => rsx! { p { class: "dim", "This engine has no workspace." } },
            Some(ws) => rsx! { FilesView { root: ws.root, files: ws.files, chosen: chosen(), text, error, on_open: move |f: String| chosen.set(f) } },
        },
    }
}
