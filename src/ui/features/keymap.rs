//! # Keymap: the keys that work the panes, after the prefix
//!
//! herdr's and tmux's keys by default; the owner's when `settings.json` names others
//! (`keys`, read by `core/keys.rs`). Written once, so every UI that has panes agrees:
//!
//! | question | answer |
//! | --- | --- |
//! | is this key the prefix? | [`Keymap::is_prefix`] |
//! | what does the key after it do? | [`Keymap::after_prefix`]: an [`Action`] |
//! | how is a key written for a person? | [`Keymap::says`], [`shown`] |
//! | which keys are there, in words? | [`Keymap::help`] (the help screen), [`Keymap::hints`] (the foot) |
//!
//! The prefix pressed twice sends the prefix itself to the program.
use crate::core::keys::{Bound, Chord, Keys};

/// A direction on the screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Way {
    Left,
    Right,
    Up,
    Down,
}

/// What a person can do with the panes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// A new tab with a new shell in it.
    NewTab,
    /// Split the pane, with a new shell in the new half.
    SplitRight,
    SplitDown,
    NextTab,
    PreviousTab,
    /// Go to the tab with this number, from 1.
    Tab(usize),
    /// Show the box with this number, from 1, in the order of what needs the owner first.
    Box(usize),
    /// Go to the sidebar to choose a box.
    Navigate,
    /// Move to the pane on that side.
    Focus(Way),
    /// Let the pane fill the tab, and back.
    Zoom,
    /// Look further up in the pane (`true`), or back down towards the end.
    Scroll(bool),
    /// Move over a terminal's pane and its scroll-back, select, and copy.
    CopyMode,
    /// Take the pane away; its box keeps running.
    ClosePane,
    /// End the terminal in the pane, and its program with it.
    EndTerminal,
    /// Fold the sidebar to marks, and open it again.
    FoldSidebar,
    Help,
    /// Leave; everything keeps running in the service.
    Detach,
    /// Send the prefix key itself to the program.
    SendPrefix,
}

/// Each entry of the keys table: what it does, and the words for it.
const ENTRIES: [(&str, Action, &str); 19] = [
    ("new_tab", Action::NewTab, "a new tab, with a shell in it"),
    ("split_right", Action::SplitRight, "split to the right, with a shell in the new pane"),
    ("split_down", Action::SplitDown, "split downwards, with a shell in the new pane"),
    ("next_tab", Action::NextTab, "the next tab"),
    ("previous_tab", Action::PreviousTab, "the previous tab"),
    ("sidebar", Action::Navigate, "the sidebar: arrows choose a box, Enter shows it in the pane"),
    ("focus_left", Action::Focus(Way::Left), "move to the pane on the left"),
    ("focus_right", Action::Focus(Way::Right), "move to the pane on the right"),
    ("focus_up", Action::Focus(Way::Up), "move to the pane above"),
    ("focus_down", Action::Focus(Way::Down), "move to the pane below"),
    ("zoom", Action::Zoom, "zoom: the pane fills the tab, and back"),
    ("scroll_up", Action::Scroll(true), "look back up a pane (the wheel does too)"),
    ("scroll_down", Action::Scroll(false), "and down again"),
    ("copy_mode", Action::CopyMode, "copy mode: arrows or h j k l move, v selects, y or Enter copies, Esc leaves"),
    ("close_pane", Action::ClosePane, "close the pane; its box keeps running"),
    ("end_terminal", Action::EndTerminal, "end the terminal in the pane, and its program"),
    ("fold_sidebar", Action::FoldSidebar, "fold the sidebar to marks, and open it again"),
    ("help", Action::Help, "this help"),
    ("detach", Action::Detach, "detach: leave, and everything keeps running"),
];

/// The entries the foot names while nothing is pressed, with its short word for each.
const HINTS: [(Action, &str); 7] = [(Action::NewTab, "tab"), (Action::SplitRight, "split right"), (Action::SplitDown, "split down"), (Action::Navigate, "boxes"), (Action::Zoom, "zoom"), (Action::Help, "help"), (Action::Detach, "detach")];

/// A key as a person reads it: `ctrl+b`, `c`, `←`, `PgUp`.
pub fn shown(c: &Chord) -> String {
    let name = match c.key.as_str() {
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "PageUp" => "PgUp",
        "PageDown" => "PgDn",
        "Escape" => "esc",
        "Enter" => "enter",
        " " => "space",
        other => other,
    };
    let mut out = String::new();
    for (held, word) in [(c.ctrl, "ctrl+"), (c.alt, "alt+"), (c.shift, "shift+")] {
        if held {
            out.push_str(word);
        }
    }
    out + name
}

/// The keys in force: the prefix, and what each key after it does.
#[derive(Clone, Debug, PartialEq)]
pub struct Keymap {
    bound: Bound,
}

impl Default for Keymap {
    fn default() -> Self {
        // The built-in table is read by a test; should it ever not be, there is still a prefix.
        Keymap::new(&Keys::default()).unwrap_or_else(|_| Keymap { bound: Bound { prefix: Chord { key: "b".into(), ctrl: true, ..Default::default() }, entries: vec![], boxes: vec![], tabs: vec![] } })
    }
}

impl Keymap {
    /// The keys as the table writes them, or the sentence why it cannot be read.
    pub fn new(keys: &Keys) -> Result<Keymap, String> {
        Ok(Keymap { bound: keys.bound()? })
    }

    /// Whether the key pressed (`key` named as a browser names it) is `c`.
    fn matches(c: &Chord, key: &str, ctrl: bool, alt: bool, shift: bool) -> bool {
        let one = key.chars().count() == 1;
        let same = if c.ctrl && one { c.key.eq_ignore_ascii_case(key) } else { c.key == key };
        same && c.ctrl == ctrl && c.alt == alt && (one || c.shift == shift)
    }

    pub fn is_prefix(&self, key: &str, ctrl: bool, alt: bool, shift: bool) -> bool {
        Self::matches(&self.bound.prefix, key, ctrl, alt, shift)
    }

    /// The prefix, as the key it is.
    pub fn prefix_key(&self) -> &Chord {
        &self.bound.prefix
    }

    /// The prefix as a person reads it (`ctrl+b`).
    pub fn prefix(&self) -> String {
        shown(&self.bound.prefix)
    }

    /// What the key pressed after the prefix does.
    pub fn after_prefix(&self, key: &str, ctrl: bool, alt: bool, shift: bool) -> Option<Action> {
        if self.is_prefix(key, ctrl, alt, shift) {
            return Some(Action::SendPrefix);
        }
        let hit = |c: &Chord| Self::matches(c, key, ctrl, alt, shift);
        if let Some(n) = self.bound.boxes.iter().position(hit) {
            return Some(Action::Box(n + 1));
        }
        if let Some(n) = self.bound.tabs.iter().position(hit) {
            return Some(Action::Tab(n + 1));
        }
        let (name, _) = self.bound.entries.iter().find(|(_, chords)| chords.iter().any(hit))?;
        ENTRIES.iter().find(|(n, _, _)| n == name).map(|(_, a, _)| *a)
    }

    /// The keys of one action, as written after the prefix (`v %`); empty when it has none.
    fn keys_of(&self, action: Action) -> String {
        let name = ENTRIES.iter().find(|(_, a, _)| *a == action).map(|(n, _, _)| *n).unwrap_or_default();
        let chords = self.bound.entries.iter().find(|(n, _)| *n == name).map(|(_, c)| c.clone()).unwrap_or_default();
        chords.iter().map(shown).collect::<Vec<_>>().join(" ")
    }

    /// How a person does `action`, for a sentence: `ctrl+b X`; `None` when no key does it.
    pub fn says(&self, action: Action) -> String {
        let first = self.keys_of(action).split(' ').next().unwrap_or_default().to_string();
        if first.is_empty() {
            return "(no key; see the keys table in settings.json)".to_string();
        }
        format!("{} {first}", self.prefix())
    }

    /// Every key after the prefix and what it does, in the order a person needs them.
    pub fn help(&self) -> Vec<(String, &'static str)> {
        let digits = |list: &[Chord]| match (list.first(), list.last()) {
            (Some(a), Some(b)) => format!("{}-{}", shown(a), b.key),
            _ => String::new(),
        };
        let mut out: Vec<(String, &'static str)> = vec![];
        for (_, action, words) in ENTRIES {
            out.push((self.keys_of(action), words));
            if action == Action::PreviousTab {
                out.push((digits(&self.bound.tabs), "the tab with that number"));
            }
            if action == Action::Navigate {
                out.push((digits(&self.bound.boxes), "the box with that number, what needs you first (blocked first)"));
            }
        }
        out.push((self.prefix(), "send the prefix itself to the program"));
        out.retain(|(keys, _)| !keys.is_empty());
        out
    }

    /// The keys the foot shows while nothing is pressed: enough to start with.
    pub fn hints(&self) -> Vec<(String, &'static str)> {
        HINTS.iter().filter_map(|(a, word)| self.keys_of(*a).split(' ').next().filter(|k| !k.is_empty()).map(|k| (k.to_string(), *word))).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keys_after_the_prefix_are_herdrs_by_default() {
        let k = Keymap::default();
        let after = |key: &str| k.after_prefix(key, false, false, false);
        assert!(k.is_prefix("b", true, false, false) && !k.is_prefix("b", false, false, false));
        assert_eq!((after("c"), after("v"), after("%"), after("-")), (Some(Action::NewTab), Some(Action::SplitRight), Some(Action::SplitRight), Some(Action::SplitDown)));
        assert_eq!((after("n"), after("p"), after("w"), after("q"), after("?")), (Some(Action::NextTab), Some(Action::PreviousTab), Some(Action::Navigate), Some(Action::Detach), Some(Action::Help)));
        assert_eq!((after("3"), after("0"), after("ArrowLeft"), after("j")), (Some(Action::Box(3)), None, Some(Action::Focus(Way::Left)), Some(Action::Focus(Way::Down))));
        assert_eq!(k.after_prefix("2", false, true, false), Some(Action::Tab(2)), "alt and a digit: that tab");
        assert_eq!((k.after_prefix("b", true, false, false), after("b"), after("y"), after("[")), (Some(Action::SendPrefix), Some(Action::FoldSidebar), None, Some(Action::CopyMode)));
        assert_eq!((after("PageUp"), after("PageDown"), after("X"), after("x")), (Some(Action::Scroll(true)), Some(Action::Scroll(false)), Some(Action::EndTerminal), Some(Action::ClosePane)));
        assert_eq!(k.hints().iter().map(|(key, w)| format!("{key} {w}")).collect::<Vec<_>>().join("  "), "c tab  v split right  - split down  w boxes  z zoom  ? help  q detach");
        assert_eq!((k.prefix(), k.says(Action::EndTerminal)), ("ctrl+b".to_string(), "ctrl+b X".to_string()));
        let help = k.help();
        assert!(help.contains(&("v %".into(), "split to the right, with a shell in the new pane")) && help.contains(&("← h".into(), "move to the pane on the left")));
        assert!(help.iter().any(|(keys, words)| keys == "1-9" && words.contains("blocked first")) && help.iter().any(|(keys, _)| keys == "alt+1-9"));
    }

    #[test]
    fn the_owners_keys_replace_the_defaults_and_the_help_says_them() {
        let keys = Keys { prefix: "ctrl+a".into(), split_right: "|".into(), boxes_by_number: "alt+N".into(), tabs_by_number: "N".into(), ..Default::default() };
        let k = Keymap::new(&keys).unwrap();
        assert!(k.is_prefix("a", true, false, false) && !k.is_prefix("b", true, false, false));
        assert_eq!((k.after_prefix("|", false, false, false), k.after_prefix("v", false, false, false)), (Some(Action::SplitRight), None));
        assert_eq!((k.after_prefix("4", false, false, false), k.after_prefix("4", false, true, false)), (Some(Action::Tab(4)), Some(Action::Box(4))));
        assert_eq!(k.after_prefix("a", true, false, false), Some(Action::SendPrefix), "the prefix twice is the prefix itself");
        assert!(k.help().contains(&("|".into(), "split to the right, with a shell in the new pane")));
        assert_eq!(k.hints()[1], ("|".to_string(), "split right"));
        assert!(Keymap::new(&Keys { zoom: "c".into(), ..Default::default() }).is_err());
        let none = Keymap::new(&Keys { detach: String::new(), ..Default::default() }).unwrap();
        assert!(none.says(Action::Detach).contains("no key") && !none.hints().iter().any(|(_, w)| *w == "detach"));
    }
}
