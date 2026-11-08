use crate::components::{Icon, Pane};
use crate::pr::{merge_pr, pr_board, restart_app, service_state, FileDiff, Pr, Row};
use dioxus::prelude::*;

/// Pull requests, one component: a header (counts + tabs), then
/// - **Changes**: the work in progress on main, with Restart (update, build, restart);
/// - **Ready**: only PRs whose pr.md says `status: ready`: Overview (pr.md + Squash and merge),
///   Changes, Commits;
/// - **Changelog**: main's log.
#[component]
pub fn PrView() -> Element {
    let mut board = use_server_future(pr_board)?;
    let mut tab = use_signal(|| "changes");
    let b = board.read();
    let Some(Ok(b)) = b.as_ref() else {
        return rsx! { Pane { p { class: "dim", "loading" } } };
    };
    if !b.error.is_empty() {
        return rsx! { Pane { p { "{b.error}" } } };
    }
    let wip = b.prs.iter().find(|p| p.branch == crate::pr::MAIN).cloned().unwrap_or_default();
    let ready: Vec<Pr> = b.prs.iter().filter(|p| p.branch != crate::pr::MAIN && p.status == "ready").cloned().collect();
    let working = b.prs.iter().filter(|p| p.branch != crate::pr::MAIN && p.status != "ready").count();
    let changelog = b.changelog.clone();
    rsx! {
        Pane { class: "pr-app",
            header { class: "pr-head",
                div { class: "stack",
                    h2 { "Pull requests" }
                    div { class: "row dim",
                        span { "{wip.files.len()} changed files on main" }
                        span { "·" }
                        span { "{ready.len()} ready" }
                        span { "·" }
                        span { "{working} in progress" }
                    }
                }
                div { class: "segmented", role: "tablist", "aria-label": "Pull requests",
                    for (id, label, icon) in [("changes", "Changes", "file"), ("ready", "Ready", "branch"), ("changelog", "Changelog", "history")] {
                        button { class: "seg", role: "tab", "aria-selected": "{tab() == id}", onclick: move |_| tab.set(id),
                            Icon { name: icon, size: 18 } span { "{label}" }
                        }
                    }
                }
            }
            div { class: "pr-body",
                match tab() {
                    "ready" => rsx! { ReadyList { prs: ready, on_merged: move |_| board.restart() } },
                    "changelog" => rsx! {
                        div { class: "stack",
                            for c in changelog.iter() {
                                div { class: "log-row", code { "{c.id}" } span { class: "grow", "{c.subject}" } span { class: "dim", "{c.at.get(..10).unwrap_or_default()}" } }
                            }
                        }
                    },
                    _ => rsx! {
                        div { class: "stack",
                            Restart {}
                            Diffs { files: wip.files.clone(), cut: wip.cut }
                        }
                    },
                }
            }
        }
    }
}

/// Ready PRs: a list beside the selected one's Overview / Changes / Commits.
#[component]
fn ReadyList(prs: Vec<Pr>, on_merged: EventHandler<()>) -> Element {
    let mut pick = use_signal(|| 0usize);
    let mut tab = use_signal(|| "overview");
    let mut confirm = use_signal(|| false);
    let mut note = use_signal(String::new);
    if prs.is_empty() {
        return rsx! { p { class: "dim", "No PR is ready. In a worktree's pr.md, set status: ready." } };
    }
    let p = prs.get(pick()).cloned().unwrap_or_else(|| prs[0].clone());
    let branch = p.branch.clone();
    rsx! {
        div { class: "pr-split",
            nav { class: "pr-list", "aria-label": "Ready pull requests",
                for (i, r) in prs.iter().enumerate() {
                    button { class: if i == pick() { "pr-item on" } else { "pr-item" }, onclick: move |_| { pick.set(i); tab.set("overview"); confirm.set(false); note.set(String::new()); },
                        span { "{r.title}" }
                        span { class: "dim", "{r.branch} · {r.commits.len()} commits · {r.files.len()} files" }
                    }
                }
            }
            div { class: "stack pr-main",
                div { class: "row", h3 { class: "grow", "{p.title}" } span { class: "badge st-ready", "ready" } }
                div { class: "tabs", role: "tablist",
                    for (id, label) in [("overview", "Overview".to_string()), ("changes", format!("Changes ({})", p.files.len())), ("commits", format!("Commits ({})", p.commits.len()))] {
                        button { class: if tab() == id { "tab on" } else { "tab" }, role: "tab", "aria-selected": "{tab() == id}", onclick: move |_| tab.set(id), "{label}" }
                    }
                }
                match tab() {
                    "changes" => rsx! { Diffs { files: p.files.clone(), cut: p.cut } },
                    "commits" => rsx! {
                        for c in p.commits.iter() { div { class: "log-row", code { "{c.id}" } span { class: "grow", "{c.subject}" } } }
                    },
                    _ => rsx! {
                        for s in p.sections.iter() {
                            section { class: "stack pr-section", h3 { "{s.name}" } pre { class: "reply", "{s.body}" } }
                        }
                        div { class: "merge-bar",
                            if confirm() {
                                button { class: "btn primary", onclick: move |_| { let branch = branch.clone(); async move {
                                    match merge_pr(branch).await {
                                        Ok(m) => { note.set(m); confirm.set(false); on_merged.call(()); }
                                        Err(e) => { note.set(e.to_string()); confirm.set(false); }
                                    }
                                } }, "Confirm: squash into main" }
                                button { class: "btn", onclick: move |_| confirm.set(false), "Cancel" }
                            } else {
                                button { class: "btn primary", onclick: move |_| confirm.set(true), Icon { name: "branch", size: 18 } "Squash and merge" }
                            }
                            span { class: "dim", "{note}" }
                        }
                    },
                }
            }
        }
    }
}

/// Changed files in three views: unified, split (old | new side by side), raw diff text.
#[component]
fn Diffs(files: Vec<FileDiff>, cut: bool) -> Element {
    let mut mode = use_signal(|| "unified");
    rsx! {
        div { class: "stack",
            div { class: "row",
                span { class: "grow dim", "{files.len()} files · +{files.iter().map(|f| f.added).sum::<u32>()} −{files.iter().map(|f| f.removed).sum::<u32>()}" }
                div { class: "segmented", role: "tablist", "aria-label": "Diff view",
                    for (id, label) in [("unified", "Unified"), ("split", "Split"), ("raw", "Raw")] {
                        button { class: "seg", role: "tab", "aria-selected": "{mode() == id}", onclick: move |_| mode.set(id), "{label}" }
                    }
                }
            }
            if cut { p { class: "dim", "The diff was too big and is cut." } }
            if files.is_empty() { p { class: "dim", "No changes." } }
            for f in files.iter() {
                details { class: "file", open: f.rows.len() < 200,
                    summary { code { "{f.path}" } span { class: "add", " +{f.added}" } span { class: "del", " −{f.removed}" } }
                    match mode() {
                        "split" => rsx! {
                            div { class: "diff split",
                                for (l, r) in split(&f.rows) {
                                    div { class: "srow",
                                        Side { row: l }
                                        Side { row: r }
                                    }
                                }
                            }
                        },
                        "raw" => rsx! { pre { class: "diff raw", {raw(f)} } },
                        _ => rsx! {
                            div { class: "diff",
                                for r in f.rows.iter() {
                                    div { class: "d-{r.kind}",
                                        span { class: "ln", if r.old > 0 { "{r.old}" } }
                                        span { class: "ln", if r.new > 0 { "{r.new}" } }
                                        span { class: "code", "{r.text}" }
                                    }
                                }
                            }
                        },
                    }
                }
            }
        }
    }
}

#[component]
fn Side(row: Option<Row>) -> Element {
    match row {
        Some(r) => rsx! { div { class: "side d-{r.kind}", span { class: "ln", if r.kind == "hunk" { "" } else if r.kind == "add" { "{r.new}" } else { "{r.old}" } } span { class: "code", "{r.text}" } } },
        None => rsx! { div { class: "side d-empty" } },
    }
}

/// Pair rows for a side-by-side view: context on both sides, a run of deletions beside the run
/// of additions that follows it.
fn split(rows: &[Row]) -> Vec<(Option<Row>, Option<Row>)> {
    let mut out = vec![];
    let mut i = 0;
    while i < rows.len() {
        match rows[i].kind.as_str() {
            "del" | "add" => {
                let dels: Vec<Row> = rows[i..].iter().take_while(|r| r.kind == "del").cloned().collect();
                i += dels.len();
                let adds: Vec<Row> = rows[i..].iter().take_while(|r| r.kind == "add").cloned().collect();
                i += adds.len();
                for k in 0..dels.len().max(adds.len()) {
                    out.push((dels.get(k).cloned(), adds.get(k).cloned()));
                }
            }
            _ => {
                out.push((Some(rows[i].clone()), Some(rows[i].clone())));
                i += 1;
            }
        }
    }
    out
}

fn raw(f: &FileDiff) -> String {
    let mut s = format!("--- a/{0}\n+++ b/{0}\n", f.path);
    for r in &f.rows {
        let mark = match r.kind.as_str() { "add" => "+", "del" => "-", "hunk" => "", _ => " " };
        s.push_str(mark);
        s.push_str(&r.text);
        s.push('\n');
    }
    s
}

/// The restart service: one button, then its steps as they happen (the page keeps asking
/// while the app goes down and comes back).
#[component]
fn Restart() -> Element {
    let mut state = use_resource(service_state);
    let mut note = use_signal(String::new);
    use_future(move || async move {
        loop {
            let _ = document::eval("await new Promise(r => setTimeout(r, 2000)); return 0;").await;
            state.restart();
        }
    });
    let (st, log) = state.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let busy = matches!(st.step.as_str(), "queued" | "update" | "build" | "stop" | "start");
    let label = if st.note.is_empty() { st.step.clone() } else { format!("{}: {}", st.step, st.note) };
    rsx! {
        section { class: "restart-bar",
            div { class: "stack grow",
                div { class: "row", b { "Apply these changes" } if !st.step.is_empty() { span { class: if st.ok { "badge" } else { "badge st-failed" }, "{label}" } } }
                span { class: "dim", "Restart builds first (a failed build keeps the app running), then stops and starts the app. Steps in data/service.json." }
            }
            button { class: "btn primary", disabled: busy, onclick: move |_| async move {
                note.set(restart_app().await.unwrap_or_else(|e| e.to_string()));
                state.restart();
            }, Icon { name: "refresh", size: 18 } if busy { "Restarting…" } else { "Restart" } }
            if !note.read().is_empty() { span { class: "dim", "{note}" } }
            if !log.is_empty() && busy { pre { class: "reply svc-log", "{log}" } }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(kind: &str, old: u32, new: u32) -> Row {
        Row { kind: kind.into(), old, new, text: format!("{kind}{old}{new}") }
    }

    #[test]
    fn split_pairs_deletions_with_the_additions_that_follow() {
        let rows = vec![row("ctx", 1, 1), row("del", 2, 0), row("del", 3, 0), row("add", 0, 2), row("ctx", 4, 3), row("add", 0, 4)];
        let kinds: Vec<(Option<String>, Option<String>)> = split(&rows).into_iter().map(|(l, r)| (l.map(|x| x.kind), r.map(|x| x.kind))).collect();
        let s = |x: &str| Some(x.to_string());
        assert_eq!(kinds, vec![(s("ctx"), s("ctx")), (s("del"), s("add")), (s("del"), None), (s("ctx"), s("ctx")), (None, s("add"))]);
        assert!(raw(&FileDiff { path: "a".into(), added: 1, removed: 0, rows: vec![row("add", 0, 1)] }).ends_with("+add01\n"));
    }
}
