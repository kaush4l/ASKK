//! WHAT THIS RELOAD TAKES WITH IT, COUNTED (R11-7, R11-8). Split from
//! `engine.rs`, which owns the picker, so both hold the 200-line rule (I12).
//!
//! Two findings, one calculation.
//!
//! **It would not name what it was destroying (R11-7).** The confirm read
//! *"container2wasm keeps its filesystem in memory, so this reload deletes every
//! file in the workspace and stops anything running in it"* — a pronoun-free
//! generality, printed BELOW both buttons, while the page held a listing of
//! three files and one running process by name. The app knew; the sentence
//! refused to say. It counts now, from the two projections the Workspace view
//! already reads, and it stands ABOVE the buttons, because a consequence a
//! person meets after the control is a caption on a decision already made.
//!
//! **It protected the wrong direction (R11-8).** The arm was gated on
//! `chosen().keeps_files()` — the engine the page is about to RUN. Switching TO
//! container2wasm therefore confirmed, and switching AWAY from it reloaded on
//! one press, which is exactly the reload that destroys an in-memory
//! filesystem: what a reload costs is a fact about the engine the page is
//! RUNNING NOW, and this reads `running` for it.

use std::rc::Rc;

use adapters_web::{Engine, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// What is in the workspace this page is showing: how many files, and the names
/// of what is still running. Both come off the projections the Files and
/// Processes panes already read — no new route, and no capability that was not
/// there.
fn inventory(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> (usize, Vec<String>) {
    let files = crate::listing::read(
        *web,
        agent,
        Request::get("/files").with_header("x-at", "."),
    );
    let here = files.entries.iter().filter(|e| e.name != ".." && !e.name.ends_with('/')).count();
    let (_, procs) = crate::procrows::read(web, agent, Request::get("/processes"));
    (here, crate::procrows::running_names(&procs))
}

/// `3 files`, `1 file`, or — when nothing has been listed here — the whole of
/// it, unnumbered. A count this page has not got is not invented.
fn files_said(n: usize) -> String {
    match n {
        0 => "everything in the folder".to_string(),
        1 => "the 1 file in the folder".to_string(),
        n => format!("the {n} files in the folder"),
    }
}

/// …and the same for what is still running, by name.
fn procs_said(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1 => format!(" and stops {}, the one process running in it", names[0]),
        n => format!(" and stops the {n} processes running in it — {}", names.join(", ")),
    }
}

/// What this reload costs, in a sentence and in a verb phrase for the button
/// that does it. `None` when it costs nothing, which is the only case that gets
/// a one-press secondary.
pub(crate) struct Cost {
    pub(crate) said: String,
    /// The button's own words, so the label names the loss rather than pointing
    /// at it — `Yes — reload and lose that` had no antecedent above it.
    pub(crate) verb: String,
}

pub(crate) fn cost(
    web: &Signal<Option<Rc<WebApp>>>,
    agent: &str,
    busy: &str,
    running: Engine,
) -> Option<Cost> {
    let forgets = !running.keeps_files();
    if busy.is_empty() && !forgets {
        return None;
    }
    let (mut said, mut verb) = (Vec::new(), Vec::new());
    if forgets {
        let (files, procs) = inventory(web, agent);
        said.push(format!(
            "{} keeps its filesystem in memory. Reloading this page deletes {}{}.",
            running.label(),
            files_said(files),
            procs_said(&procs)
        ));
        verb.push(match files {
            0 => "delete the folder".to_string(),
            1 => "delete 1 file".to_string(),
            n => format!("delete {n} files"),
        });
        if !procs.is_empty() {
            verb.push(match procs.len() {
                1 => "stop 1 process".to_string(),
                n => format!("stop {n} processes"),
            });
        }
    }
    if !busy.is_empty() {
        said.push(format!("{busy} is working; the reload ends that turn where it stands."));
        verb.push(format!("end {busy}'s turn"));
    }
    Some(Cost {
        said: said.join(" "),
        verb: match verb.split_last() {
            None => String::new(),
            Some((last, [])) => last.clone(),
            Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
        },
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_cost_is_counted_and_never_invented() {
        assert_eq!(super::files_said(0), "everything in the folder");
        assert_eq!(super::files_said(1), "the 1 file in the folder");
        assert_eq!(super::files_said(3), "the 3 files in the folder");
        assert_eq!(super::procs_said(&[]), "");
        let one = vec!["ticker".to_string()];
        assert!(super::procs_said(&one).contains("stops ticker, the one process"));
        let two = vec!["ticker".to_string(), "web".to_string()];
        assert!(super::procs_said(&two).contains("the 2 processes running in it — ticker, web"));
    }
}
