//! # Terminals: the port to the programs the service holds a terminal for
//!
//! The multiplexer is the core of the screen (`docs/concept.md`, section 6): the service
//! starts a program in a terminal of its own and keeps that terminal for the program's whole
//! life, whether or not a window is looking. A window never gets the program's bytes: it asks
//! for the screen those bytes made ([`super::screen::Screen`]) and says what to type.
//!
//! *How* a program is given a terminal differs per build, so the core only says what can be
//! asked ([`Terminals`]) and a host fills it:
//!
//! | build | who holds the terminals | set in |
//! | --- | --- | --- |
//! | the service, and `askk terminal` on its own home | this machine: a real pseudo-terminal per program (`host/terminals.rs`) | `host/mod.rs` |
//! | a browser tab | nobody: a tab cannot start a program, and every question says so ([`NONE`]) | |
//!
//! What is here besides the port: the limits of a screen's size ([`size`]), a terminal's key
//! on the change feed ([`key`]), what the service knows of one terminal ([`Terminal`], which
//! `core/boxes.rs` turns into a box), and the guess at what a recognised agent is doing, read
//! off the bottom of its screen ([`guess`]).
use super::boxes::State;
use super::held::Shared;
use super::screen::Screen;
use std::sync::{Arc, RwLock};

/// What a build that holds no terminals answers.
pub const NONE: &str = "this build holds no terminals: it cannot start a program (see the capability `terminals`)";

/// The smallest and the largest screen a terminal may have.
pub const LEAST: (u16, u16) = (2, 1);
pub const MOST: (u16, u16) = (500, 200);

/// The most that may be typed in one question (the bytes of a large paste).
pub const MOST_KEYS: usize = 64 * 1024;

/// `cols` × `rows` as a screen size, or why it cannot be one.
pub fn size(cols: u16, rows: u16) -> Result<(u16, u16), String> {
    if cols < LEAST.0 || rows < LEAST.1 || cols > MOST.0 || rows > MOST.1 {
        return Err(format!("a terminal's screen is between {} × {} and {} × {} (columns × rows); {cols} × {rows} was asked for", LEAST.0, LEAST.1, MOST.0, MOST.1));
    }
    Ok((cols, rows))
}

/// A terminal's key on the change feed: marked when its screen changes, when its program
/// ends, and when it is opened or closed.
pub fn key(id: &str) -> String {
    format!("terminals/{id}")
}

/// What the service knows of one terminal it holds.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Terminal {
    pub id: String,
    /// The command as it was asked for; empty = the person's shell.
    pub command: String,
    /// The name of the program that runs in it (`zsh`, `vim`).
    pub program: String,
    /// The folder under the workspace it was started in; empty = the workspace itself.
    pub place: String,
    pub cols: u16,
    pub rows: u16,
    pub alive: bool,
    /// How the program ended, once it has.
    pub exit: Option<i32>,
    /// The title the program set; empty when it set none.
    pub title: String,
    /// The last row of its screen that says something.
    pub last: String,
    /// The rows at the bottom of its screen that say something, top to bottom (for [`guess`]).
    pub bottom: Vec<String>,
    /// How the program is confined, in words (`core/sandbox.rs`).
    pub confined: String,
    /// The agent the program was recognised as by its name; empty when it is no known agent.
    pub agent: String,
}

/// How many rows from the bottom of a screen a guess is read from.
pub const BOTTOM: usize = 12;

/// What an agent's screen shows while it waits for a yes or a no, and while it works. Few on
/// purpose: a mark that is wrong is worse than one that says idle.
const ASKS: [&str; 4] = ["(y/n)", "[y/n]", "do you want to", "1. yes"];
const WORKS: [&str; 2] = ["esc to interrupt", "ctrl+c to interrupt"];

/// A guess at what a recognised agent is doing, read off the bottom rows of its screen. It is
/// a guess and the box says so: only an agent that reports its own state is known.
pub fn guess(bottom: &[String]) -> State {
    let rows: Vec<String> = bottom.iter().map(|r| r.to_lowercase()).collect();
    let shows = |marks: &[&str]| rows.iter().any(|r| marks.iter().any(|m| r.contains(m)));
    match () {
        _ if shows(&ASKS) => State::Blocked,
        _ if shows(&WORKS) => State::Working,
        _ => State::Idle,
    }
}

/// What a host that holds terminals does.
pub trait Terminals: Send + Sync {
    /// Start `command` (empty = the person's shell) in `place`, a folder under the workspace
    /// (empty = the workspace), in a terminal of `cols` × `rows`. The terminal's id comes back.
    fn open(&self, command: &str, place: &str, cols: u16, rows: u16) -> Result<String, String>;
    /// The screen as it stands now.
    fn screen(&self, id: &str) -> Result<Screen, String>;
    /// Type `keys`: the bytes a terminal sends for them (`\r` for Enter, `\u{1b}[A` for up).
    fn type_keys(&self, id: &str, keys: &str) -> Result<(), String>;
    fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>;
    /// End the program and forget the terminal.
    fn close(&self, id: &str) -> Result<(), String>;
    /// Every terminal held, oldest first.
    fn all(&self) -> Vec<Terminal>;
}

/// No terminals: what a build without a host for them has.
struct Nothing;

impl Terminals for Nothing {
    fn open(&self, _: &str, _: &str, _: u16, _: u16) -> Result<String, String> {
        Err(NONE.into())
    }
    fn screen(&self, _: &str) -> Result<Screen, String> {
        Err(NONE.into())
    }
    fn type_keys(&self, _: &str, _: &str) -> Result<(), String> {
        Err(NONE.into())
    }
    fn resize(&self, _: &str, _: u16, _: u16) -> Result<(), String> {
        Err(NONE.into())
    }
    fn close(&self, _: &str) -> Result<(), String> {
        Err(NONE.into())
    }
    fn all(&self) -> Vec<Terminal> {
        vec![]
    }
}

static TERMINALS: RwLock<Option<Arc<dyn Terminals>>> = RwLock::new(None);

/// The host names who holds the terminals, once, at start.
pub fn set(terminals: Arc<dyn Terminals>) {
    *TERMINALS.writing() = Some(terminals);
}

/// Who holds the terminals in this build.
pub fn terminals() -> Arc<dyn Terminals> {
    TERMINALS.reading().clone().unwrap_or_else(|| Arc::new(Nothing))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_with_no_terminals_says_so_to_every_question() {
        let none = Nothing;
        assert_eq!(none.open("", "", 80, 24).unwrap_err(), NONE);
        assert_eq!(none.screen("1").unwrap_err(), NONE);
        assert_eq!(none.type_keys("1", "x").unwrap_err(), NONE);
        assert_eq!(none.resize("1", 80, 24).unwrap_err(), NONE);
        assert_eq!(none.close("1").unwrap_err(), NONE);
        assert!(none.all().is_empty());
        assert!(NONE.contains("capability `terminals`"), "the sentence names where to look");
    }

    #[test]
    fn a_screen_has_a_size_a_terminal_can_have() {
        assert_eq!(size(80, 24), Ok((80, 24)));
        for (cols, rows) in [(0, 24), (80, 0), (501, 24), (80, 201)] {
            assert!(size(cols, rows).unwrap_err().contains(&format!("{cols} × {rows} was asked for")));
        }
        assert_eq!(key("7"), "terminals/7");
    }

    #[test]
    fn a_state_read_off_a_screen_is_blocked_only_on_a_question_and_working_only_when_it_says_so() {
        let rows = |text: &str| text.lines().map(String::from).collect::<Vec<_>>();
        assert_eq!(guess(&rows("Edit src/main.rs\nDo you want to make this edit?\n❯ 1. Yes\n  2. No")), State::Blocked);
        assert_eq!(guess(&rows("Overwrite the file? [y/N]")), State::Blocked);
        assert_eq!(guess(&rows("Which file should be changed?")), State::Idle, "a question it has not learnt is not guessed at");
        assert_eq!(guess(&rows("✻ Thinking… (12s · esc to interrupt)")), State::Working);
        assert_eq!(guess(&rows("> ")), State::Idle, "a prompt it has not learnt reads as idle");
        assert_eq!(guess(&[]), State::Idle);
    }
}
