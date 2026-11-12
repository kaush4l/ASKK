//! Answers: terminals.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
//!
//! The service holds each terminal for its program's whole life (`core/terminals.rs`). A
//! window asks for the screen when the change feed names `terminals/<id>`, and says what to
//! type. A build that cannot start a program answers each of these with one sentence that
//! says so.
use super::*;

fn held() -> std::sync::Arc<dyn crate::core::terminals::Terminals> {
    crate::core::terminals::terminals()
}

/// Start `command` in a terminal of its own, `cols` × `rows`, and give its id. An empty
/// command is the person's own shell. `place` is a folder under the workspace (made if it is
/// not there); empty is the workspace itself. The program is confined to that folder where
/// this build can confine (the box's fact `confined` says how). It runs on after whoever
/// asked has left; `terminal_close` ends it.
pub async fn terminal_open(command: String, place: String, cols: u16, rows: u16) -> Result<String, String> {
    held().open(&command, &place, cols, rows)
}

/// The terminal's screen as it stands now: rows of text with their looks, the cursor, the
/// title, and whether the program still runs (`core/screen.rs`).
pub async fn terminal_screen(id: String) -> Result<Screen, String> {
    held().screen(&id)
}

/// The terminal's screen as it was `back` rows up: what has scrolled off the top is kept
/// (a thousand rows). The answer says how far up it really is, which is less than was asked
/// for when there is no more. A window asks this while a person scrolls back, and
/// `terminal_screen` again when they are back at the end.
pub async fn terminal_scrolled(id: String, back: u16) -> Result<Scrolled, String> {
    held().scrolled(&id, back)
}

/// Type into the terminal. `keys` is what a terminal sends for them: the letters themselves,
/// `\r` for Enter, `\u{7f}` for Backspace, `\u{3}` for Ctrl-C, `\u{1b}[A` for the up arrow
/// (`ui/features/terminals.rs` has the whole table).
pub async fn terminal_type(id: String, keys: String) -> Result<(), String> {
    held().type_keys(&id, &keys)
}

/// Give the terminal a new size; the program is told, and draws itself again.
pub async fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    held().resize(&id, cols, rows)
}

/// End the terminal's program, and everything it started there, and forget the terminal.
pub async fn terminal_close(id: String) -> Result<(), String> {
    held().close(&id)
}

/// How `askk terminal` last laid out its tabs of split panes in this home: what each pane
/// shows (a box's id), how the splits share the room, which pane has the focus. Empty when
/// none is kept. A window that opens asks this and lays its panes out again; a terminal the
/// service no longer holds leaves its pane empty.
pub async fn terminal_layout() -> Result<Layout, String> {
    Ok(crate::core::terminals::layout(&*crate::core::store::data()))
}

/// Keep `layout` for the next window of this home (it outlives the window and is kept on
/// disk, beside the settings). A layout that cannot be laid out is refused in a sentence;
/// an empty one forgets what was kept.
pub async fn save_terminal_layout(layout: Layout) -> Result<(), String> {
    crate::core::terminals::keep_layout(&*crate::core::store::data(), &layout)
}
