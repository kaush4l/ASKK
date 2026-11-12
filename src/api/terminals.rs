//! Terminals: the programs the service holds a terminal for (`core/terminals.rs`), each seen
//! as the screen it shows (`core/screen.rs`). A terminal is also a box (`boxes`).
use crate::core::screen::Screen;
use crate::core::terminals::{Layout, Scrolled};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    terminal_open(command: String, place: String, cols: u16, rows: u16) -> String;
    terminal_screen(id: String) -> Screen;
    terminal_scrolled(id: String, back: u16) -> Scrolled;
    terminal_type(id: String, keys: String) -> ();
    terminal_resize(id: String, cols: u16, rows: u16) -> ();
    terminal_close(id: String) -> ();
    terminal_layout() -> Layout;
    save_terminal_layout(layout: Layout) -> ();
    terminal_sessions() -> Vec<String>;
    session_layout(session: String) -> Layout;
    save_session_layout(session: String, layout: Layout) -> ();
}
