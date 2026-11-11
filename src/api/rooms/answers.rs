//! Answers: rooms.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;

/// Every room, oldest first.
pub async fn rooms() -> Result<Vec<Room>, String> {
    crate::core::world::world();
    Ok(crate::host::room::list())
}

/// Make a room from a plan a person filled in.
pub async fn room_open(plan: Plan) -> Result<Room, String> {
    crate::core::world::world();
    crate::host::room::open(&plan).map_err(say)
}

/// Ask the desk agent (a session with `harness`) to design a room from a wish, and make it.
pub async fn room_design(wish: String, harness: String) -> Result<Room, String> {
    crate::core::world::world();
    crate::host::room::design(&wish, harness.trim()).await.map_err(say)
}

/// The modes and presets this home offers.
pub async fn room_curation() -> Result<crate::core::room::Curation, String> {
    crate::core::world::world();
    crate::host::room::curation().map_err(say)
}

/// Ask the desk agent to design a page from a wish and save it; the page's path comes back.
pub async fn room_view(wish: String, harness: String) -> Result<String, String> {
    crate::core::world::world();
    crate::host::room::design_view(&wish, harness.trim()).await.map_err(say)
}

/// Begin a step (empty text = go on) and return at once; lines land in the room as said.
pub async fn room_say(id: u64, text: String) -> Result<(), String> {
    crate::core::world::world();
    crate::host::room::say(id, &text).map_err(say)
}
