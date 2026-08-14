//! ONE PROCESS, as a row: what it is, what it is doing, and the two things a
//! person watching it wants — its log, and a way to stop it (R10-1, R10-6).
//! Split from `processes.rs`, which owns the pane and its poll, so both files
//! hold the 200-line rule (I12).
//!
//! It reaches for nothing of its own: the log opens through the Files pane's own
//! `POST /files` and the stop through the Processes pane's own `POST
//! /processes`. No second route, and no capability that was not already there.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::listing::open_path;
use crate::ui::Button;

/// One process, as the core listed it.
#[derive(Clone, PartialEq)]
pub(crate) struct Proc {
    name: String,
    state: String,
    pid: String,
    age: String,
    command: String,
}

impl Proc {
    fn running(&self) -> bool {
        self.state == "running"
    }

    /// The machine line: state, pid, and how long it ran — which is a duration
    /// the core froze when the process ended and keeps moving while it runs
    /// (R10-3). `?` is not a duration and is not shown as one.
    fn line(&self) -> String {
        let age = match self.age.as_str() {
            "?" => String::new(),
            had if self.running() => format!(" · {had}"),
            had => format!(" · ran {had}"),
        };
        format!("{} · pid {}{age}", self.state, self.pid)
    }
}

/// The names of what is still running. `pub(crate)` for `enginecost.rs`, which
/// counts what a reload would stop and must not define "running" a second time.
pub(crate) fn running_names(rows: &[Proc]) -> Vec<String> {
    rows.iter().filter(|p| p.running()).map(|p| p.name.clone()).collect()
}

/// One read of the projection for the selected agent: the fragment, and the rows
/// off the header — the shape `listing::read` uses for the folder panes.
pub(crate) fn read(web: &Signal<Option<Rc<WebApp>>>, agent: &str, req: Request) -> (String, Vec<Proc>) {
    let Some(app) = web.peek().clone() else {
        return (String::new(), Vec::new());
    };
    let res = app.handle(req.with_header("x-agent", agent));
    let rows = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-procs")
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            Some(Proc {
                name: f.next()?.to_string(),
                state: f.next()?.to_string(),
                pid: f.next()?.to_string(),
                age: f.next()?.to_string(),
                command: f.next().unwrap_or_default().to_string(),
            })
        })
        .collect();
    (res.body, rows)
}

/// One row: the name, what it is doing, and the command — truncated, with the
/// whole of it on the row's `title` (R10-1). Its own fn for the 40-line rule.
pub(crate) fn procrow(
    row: Proc,
    mut at: Signal<String>,
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    ask: impl FnMut(&str) + Copy + 'static,
) -> Element {
    let (name, line, command) = (row.name.clone(), row.line(), row.command.clone());
    let folder = format!(".harness/proc/{name}");
    let stopping = name.clone();
    rsx! {
        div { key: "{name}", class: "proc-row", "data-state": "{row.state}",
            button {
                class: "file-entry proc-open",
                title: "{command}",
                aria_label: "Open the log of {name}",
                onclick: move |_| {
                    // The folder first, then the file in it: the Files pane
                    // scopes what it shows to the folder it is on, so a log
                    // opened without moving it would land in nothing.
                    at.set(folder.clone());
                    open_path(web, &agent(), &folder, true);
                    open_path(web, &agent(), &format!("{folder}/log"), false);
                },
                span { class: "proc-name", "{name}" }
                span { class: "proc-meta", "{line}" }
                span { class: "proc-cmd", "{command}" }
            }
            if row.running() {
                Button {
                    variant: "danger",
                    class: "proc-stop",
                    onclick: move |_| { let mut stop = ask; stop(&stopping) },
                    "Stop"
                }
            }
        }
    }
}
