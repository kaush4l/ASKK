//! One read of the `/files` projection, for the two panes that watch a folder.
//!
//! `files.rs` watches the workspace root and `artifacts.rs` watches
//! `artifacts/`, and both of them were parsing the same two headers — the
//! `x-entries` list and the `x-file` pair — out of the same response with two
//! copies of the same twenty lines. Split out here so the parse has one home
//! (I12): the panes own their arrangement, this owns what a listing IS.
//!
//! It reads headers, not markup. `x-entries` is the core's own tab-separated
//! `name\tpath` list and `x-file` is `path\nbytes`, so neither pane needs a
//! parser for the `<pre>` the core also renders.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// One row of a listing: what to show, and what opening it means.
#[derive(Clone, PartialEq)]
pub(crate) struct Entry {
    pub(crate) name: String,
    pub(crate) path: String,
}

/// What a folder-watching pane is showing: the core's fragment, the entries it
/// named, and the open file's path and bytes. One value, so the buttons, the
/// prose and the editor can never disagree about which file is open.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Listing {
    pub(crate) html: String,
    pub(crate) entries: Vec<Entry>,
    pub(crate) open: String,
    pub(crate) body: String,
    /// How many facts have happened that could have changed this folder
    /// (`x-workspace-at`). A pane asks for a fresh listing when it moves —
    /// including for a command a PERSON typed, which is the half the agent's
    /// status stamp cannot see (R14-P1-3).
    pub(crate) stamp: usize,
}

/// One trip through the seam for this agent's files. The caller supplies the
/// whole `Request`, because the folder is a HEADER on it (`x-at`) and only the
/// caller knows which folder it is watching.
pub(crate) fn read(web: Signal<Option<Rc<WebApp>>>, agent: &str, req: Request) -> Listing {
    let Some(app) = web.peek().clone() else {
        return Listing::default();
    };
    let res = app.handle(req.with_header("x-agent", agent));
    let header = |name: &str| {
        res.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    let entries = header("x-entries")
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
    let (open, body) = header("x-file")
        .and_then(|v| {
            v.split_once('\n')
                .map(|(path, body)| (path.to_string(), body.to_string()))
        })
        .unwrap_or_default();
    let stamp = header("x-workspace-at").and_then(|v| v.parse().ok()).unwrap_or_default();
    Listing {
        html: res.body,
        entries,
        open,
        body,
        stamp,
    }
}

/// THE FILE A SENTENCE POINTED AT (R9-4). The conversation is markup the core
/// rendered, so there is no component on that button to hang a handler on: the
/// click is caught on the log around it and this asks the DOM which row it
/// landed in. `closest` because the press may land on the text node inside.
/// `None` for every click that was not on one, which is nearly all of them.
pub(crate) fn clicked_path(event: &Event<MouseData>) -> Option<String> {
    use wasm_bindgen::JsCast;
    let target = event.downcast::<web_sys::MouseEvent>()?.target()?;
    let row = target.dyn_ref::<web_sys::Element>()?.closest(".file-ref").ok()??;
    row.get_attribute("data-path")
}

/// …and OPEN it, through the same seam call the Files pane's own rows make: a
/// `POST /files` emits the request, the async half performs `read_file`, and
/// the pane shows what came back. No second route and no second way to read a
/// file — the reason this is three lines rather than a feature.
pub(crate) fn open_path(web: Signal<Option<Rc<WebApp>>>, agent: &str, path: &str, folder: bool) {
    let Some(app) = web.peek().clone() else { return };
    let kind = match folder {
        true => "folder",
        false => "file",
    };
    app.handle(
        Request::post_form("/files", &[("path", path), ("kind", kind)])
            .with_header("x-agent", agent),
    );
}

/// One folder's FILES, for the artifact shelf: `x-at` scopes the projection, so
/// this and the Files pane watch two folders without overwriting each other's
/// listing. Folders and `..` are dropped — a shelf shows what was MADE, and
/// there is nothing to render for a directory.
pub(crate) fn files_in(web: Signal<Option<Rc<WebApp>>>, agent: &str, at: &str) -> Listing {
    let mut shelf = read(web, agent, Request::get("/files").with_header("x-at", at));
    shelf.entries.retain(|e| e.name != ".." && !e.name.ends_with('/'));
    shelf
}

/// Whether the core served a LISTING rather than the sentence it gives a pane
/// whose agent has no folder here (R5-1) — the `#files` list it always writes
/// when there is one. One bit off markup the core already writes, the rule
/// `ui::has_rows` follows; the two panes must not answer it differently.
pub(crate) fn served(html: &str) -> bool {
    html.contains("id=\"files\"")
}

/// …and WHY it was not served, when the reason is "this agent is in no shared
/// space" (R7-4). The core names the condition on the fragment (`data-why`) so
/// the shelf can say something of its own instead of reprinting the sentence
/// the pane above it is already showing. One bit off markup the core writes,
/// the same rule `served` follows.
pub(crate) fn spaceless(html: &str) -> bool {
    html.contains("data-why=\"no-space\"")
}

/// How long a pane watches for a listing the async half is still producing. Two
/// minutes at 500 ms: a cold Linux mounts its image before the first `ls`
/// returns, and giving up early would leave the folder looking empty.
pub(crate) const TICK_MS: i32 = 500;
pub(crate) const WATCH_TICKS: u32 = 240;

/// Watch the folder `at` until its listing CHANGES, then show it — one watcher
/// at a time, whatever the click rate, because each tick is a full trip through
/// the seam.
///
/// It asks for nothing. That is the point: a pane that wanted the newest
/// listing used to POST for one, and a SAVE already has a read of its own
/// coming from `core::workspace::save_typed` — so one save logged the same
/// `read_file` twice, once as the person's and once as the agent's (R5-12).
/// Watching and asking are two acts, and this is only the first.
pub(crate) fn follow(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    mut panel: Signal<Listing>,
    mut watching: Signal<bool>,
) {
    let before = panel.peek().clone();
    if watching.peek().to_owned() {
        return;
    }
    watching.set(true);
    spawn(async move {
        for _ in 0..WATCH_TICKS {
            if sleep(TICK_MS).await.is_err() {
                return;
            }
            let folder = at.peek().clone();
            let next = read(
                web,
                &agent(),
                Request::get("/files").with_header("x-at", &folder),
            );
            if next != before && !next.html.is_empty() {
                panel.set(next);
                break;
            }
        }
        watching.set(false);
    });
}
