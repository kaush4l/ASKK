//! # API: what a window may ask, and the answers
//!
//! | part | where | what it is |
//! | --- | --- | --- |
//! | the shapes | this file and its neighbours (`talk.rs`, `rooms.rs`, …) | what an answer looks like |
//! | the answers | `answers.rs`, `<file>/answers.rs` | plain functions over the core: `async fn name(args) -> Result<T, String>` |
//! | the Dioxus wire | the `wire!` list in each file | one server function per answer, generated |
//! | the plain wire | `ask.rs` | every answer by name, as JSON: `POST /ask/<name>` |
//!
//! A new question: write the function in an answers file, then add one line to that file's
//! `wire!` list and one to the table in `ask.rs`. A test in `structure.rs` names any line
//! that is missing.
//!
//! In the tab build there is no wire: `api::name(…)` *is* the plain function.
// A question no Dioxus view asks is still a question: other UIs ask it (`ask.rs`).
#![cfg_attr(not(feature = "server"), allow(dead_code))]
/// The Dioxus form of a file's questions: one server function per line. Each hands its
/// arguments to the plain function of the same name in the file's `answers` and passes the
/// answer back unchanged. The tab build has no wire: there the plain functions are used directly.
macro_rules! wire {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {
        $(
            #[cfg(not(feature = "local"))]
            #[server]
            pub async fn $name($($arg: $ty),*) -> Result<$out, ServerFnError> {
                answers::$name($($arg),*).await.map_err(ServerFnError::new)
            }
        )*
    };
}

/// An error as the sentence it is.
#[cfg(any(feature = "server", feature = "local"))]
pub(crate) fn say(e: impl ToString) -> String {
    e.to_string()
}

#[cfg(feature = "server")]
pub mod ask;
mod boxes;
mod components;
pub mod models;
mod rooms;
mod routes;
mod service;
mod sessions;
mod surfaces;
mod talk;
pub use boxes::*;
pub use components::*;
pub use rooms::*;
pub use routes::*;
// A page asks `hello` (ui/web/views/live.rs); the rest are asked by other UIs over `ask.rs`.
#[allow(unused_imports)]
pub use service::*;
pub use sessions::*;
pub use surfaces::*;
pub use talk::*;

pub use crate::core::routes::NavLink;
use crate::core::node::Node;
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// `data/ui.json`: brand and UI words. Pages and nav are folders (`data/routes`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default)]
    pub brand: String,
    /// UI words by key (`no-engines`, `no-models`, …); a missing key shows nothing.
    #[serde(default)]
    pub text: std::collections::BTreeMap<String, String>,
    /// Contact details for the footer by label (`email`, `site`, …); empty values are not shown.
    #[serde(default)]
    pub contact: std::collections::BTreeMap<String, String>,
}

impl UiConfig {
    pub fn t(&self, key: &str) -> String {
        self.text.get(key).cloned().unwrap_or_default()
    }

    /// The contact entries that have a value (trimmed), in key order.
    pub fn contact_items(&self) -> Vec<(String, String)> {
        self.contact.iter().map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).filter(|(k, v)| !k.is_empty() && !v.is_empty()).collect()
    }
}

/// `data/layout.json`: how things are arranged (not what they are).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    /// Dashboard columns; 0 = one card per row.
    #[serde(default)]
    pub columns: u8,
    /// Engine paths shown first, in this order; the rest follow by name.
    #[serde(default)]
    pub order: Vec<String>,
    /// Element kinds left out of engine cards.
    #[serde(default)]
    pub hidden: Vec<String>,
    /// Size of each engine on the dashboard (small | medium | large); default medium.
    #[serde(default)]
    pub sizes: std::collections::BTreeMap<String, crate::core::node::Size>,
}

impl Layout {
    /// Positions of `paths` after applying `order`.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub fn arrange(&self, paths: &[String]) -> Vec<usize> {
        let mut idx: Vec<usize> = (0..paths.len()).collect();
        let rank = |p: &String| self.order.iter().position(|o| o == p).unwrap_or(usize::MAX);
        idx.sort_by(|&a, &b| rank(&paths[a]).cmp(&rank(&paths[b])).then(paths[a].cmp(&paths[b])));
        idx
    }
}

/// What the dashboard shows: one card per top-level engine, or why there are none.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WorldView {
    pub engines: Vec<Node>,
    /// Engine paths, in the order shown (for editing the layout).
    pub paths: Vec<String>,
    pub columns: u8,
    pub error: String,
}

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    ui_config() -> UiConfig;
    world_view() -> WorldView;
    engine_view(path: String) -> Node;
    post_message(path: String, text: String) -> u64;
    post_wake(path: String, text: String, by: String) -> u64;
    engine_asks(path: String) -> (String, String);
    pack_export(path: String) -> (Vec<(String, String)>, Vec<(String, String)>);
    pack_import(path: String, files: Vec<(String, String)>) -> Vec<(String, String)>;
    inbox(path: String) -> Vec<crate::core::board::Message>;
    workspace_view(path: String) -> IdeView;
    run_engine(path: String, input: String) -> String;
    clear_history(path: String) -> ();
    engine_prompt(path: String, input: String) -> Vec<crate::core::Section>;
    engine_budget(path: String) -> usize;
    engine_chat(path: String) -> Vec<ChatTurn>;
    kinds() -> Vec<KindDoc>;
    capabilities() -> Vec<crate::core::caps::Cap>;
    engine_object(path: String, size: crate::core::node::Size) -> Node;
    stop_engine(path: String) -> ();
    changes(epoch: u64, seen: u64) -> Changed;
    export_world() -> std::collections::BTreeMap<String, String>;
    manifest() -> crate::core::manifest::Manifest;
    theme() -> std::collections::BTreeMap<String, String>;
    save_theme(tokens: std::collections::BTreeMap<String, String>) -> ();
    layout() -> Layout;
    save_layout(layout: Layout) -> ();
    engine_paths() -> Vec<String>;
    engine_cards() -> Vec<CardView>;
}

/// A running or finished terminal command (spawned job).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JobView {
    pub id: u64,
    pub command: String,
    /// "running", or the exit code.
    pub status: String,
    pub output: String,
}

/// The IDE view of an engine: its workspace (file tree + open files) and the terminal jobs.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct IdeView {
    pub workspace: Option<crate::elements::workspace::WorkspaceView>,
    pub jobs: Vec<JobView>,
}

/// One chat line: `role` is user | model | tool.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ChatTurn {
    pub role: String,
    pub text: String,
    /// The reply's custom fields (`thinking`, …), model turns only.
    #[serde(default)]
    pub fields: Vec<(String, String)>,
}

/// A kind in the catalog: docs, category, and one live object of it at all four sizes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct KindDoc {
    pub kind: String,
    pub doc: String,
    pub category: String,
    /// small, medium, large.
    pub views: Vec<Node>,
    /// Its config keys: `(key, craft|personal|secret, what it does)`.
    #[serde(default)]
    pub params: Vec<(String, String, String)>,
}

/// What changed since a reader last asked: this process's `epoch`, the sequence now, and each
/// changed key with the sequence of its last change ([`crate::core::changes`]).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Changed {
    pub epoch: u64,
    pub seq: u64,
    pub keys: Vec<(String, u64)>,
}

/// One engine as a dashboard card: who it is, what it is doing, its phase and its last step summary.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CardView {
    pub path: String,
    pub name: String,
    pub icon: String,
    /// Live activity (idle, thinking, ...) and its detail.
    pub status: String,
    pub detail: String,
    /// The current phase (any element with the phase role); empty when none.
    pub phase: String,
    /// The first element summary (latest reply summary, else refocus summary); empty when none.
    pub summary: String,
    /// Unseen messages in its inbox.
    pub new_msgs: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_orders_listed_engines_first_then_by_name() {
        let l = Layout { order: vec!["z".into(), "b".into()], ..Default::default() };
        let paths: Vec<String> = ["a", "b", "c", "z"].map(String::from).to_vec();
        let got: Vec<&str> = l.arrange(&paths).into_iter().map(|i| paths[i].as_str()).collect();
        assert_eq!(got, ["z", "b", "a", "c"]);
    }

    /// The shipped defaults boot, and every tool a `tools` element selects exists.
    #[cfg(feature = "server")]
    #[test]
    fn defaults_boot_and_every_selected_tool_exists() {
        use crate::core::{boot, engine::tests::Scripted, Engine};
        fn check(t: &boot::Tree, e: &Engine, shared: &[String]) {
            // The toolbox is gated by the current phase, so the shared set counts too, and so do
            // the sub-engines (each is a tool of its parent, whichever phase allows it).
            let subs = e.subs().iter().map(|s| s.name()).collect::<Vec<_>>();
            let have: Vec<String> = e.toolbox().names().into_iter().chain(shared.iter().cloned()).chain(subs).collect();
            for s in t.specs.iter().filter(|s| s.kind == "tools") {
                for name in s.config["use"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
                    assert!(have.iter().any(|h| h == name), "{}: tool '{name}' does not exist", t.path);
                }
            }
            // Tool calls are read only by a reply-format element: an engine with tools needs one.
            let built: Vec<_> = t.specs.iter().filter_map(|s| crate::core::build(s.clone()).ok()).collect();
            if !e.toolbox().names().is_empty() {
                assert!(built.iter().any(|c| c.parse("answer: ok").is_some()), "{}: has tools but no element reads replies (add a handoff)", t.path);
            }
            // Element tools (phase_done, remember, …) are not in the phase-gated toolbox either.
            let el: Vec<String> = t.specs.iter().filter_map(|s| crate::core::build(s.clone()).ok()).flat_map(|c| c.tools()).map(|x| x.name()).collect();
            for s in t.specs.iter().filter(|s| s.kind == "phase") {
                for p in s.config["phases"].as_array().into_iter().flatten() {
                    for name in p["tools"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
                        assert!(have.iter().chain(&el).any(|h| h == name), "{}: phase tool '{name}' does not exist", t.path);
                    }
                }
            }
            for (st, se) in t.subs.iter().zip(e.subs().iter()) {
                check(st, se, shared);
            }
        }
        let shared = crate::host::tools::shared();
        let names: Vec<String> = shared.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"list_tools".to_string()));
        // Every engine template builds (create_engine copies one).
        let defaults = crate::host::store::Folder::new(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("defaults"));
        for d in defaults.list("templates") {
            let key = format!("templates/{}", d.name);
            let t = boot::scan_one(&*defaults, &key, "tmpl".into()).unwrap_or_else(|e| panic!("{key}: {e}"));
            boot::init(t, defaults.clone(), &shared, Scripted::new(&[])).unwrap_or_else(|e| panic!("{key}: {e}"));
        }
        let trees = boot::scan(&*defaults, "engines").unwrap();
        assert!(!trees.is_empty(), "defaults ship at least one engine");
        for t in trees {
            let e = boot::init(t.clone(), defaults.clone(), &shared, Scripted::new(&[])).unwrap_or_else(|err| panic!("{err}"));
            check(&t, &e, &names);
        }
    }
}
