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
//! `core/boxes.rs` turns into a box), a screen looked at further up ([`Scrolled`]), and the
//! guess at what a recognised agent is doing, read off the bottom of its screen ([`guess`]).
use super::boxes::State;
use super::held::Shared;
use super::screen::Screen;
use serde::{Deserialize, Serialize};
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

/// A terminal's screen as it was further up: what has scrolled off the top is kept for a
/// while (a thousand rows), and a window may look back at it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Scrolled {
    /// The rows in view, in the same shape as the live screen; it has no cursor.
    pub screen: Screen,
    /// How many rows up this really is: less than was asked for when there is no more.
    pub back: u16,
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

/// Where the layout of `askk terminal` is kept in the home (the data store).
pub const LAYOUT: &str = "terminal-layout.json";

/// How `askk terminal` last laid out its tabs of split panes, kept by the service for the
/// home, so a window that closes does not take its splits with it: the next window to open
/// lays them out again, and the terminals the service still holds come back in their panes.
/// What a pane shows is a box's id (`terminal:3`, `engine:askk`); empty is nothing.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    #[serde(default)]
    pub tabs: Vec<LaidTab>,
    /// The tab shown, from 0.
    #[serde(default)]
    pub at: usize,
}

/// One tab: its panes, the one in focus (the how-manieth, in reading order, from 0), and
/// whether that one fills the tab.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LaidTab {
    pub panes: Laid,
    #[serde(default)]
    pub focus: usize,
    #[serde(default)]
    pub zoomed: bool,
}

/// A pane and what it shows, or two halves side by side (`down`: one above the other);
/// `share` is what the first gets, in parts of a thousand.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Laid {
    Pane(String),
    Split { down: bool, share: u16, first: Box<Laid>, second: Box<Laid> },
}

/// The most tabs and panes a kept layout may have, and how deep its splits may go.
const MOST_PANES: usize = 256;
const DEEPEST: usize = 24;

impl Laid {
    fn panes(&self, depth: usize, out: &mut usize) -> Result<(), String> {
        if depth > DEEPEST {
            return Err(format!("a layout's splits go at most {DEEPEST} deep"));
        }
        match self {
            Laid::Pane(id) if id.len() > 512 => Err("a pane shows a box by its id, and no id is that long".into()),
            Laid::Pane(_) => {
                *out += 1;
                Ok(())
            }
            Laid::Split { share, .. } if *share == 0 || *share >= 1000 => Err(format!("a split gives each half a part of a thousand, so {share} cannot be the first's")),
            Laid::Split { first, second, .. } => first.panes(depth + 1, out).and_then(|_| second.panes(depth + 1, out)),
        }
    }
}

impl Layout {
    /// Whether this can be laid out: a tab shown that is there, a focus on a pane that is
    /// there, and not more than a window could hold.
    pub fn check(&self) -> Result<(), String> {
        if !self.tabs.is_empty() && self.at >= self.tabs.len() {
            return Err(format!("the layout shows tab {} of {}", self.at + 1, self.tabs.len()));
        }
        let mut all = 0;
        for (i, t) in self.tabs.iter().enumerate() {
            let mut n = 0;
            t.panes.panes(0, &mut n)?;
            if t.focus >= n {
                return Err(format!("tab {} has {n} panes, so its focus cannot be on the {}th", i + 1, t.focus + 1));
            }
            all += n;
        }
        if all > MOST_PANES {
            return Err(format!("a layout holds at most {MOST_PANES} panes; this one has {all}"));
        }
        Ok(())
    }
}

/// The layout kept in `store`; an empty one when none is kept or it cannot be read (the
/// window then starts as a new one does).
pub fn layout(store: &dyn super::store::Store) -> Layout {
    store.get(LAYOUT).and_then(|text| serde_json::from_str::<Layout>(&text).ok()).filter(|l| l.check().is_ok()).unwrap_or_default()
}

/// Keep `layout` in `store`, for the next window. Refused, in a sentence, when it cannot be
/// laid out; an empty one forgets what was kept.
pub fn keep_layout(store: &dyn super::store::Store, layout: &Layout) -> Result<(), String> {
    layout.check()?;
    if layout.tabs.is_empty() {
        return store.remove(LAYOUT).or(Ok(()));
    }
    let text = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
    if store.get(LAYOUT).as_deref() == Some(text.as_str()) {
        return Ok(());
    }
    store.put(LAYOUT, &text)
}

/// What a host that holds terminals does.
pub trait Terminals: Send + Sync {
    /// Start `command` (empty = the person's shell) in `place`, a folder under the workspace
    /// (empty = the workspace), in a terminal of `cols` × `rows`. The terminal's id comes back.
    fn open(&self, command: &str, place: &str, cols: u16, rows: u16) -> Result<String, String>;
    /// The screen as it stands now.
    fn screen(&self, id: &str) -> Result<Screen, String>;
    /// The screen as it was `back` rows up (0 = as it stands now).
    fn scrolled(&self, id: &str, back: u16) -> Result<Scrolled, String>;
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
    fn scrolled(&self, _: &str, _: u16) -> Result<Scrolled, String> {
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
        assert_eq!(none.scrolled("1", 3).unwrap_err(), NONE);
        assert_eq!(none.type_keys("1", "x").unwrap_err(), NONE);
        assert_eq!(none.resize("1", 80, 24).unwrap_err(), NONE);
        assert_eq!(none.close("1").unwrap_err(), NONE);
        assert!(none.all().is_empty());
        assert!(NONE.contains("capability `terminals`"), "the sentence names where to look");
    }

    #[test]
    fn a_layout_is_kept_in_the_home_and_one_that_cannot_be_laid_out_is_refused() {
        use crate::core::store::{Bundle, Store};
        let store = Bundle::memory(Default::default());
        assert_eq!(layout(&store), Layout::default(), "nothing kept: a window starts as a new one");
        let split = Laid::Split { down: false, share: 400, first: Box::new(Laid::Pane("engine:askk".into())), second: Box::new(Laid::Pane("terminal:3".into())) };
        let kept = Layout { tabs: vec![LaidTab { panes: split.clone(), focus: 1, zoomed: false }, LaidTab { panes: Laid::Pane(String::new()), focus: 0, zoomed: true }], at: 1 };
        keep_layout(&store, &kept).unwrap();
        assert_eq!(layout(&store), kept);
        assert!(store.get(LAYOUT).unwrap().contains(r#""pane": "terminal:3""#), "{}", store.get(LAYOUT).unwrap());
        assert_eq!(keep_layout(&store, &Layout { at: 5, ..kept.clone() }).unwrap_err(), "the layout shows tab 6 of 2");
        assert!(keep_layout(&store, &Layout { tabs: vec![LaidTab { panes: split.clone(), focus: 2, zoomed: false }], at: 0 }).unwrap_err().contains("focus cannot be on the 3th"));
        let bad = Laid::Split { down: true, share: 1000, first: Box::new(Laid::Pane("a".into())), second: Box::new(Laid::Pane("b".into())) };
        assert!(keep_layout(&store, &Layout { tabs: vec![LaidTab { panes: bad, focus: 0, zoomed: false }], at: 0 }).is_err());
        assert_eq!(layout(&store), kept, "what was refused changed nothing");
        store.put(LAYOUT, "{").unwrap();
        assert_eq!(layout(&store), Layout::default(), "a kept layout that cannot be read is no layout");
        keep_layout(&store, &Layout::default()).unwrap();
        assert!(store.get(LAYOUT).is_none(), "an empty layout forgets");
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
