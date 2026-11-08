use crate::components::Pane;
use crate::pr::{pr_board, restart_app, service_state, Pr};
use dioxus::prelude::*;

/// PRs: every git worktree with its pr.md, commits and diff; the changelog of main; and the
/// restart service (update, build, stop, start).
#[component]
pub fn PrView() -> Element {
    let board = use_server_future(pr_board)?;
    let mut pick = use_signal(|| 0usize);
    let mut tab = use_signal(|| "overview");
    let b = board.read();
    let Some(Ok(b)) = b.as_ref() else {
        return rsx! { Pane { p { class: "dim", "loading" } } };
    };
    if !b.error.is_empty() {
        return rsx! { Pane { p { "{b.error}" } } };
    }
    let cur: Option<Pr> = b.prs.get(pick()).cloned();
    rsx! {
        Pane { class: "pr-app",
            aside { class: "pr-side",
                section { class: "stack",
                    h2 { "Worktrees" }
                    for (i, p) in b.prs.iter().enumerate() {
                        button { class: if i == pick() { "pr-item on" } else { "pr-item" }, onclick: move |_| { pick.set(i); tab.set("overview"); },
                            b { "{p.title}" }
                            span { class: "dim", "{p.branch} · {p.head}" }
                            span { class: "row",
                                if !p.status.is_empty() { span { class: "badge st-{p.status}", "{p.status}" } }
                                if !p.has_pr_file { span { class: "badge", "no pr.md" } }
                                span { class: "dim", "{p.commits.len()} commits · {p.files.len()} files" }
                            }
                        }
                    }
                }
                Restart {}
                section { class: "stack",
                    h2 { "Changelog" }
                    for c in b.changelog.iter() {
                        div { class: "log-row", code { "{c.id}" } span { class: "grow", "{c.subject}" } span { class: "dim", "{c.at.get(..10).unwrap_or_default()}" } }
                    }
                }
            }
            if let Some(p) = cur {
                div { class: "stack pr-main",
                    div { class: "row", h2 { class: "grow", "{p.title}" } span { class: "dim", "{p.path}" } }
                    div { class: "tabs",
                        for (id, label) in [("overview", "Overview".to_string()), ("changes", format!("Changes ({})", p.files.len())), ("commits", format!("Commits ({})", p.commits.len()))] {
                            button { class: if tab() == id { "tab on" } else { "tab" }, onclick: move |_| tab.set(id), "{label}" }
                        }
                    }
                    if p.cut { p { class: "dim", "The diff was too big and is cut." } }
                    match tab() {
                        "changes" => rsx! {
                            if p.files.is_empty() { p { class: "dim", "No changes." } }
                            for f in p.files.iter() {
                                details { class: "file", open: f.rows.len() < 200,
                                    summary { code { "{f.path}" } span { class: "add", " +{f.added}" } span { class: "del", " −{f.removed}" } }
                                    div { class: "diff",
                                        for r in f.rows.iter() {
                                            div { class: "d-{r.kind}",
                                                span { class: "ln", if r.old > 0 { "{r.old}" } }
                                                span { class: "ln", if r.new > 0 { "{r.new}" } }
                                                span { class: "code", "{r.text}" }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "commits" => rsx! {
                            if p.commits.is_empty() { p { class: "dim", "No commits over main." } }
                            for c in p.commits.iter() { div { class: "log-row", code { "{c.id}" } span { class: "grow", "{c.subject}" } } }
                        },
                        _ => rsx! {
                            if !p.has_pr_file { p { class: "dim", "No pr.md in this worktree yet: add one with # Title, status: working, and ## sections." } }
                            for s in p.sections.iter() {
                                section { class: "stack", h3 { "{s.name}" } pre { class: "reply", "{s.body}" } }
                            }
                        },
                    }
                }
            }
        }
    }
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
        section { class: "stack",
            div { class: "row",
                h2 { class: "grow", "Service" }
                if !st.step.is_empty() { span { class: if st.ok { "badge" } else { "badge st-failed" }, "{label}" } }
            }
            p { class: "dim", "Restart: update, build (stops here if it fails; the app keeps running), stop this app, start it again. Steps in data/service.json." }
            div { class: "row",
                button { class: "btn primary", disabled: busy, onclick: move |_| async move {
                    note.set(restart_app().await.unwrap_or_else(|e| e.to_string()));
                    state.restart();
                }, if busy { "Restarting…" } else { "Restart" } }
                span { class: "dim", "{note}" }
            }
            if !log.is_empty() { pre { class: "reply svc-log", "{log}" } }
        }
    }
}
