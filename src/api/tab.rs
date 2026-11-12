//! The tab's answers to what only a machine can do (`local` build only).
//!
//! In the tab the page asks the plain functions directly (no wire), so every question a view
//! may ask must have an answer here too. What the tab has, it answers (the change feed, the
//! models, which live in its store). What needs a machine (harnesses, rooms, uploads sensed by
//! programs, a workspace's jobs) answers a list with nothing in it, and an action with one
//! sentence that says why, the same as a missing capability does (`core/caps.rs`).
use super::*;
use crate::core::models::{Found, Models};
use crate::core::room::{Curation, Plan, Room};
use crate::core::session::{HarnessInfo, Session};

fn lacks(what: &str) -> String {
    format!("{what} needs askk on a machine; this tab has no programs to run (see what this build has, under Settings)")
}

/// The one live feed, as the server's: parks until something in the tab's world is marked
/// changed after `seen` (or ~20 s). The tab has no thread to wait on, so it looks a few times a
/// second on the tab's own loop.
pub async fn changes(epoch: u64, seen: u64) -> Result<Changed, String> {
    use crate::core::changes as c;
    let now = c::epoch();
    if epoch == 0 {
        return Ok(Changed { epoch: now, seq: c::now(), keys: vec![] });
    }
    let seen = if epoch == now { seen } else { 0 };
    for _ in 0..80 {
        let (seq, keys) = c::since(seen);
        if !keys.is_empty() {
            return Ok(Changed { epoch: now, seq, keys });
        }
        let _ = dioxus::document::eval("return new Promise(r => setTimeout(() => r(0), 250));").await;
    }
    Ok(Changed { epoch: now, seq: c::now(), keys: vec![] })
}

pub async fn workspace_view(_path: String) -> Result<IdeView, String> {
    Ok(IdeView::default())
}

pub async fn workspace_diff(_path: String) -> Result<WorkspaceDiff, String> {
    Err(lacks("A workspace (the files an engine changes)"))
}

pub async fn workspace_file(_path: String, _file: String) -> Result<String, String> {
    Err(lacks("A workspace (the files an engine reads)"))
}

pub async fn media_begin(_name: String, _mime: String) -> Result<String, String> {
    Err(lacks("An attachment"))
}

pub async fn media_piece(_id: String, _data: String) -> Result<u64, String> {
    Err(lacks("An attachment"))
}

pub async fn media_done(_id: String) -> Result<Chip, String> {
    Err(lacks("An attachment"))
}

pub async fn media_picture(_id: String) -> Result<String, String> {
    Ok(String::new())
}

/// The models live in the tab's store, as on a machine.
pub async fn list_models() -> Result<Models, String> {
    Ok(crate::core::store::data().get(&crate::core::manifest::manifest().models).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub async fn save_models(models: Models) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&models).map_err(say)?;
    crate::core::store::data().put(&crate::core::manifest::manifest().models, &text).map_err(say)
}

pub async fn discover_models(_method: String, _base_url: String, _token_env: String) -> Result<Vec<Found>, String> {
    Err(lacks("Finding a server's models"))
}

pub async fn infer(_model: String, _prompt: String) -> Result<String, String> {
    Err("in this tab an engine reaches a model through the model server set on its page".into())
}

pub async fn harnesses() -> Result<Vec<HarnessInfo>, String> {
    Ok(vec![])
}

pub async fn sessions() -> Result<Vec<Session>, String> {
    Ok(vec![])
}

pub async fn session_open(_harness: String, _title: String, _project: String) -> Result<Session, String> {
    Err(lacks("Another agent's session"))
}

pub async fn session_prompt(_id: u64, _text: String) -> Result<(), String> {
    Err(lacks("Another agent's session"))
}

pub async fn session_permit(_id: u64, _mode: String) -> Result<Session, String> {
    Err(lacks("Another agent's session"))
}

pub async fn rooms() -> Result<Vec<Room>, String> {
    Ok(vec![])
}

pub async fn room_open(_plan: Plan) -> Result<Room, String> {
    Err(lacks("A room"))
}

pub async fn room_design(_wish: String, _harness: String) -> Result<Room, String> {
    Err(lacks("A room"))
}

pub async fn room_curation() -> Result<Curation, String> {
    Ok(Curation::default())
}

pub async fn room_view(_wish: String, _harness: String) -> Result<String, String> {
    Err(lacks("A room"))
}

pub async fn room_say(_id: u64, _text: String) -> Result<(), String> {
    Err(lacks("A room"))
}

/// Where this tab asks a model, as its settings show it: the token itself never leaves memory,
/// only whether one is set.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TabModel {
    /// An askk server (`…/ask`) or an OpenAI-style one (`…/v1`); empty = the built-in echo.
    pub base: String,
    pub model: String,
    pub token_set: bool,
}

pub async fn tab_model() -> Result<TabModel, String> {
    let t = crate::core::models::reach();
    Ok(TabModel { base: t.base, model: t.model, token_set: !t.token.is_empty() })
}

/// Set where this tab asks. The token is held in memory only and is gone when the tab closes;
/// an empty token keeps the one already set.
pub async fn set_tab_model(base: String, model: String, token: String) -> Result<(), String> {
    let mut t = crate::core::models::reach();
    t.base = base.trim().to_string();
    t.model = model.trim().to_string();
    if !token.is_empty() {
        t.token = token;
    }
    crate::core::models::set_reach(t);
    Ok(())
}
