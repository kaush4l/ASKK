use crate::api::{workspace_view, IdeView as Ide};
use crate::ui::web::components::{Icon, Pane};
use dioxus::prelude::*;
use std::collections::BTreeSet;

/// IDE: an engine's workspace like an editor. Left: the file tree (folders collapse; protected
/// files carry a lock; open files are marked). Center: tabs of the open files, line numbered,
/// read only. Bottom: the terminal (jobs: command, status, output tail). Live.
/// Which engine: the `path` prop, else the page's `path` param.
#[component]
pub fn IdeView(#[props(default)] path: String) -> Element {
    let path = if path.is_empty() { try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).unwrap_or_default() } else { path };
    let mut target = use_signal(|| path.clone());
    if *target.peek() != path {
        target.set(path.clone());
    }
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&target()));
    let ide = use_resource(move || {
        let _ = live();
        workspace_view(target())
    });
    let v = ide.read().clone();
    match v {
        Some(Ok(v)) => rsx! { IdeBody { view: v } },
        Some(Err(e)) => rsx! { Pane { class: "fill", p { class: "dim", "{e}" } } },
        None => rsx! { Pane { class: "fill", p { class: "dim", "loading {path}" } } },
    }
}

#[component]
fn IdeBody(view: Ide) -> Element {
    // Folders the user flipped from their default (open when they hold an open file).
    let mut flipped = use_signal(BTreeSet::<String>::new);
    let mut active = use_signal(|| None::<String>);
    let Some(ws) = view.workspace.clone() else {
        return rsx! { Pane { class: "fill", p { class: "dim", "This engine has no workspace." } } };
    };
    let open: Vec<String> = ws.open.iter().map(|o| o.path.clone()).collect();
    let rows = tree_rows(&ws.files);
    let f = flipped.read().clone();
    let is_open = |dir: &str| folder_open(dir, &open, &f);
    let shown: Vec<TreeRow> = visible(&rows, is_open).into_iter().cloned().collect();
    let current = active().filter(|a| open.contains(a)).or_else(|| open.first().cloned());
    let file = current.as_ref().and_then(|c| ws.open.iter().find(|o| &o.path == c)).cloned();
    rsx! {
        Pane { class: "ide fill",
            nav { class: "ide-tree", "aria-label": "Files",
                div { class: "ide-head row",
                    b { class: "grow mono", title: "{ws.root}", "{ws.root}" }
                    span { class: "dim", "{ws.files.len()} files" }
                }
                ul { role: "tree",
                    for r in shown {
                        {
                            let lock = protected(&ws.protect, &r.path);
                            let on = open.contains(&r.path);
                            let sel = current.as_deref() == Some(r.path.as_str());
                            let expanded = r.dir && is_open(&r.path);
                            let p = r.path.clone();
                            let dir = r.dir;
                            rsx! {
                                li { key: "{r.path}", role: "treeitem", class: if sel { "ide-row sel" } else if on { "ide-row on" } else { "ide-row" },
                                    style: "padding-left: calc({r.depth} * 14px + 8px)", title: "{r.path}",
                                    "aria-expanded": if r.dir { "{expanded}" },
                                    onclick: move |_| {
                                        if dir {
                                            let mut f = flipped.write();
                                            if !f.remove(&p) { f.insert(p.clone()); }
                                        } else {
                                            active.set(Some(p.clone()));
                                        }
                                    },
                                    span { class: "ide-caret", if r.dir { if expanded { "▾" } else { "▸" } } }
                                    span { class: "grow ide-name", "{r.name}" }
                                    if on { span { class: "ide-dot", title: "open", "●" } }
                                    if lock { span { class: "ide-lock", title: "protected", "🔒" } }
                                }
                            }
                        }
                    }
                }
            }
            section { class: "ide-editor",
                div { class: "tabs", role: "tablist",
                    for o in open.iter() {
                        {
                            let p = o.clone();
                            let name = o.rsplit('/').next().unwrap_or(o).to_string();
                            rsx! {
                                button { key: "{o}", class: if current.as_ref() == Some(o) { "tab on" } else { "tab" }, role: "tab",
                                    "aria-selected": "{current.as_ref() == Some(o)}", title: "{o}",
                                    onclick: move |_| active.set(Some(p.clone())),
                                    "{name}"
                                    if protected(&ws.protect, o) { " 🔒" }
                                }
                            }
                        }
                    }
                }
                match file {
                    Some(f) => rsx! {
                        div { class: "ide-code mono", role: "region", "aria-label": "{f.path}",
                            for (i, line) in f.text.lines().enumerate() {
                                div { class: "ide-line", span { class: "ln", "{i + 1}" } code { "{line}" } }
                            }
                        }
                    },
                    None => rsx! { p { class: "dim pad", "No open files." } },
                }
            }
            section { class: "ide-term", "aria-label": "Terminal",
                div { class: "ide-head row", Icon { name: "terminal", size: 16 } b { class: "grow", "Terminal" } span { class: "dim", "{view.jobs.len()} jobs" } }
                div { class: "ide-jobs mono",
                    if view.jobs.is_empty() { p { class: "dim", "No jobs yet." } }
                    for j in view.jobs.iter().rev() {
                        div { key: "{j.id}", class: "ide-job",
                            div { class: "row",
                                span { class: "dim", "#{j.id}" }
                                code { class: "grow", "$ {j.command}" }
                                span { class: if j.status == "running" { "badge st-working" } else if j.status == "0" { "badge st-ready" } else { "badge st-failed" }, "{j.status}" }
                            }
                            if !j.output.is_empty() { pre { "{tail(&j.output, 12)}" } }
                        }
                    }
                }
            }
        }
    }
}

/// One line of the file tree: a folder or a file, at its depth.
#[derive(Clone, Debug, PartialEq)]
pub struct TreeRow {
    pub path: String,
    pub name: String,
    pub depth: usize,
    pub dir: bool,
}

/// The tree of relative file paths, flattened in display order: folders first, then files,
/// each by name.
pub fn tree_rows(files: &[String]) -> Vec<TreeRow> {
    #[derive(Default)]
    struct Dir {
        dirs: std::collections::BTreeMap<String, Dir>,
        files: BTreeSet<String>,
    }
    let mut root = Dir::default();
    for f in files {
        let parts: Vec<&str> = f.split('/').filter(|s| !s.is_empty()).collect();
        let Some((last, dirs)) = parts.split_last() else { continue };
        let mut d = &mut root;
        for p in dirs {
            d = d.dirs.entry(p.to_string()).or_default();
        }
        d.files.insert(last.to_string());
    }
    fn walk(d: &Dir, prefix: &str, depth: usize, out: &mut Vec<TreeRow>) {
        let join = |n: &str| if prefix.is_empty() { n.to_string() } else { format!("{prefix}/{n}") };
        for (name, sub) in &d.dirs {
            let path = join(name);
            out.push(TreeRow { path: path.clone(), name: name.clone(), depth, dir: true });
            walk(sub, &path, depth + 1, out);
        }
        for name in &d.files {
            out.push(TreeRow { path: join(name), name: name.clone(), depth, dir: false });
        }
    }
    let mut out = vec![];
    walk(&root, "", 0, &mut out);
    out
}

/// The rows to draw: those whose every ancestor folder is open.
pub fn visible<'a>(rows: &'a [TreeRow], is_open: impl Fn(&str) -> bool) -> Vec<&'a TreeRow> {
    rows.iter()
        .filter(|r| {
            let mut anc = r.path.as_str();
            while let Some((up, _)) = anc.rsplit_once('/') {
                if !is_open(up) {
                    return false;
                }
                anc = up;
            }
            true
        })
        .collect()
}

/// Is a folder open? By default when it holds an open file; a flip inverts that.
pub fn folder_open(dir: &str, open_files: &[String], flipped: &BTreeSet<String>) -> bool {
    let holds = open_files.iter().any(|f| f.starts_with(&format!("{dir}/")));
    holds != flipped.contains(dir)
}

/// Is this path under one of the workspace's protect patterns?
pub fn protected(protect: &[String], path: &str) -> bool {
    protect.iter().any(|p| crate::elements::workspace::matches(p, path))
}

/// The last `n` lines of a job's output.
pub fn tail(output: &str, n: usize) -> String {
    let lines: Vec<&str> = output.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn tree_lists_folders_first_with_depth() {
        let rows = tree_rows(&s(&["README.md", "src/main.rs", "src/views/a.rs", "Cargo.toml"]));
        let got: Vec<(&str, usize, bool)> = rows.iter().map(|r| (r.path.as_str(), r.depth, r.dir)).collect();
        assert_eq!(got, vec![("src", 0, true), ("src/views", 1, true), ("src/views/a.rs", 2, false), ("src/main.rs", 1, false), ("Cargo.toml", 0, false), ("README.md", 0, false)]);
    }

    #[test]
    fn closed_folders_hide_their_contents() {
        let rows = tree_rows(&s(&["src/main.rs", "src/views/a.rs", "x.rs"]));
        let shown: Vec<&str> = visible(&rows, |d| d == "src").iter().map(|r| r.path.as_str()).collect();
        assert_eq!(shown, vec!["src", "src/views", "src/main.rs", "x.rs"]);
        let none: Vec<&str> = visible(&rows, |_| false).iter().map(|r| r.path.as_str()).collect();
        assert_eq!(none, vec!["src", "x.rs"]);
    }

    #[test]
    fn folders_holding_open_files_start_open_and_flip() {
        let open = s(&["src/main.rs"]);
        let mut f = BTreeSet::new();
        assert!(folder_open("src", &open, &f));
        assert!(!folder_open("docs", &open, &f));
        f.insert("src".to_string());
        assert!(!folder_open("src", &open, &f));
    }

    #[test]
    fn protect_patterns_mark_files() {
        let p = s(&[".env", "secrets/", "*.key"]);
        assert!(protected(&p, ".env"));
        assert!(protected(&p, "secrets/a.txt"));
        assert!(protected(&p, "x/id.key"));
        assert!(!protected(&p, "src/main.rs"));
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        assert_eq!(tail("a\nb\nc", 2), "b\nc");
        assert_eq!(tail("a", 5), "a");
        assert_eq!(tail("", 3), "");
    }
}
