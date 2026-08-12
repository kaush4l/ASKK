//! `Files` — the workspace folder, browsable (15G). The one categorical
//! advantage this product has over every browser agent that runs on
//! WebContainers is that the sandbox is a real x86 Linux; until this pane
//! there was no way to see a byte of it without typing `ls`.
//!
//! It owns no capability. Every listing and every read is the `list_files` /
//! `read_file` tool going through the same gate the agent's own calls do, so
//! the pane is a projection of `ToolInvoked` facts (I8) — and an agent working
//! in this folder updates it as it goes, with nothing here polling for changes
//! it caused.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::Card;

/// How the pane watches for a listing the async half is still producing. Two
/// minutes at 500 ms: a cold CheerpX streams its disk before the first `ls`
/// returns, and giving up early would leave the folder looking empty.
const TICK_MS: i32 = 500;
const WATCH_TICKS: u32 = 240;

/// One row of the listing: what to show, and what opening it means.
#[derive(Clone, PartialEq)]
struct Entry {
    name: String,
    path: String,
}

/// What the pane is showing: the core's fragment, and the entries it named in
/// `x-entries`. One value, so the buttons and the prose can never disagree
/// about which folder is open.
#[derive(Clone, Default, PartialEq)]
struct Shown {
    html: String,
    entries: Vec<Entry>,
}

/// One trip through the seam for this agent's files.
fn ask(web: Signal<Option<Rc<WebApp>>>, agent: &str, req: Request) -> Shown {
    let Some(app) = web.peek().clone() else {
        return Shown::default();
    };
    let res = app.handle(req.with_header("x-agent", agent));
    let entries = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-entries")
        .map(|(_, v)| v.as_str())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let (name, path) = line.split_once('\t')?;
            Some(Entry {
                name: name.to_string(),
                path: path.to_string(),
            })
        })
        .collect();
    Shown {
        html: res.body,
        entries,
    }
}

#[component]
pub fn Files(
    web: Signal<Option<Rc<WebApp>>>,
    /// Bumped by every projection, which is what makes an agent's own writes
    /// appear here while it is still working.
    tick: Signal<u32>,
    agent: ReadSignal<String>,
) -> Element {
    let mut panel = use_signal(Shown::default);
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        panel.set(ask(web, &agent(), Request::get("/files")));
    });
    // One handler per row, told the PATH rather than an index into a list it
    // would have to rebuild to interpret.
    let mut open = move |(path, folder): (String, bool)| {
        let before = panel.peek().clone();
        // The answer to the POST is the pane as it is NOW: the listing runs in
        // the async half, exactly as a typed command does. So this watches for
        // it, and watches for a CHANGE rather than for quiet — the first
        // listing on a cold page can take as long as the disk takes.
        panel.set(ask(
            web,
            &agent(),
            Request::post_form(
                "/files",
                &[("path", path.as_str()), ("kind", if folder { "folder" } else { "file" })],
            ),
        ));
        spawn(async move {
            for _ in 0..WATCH_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    return;
                }
                let next = ask(web, &agent(), Request::get("/files"));
                if next != before && !next.html.is_empty() {
                    panel.set(next);
                    return;
                }
            }
        });
    };
    let shown = panel.read().clone();
    rsx! {
        Card { title: "Files", aria_label: "Workspace files",
            div { class: "file-form",
                button {
                    class: "file-entry root",
                    onclick: move |_| open((".".to_string(), true)),
                    "⟳ workspace root"
                }
                div { class: "file-list", aria_label: "Entries",
                    for item in shown.entries.iter().cloned() {
                        button {
                            key: "{item.path}",
                            class: if item.name.ends_with('/') { "file-entry folder" } else { "file-entry" },
                            onclick: move |_| open((item.path.clone(), item.name.ends_with('/') || item.name == "..")),
                            "{item.name}"
                        }
                    }
                }
                div { aria_live: "polite", dangerous_inner_html: "{shown.html}" }
            }
        }
    }
}
