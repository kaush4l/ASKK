//! An engine's workspace beside its conversation: what the last run changed ([`DiffView`]) and
//! the files themselves, to read ([`FilesView`]). Each is given what it shows; asking for the
//! changes, the tree and a file's text is the view's to do.
use super::{CodeBlock, Icon};
use crate::api::WorkspaceDiff;
use crate::ui::features::{diff, files};
use dioxus::prelude::*;
use std::collections::BTreeSet;

/// What the last run that changed files changed: each file with how many lines came and went,
/// and the change itself as a coloured diff.
#[component]
pub fn DiffView(diff: WorkspaceDiff) -> Element {
    if !diff.workspace {
        return rsx! { p { class: "dim", "This engine has no workspace, so no run of it changes files." } };
    }
    if diff.files.is_empty() {
        return rsx! { p { class: "dim", "No run has changed a file yet." } };
    }
    let n = diff.files.len();
    rsx! {
        p { class: "dim", "What the last run that changed files changed, with its tools or the programs it ran: {n} file" if n != 1 { "s" } ", each as it was before the run and as it is now." }
        ul { class: "change-list",
            for f in diff.files.iter() {
                {
                    let (added, gone) = diff::counts(f.before.as_deref(), &f.after);
                    let text = diff::unified(&f.path, f.before.as_deref(), &f.after);
                    rsx! {
                        li { key: "{f.path}", class: "change-file",
                            p { class: "change-name",
                                Icon { name: "file", size: 14 }
                                span { class: "mono grow", title: "{f.path}", "{f.path}" }
                                if f.before.is_none() { span { class: "change-new", "new" } }
                                if f.gone { span { class: "change-gone-file", "gone" } }
                                span { class: "change-add", "+{added}" }
                                span { class: "change-gone", "−{gone}" }
                            }
                            CodeBlock { lang: "diff", text }
                        }
                    }
                }
            }
        }
    }
}

/// The workspace's files as a tree, and the one chosen, to read. `chosen`: the file shown;
/// `text`: its text, or `error` why it cannot be shown. `on_open` says a file was chosen.
#[component]
pub fn FilesView(root: String, files: Vec<String>, #[props(default)] chosen: String, #[props(default)] text: String, #[props(default)] error: String, on_open: EventHandler<String>) -> Element {
    // Folders opened by hand; a folder that holds the chosen file is open too.
    let mut opened = use_signal(BTreeSet::<String>::new);
    let rows = files::tree_rows(&files);
    let held = opened.read().clone();
    let is_open = |dir: &str| held.contains(dir) || chosen.starts_with(&format!("{dir}/"));
    let shown: Vec<files::TreeRow> = files::visible(&rows, is_open).into_iter().cloned().collect();
    rsx! {
        div { class: "ws-files",
            p { class: "files-root dim", span { class: "files-count", "{files.len()} files in" } span { class: "files-path mono", title: "{root}", "{root}" } }
            ul { class: "files-tree", role: "tree", "aria-label": "Files",
                for r in shown {
                    {
                        let open = r.dir && is_open(&r.path);
                        let p = r.path.clone();
                        let dir = r.dir;
                        let depth = r.depth.min(8);
                        rsx! {
                            li { key: "{r.path}", role: "treeitem", "aria-expanded": if dir { "{open}" }, "aria-selected": if !dir { "{r.path == chosen}" },
                                button { class: if r.path == chosen { "file-row tree-d{depth} is-chosen" } else { "file-row tree-d{depth}" }, r#type: "button", title: "{r.path}",
                                    onclick: move |_| {
                                        if dir {
                                            let mut o = opened.write();
                                            if !o.remove(&p) { o.insert(p.clone()); }
                                        } else {
                                            on_open.call(p.clone());
                                        }
                                    },
                                    Icon { name: if dir { "folder" } else { "file" }, size: 14 }
                                    span { class: "file-name", "{r.name}" }
                                }
                            }
                        }
                    }
                }
            }
            if !chosen.is_empty() {
                section { class: "file-read", "aria-label": "{chosen}, read only",
                    p { class: "read-head mono", "{chosen}" span { class: "dim", " · read only" } }
                    if !error.is_empty() {
                        p { class: "talk-error", role: "alert", "{error}" }
                    } else {
                        CodeBlock { lang: chosen.rsplit('.').next().unwrap_or_default().to_string(), text }
                    }
                }
            }
        }
    }
}
