//! # Events: what the full screen is told, and what it asks for
//!
//! The two lists between `app.rs` and the world. [`Got`] is everything that can happen to
//! the window: a key, a click, an answer from the service, a change on its feed. [`Want`] is
//! everything the window can ask of the service. `client.rs` turns real keys into the first
//! and real questions out of the second; a test writes both by hand.
use super::panes::Pane;
use crate::core::boxes::SessionBox;
use crate::core::screen::Screen;

/// A key, named as a browser names it (`ui/features/terminals.rs`, `typed`).
#[derive(Clone, Debug, PartialEq)]
pub struct Key {
    pub name: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

#[cfg(test)]
impl Key {
    pub fn plain(name: &str) -> Key {
        Key { name: name.into(), ctrl: false, alt: false, shift: false }
    }
    pub fn ctrl(name: &str) -> Key {
        Key { ctrl: true, ..Key::plain(name) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mouse {
    Down(u16, u16),
    Drag(u16, u16),
    Up,
    /// The wheel, turned up (`true`) or down, over a cell.
    Wheel(bool, u16, u16),
}

/// What happened.
#[derive(Clone, Debug, PartialEq)]
pub enum Got {
    Key(Key),
    Mouse(Mouse),
    Paste(String),
    /// The window has this many columns and rows.
    Size(u16, u16),
    Boxes(Vec<SessionBox>),
    /// A terminal's screen, by the terminal's id.
    Screen(String, Screen),
    /// An engine's or a session's lines, by the box's id.
    Talk(String, Vec<String>),
    /// The shell asked for this pane runs, in the terminal with this id.
    Opened(Pane, String),
    /// Something went as asked; one sentence about it.
    Said(String),
    /// Something could not be done; the sentence why.
    Failed(String),
    /// The change feed named these keys.
    Changed(Vec<String>),
    /// The service does not answer.
    Away(String),
    /// It answers again; `true` when it is a new run of it (ask for everything again).
    Back(bool),
}

/// What the app wants asked of the service.
#[derive(Clone, Debug, PartialEq)]
pub enum Want {
    Boxes,
    Screen(String),
    Talk(String),
    /// A new shell for this pane, in a terminal of this size.
    Open { pane: Pane, cols: u16, rows: u16 },
    Type { id: String, keys: String },
    Resize { id: String, cols: u16, rows: u16 },
    Close(String),
    /// Speak into an engine or a session.
    Say { box_id: String, text: String },
    Leave,
}
