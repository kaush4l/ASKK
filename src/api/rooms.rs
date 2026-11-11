//! Rooms: several agents and a person in one setup (`core/room.rs`).
use crate::core::room::{Plan, Room};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(feature = "server")]
mod answers;

wire! {
    rooms() -> Vec<Room>;
    room_open(plan: Plan) -> Room;
    room_design(wish: String, harness: String) -> Room;
    room_curation() -> crate::core::room::Curation;
    room_view(wish: String, harness: String) -> String;
    room_say(id: u64, text: String) -> ();
}
