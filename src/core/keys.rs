//! # Keys: which key does what in `askk terminal`, as the owner wrote it
//!
//! The table `keys` in `settings.json` (`core/settings.rs`). Each entry names one thing a
//! person does with the panes and the keys that do it, after the prefix; several keys are
//! written with a space between them. A key is a letter or sign as it is typed (`c`, `%`,
//! `X`), or a name (`Enter`, `Escape`, `Tab`, `Space`, `PageUp`, `PageDown`, `Home`, `End`,
//! `Left`, `Right`, `Up`, `Down`, `F1`..`F12`), with `ctrl+`, `alt+` or `shift+` before it.
//!
//! ```json
//! "keys": {"prefix": "ctrl+b", "split_right": "v %", "boxes_by_number": "N", "tabs_by_number": "alt+N"}
//! ```
//!
//! `boxes_by_number` and `tabs_by_number` are written with `N` for the digits 1 to 9: `N` is
//! the digit itself, `alt+N` the digit held with alt; empty turns them off. A key left out
//! keeps its default (what herdr and tmux use); an entry that is not here, a key that is not
//! a key, or one key for two things is refused in a sentence, and the keys in force are kept.
//! What each entry *does* is the UI's (`ui/features/terminals.rs`): the core only keeps the
//! table and says whether it can be read.
use serde::{Deserialize, Serialize};

/// The keys of `askk terminal`, as written: every value is one or more keys, space between.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Keys {
    pub prefix: String,
    pub new_tab: String,
    pub split_right: String,
    pub split_down: String,
    pub next_tab: String,
    pub previous_tab: String,
    pub sidebar: String,
    pub focus_left: String,
    pub focus_right: String,
    pub focus_up: String,
    pub focus_down: String,
    pub zoom: String,
    pub scroll_up: String,
    pub scroll_down: String,
    pub copy_mode: String,
    pub close_pane: String,
    pub end_terminal: String,
    pub fold_sidebar: String,
    pub help: String,
    pub detach: String,
    pub menu: String,
    pub rename_tab: String,
    pub rename_pane: String,
    pub boxes_by_number: String,
    pub tabs_by_number: String,
}

impl Default for Keys {
    fn default() -> Self {
        let k = |s: &str| s.to_string();
        Keys {
            prefix: k("ctrl+b"),
            new_tab: k("c"),
            split_right: k("v %"),
            split_down: k("- \""),
            next_tab: k("n"),
            previous_tab: k("p"),
            sidebar: k("w"),
            focus_left: k("Left h"),
            focus_right: k("Right l"),
            focus_up: k("Up k"),
            focus_down: k("Down j"),
            zoom: k("z"),
            scroll_up: k("PageUp"),
            scroll_down: k("PageDown"),
            copy_mode: k("["),
            close_pane: k("x"),
            end_terminal: k("X"),
            fold_sidebar: k("b"),
            help: k("?"),
            detach: k("q d"),
            menu: k("m"),
            rename_tab: k("T"),
            rename_pane: k("P"),
            boxes_by_number: k("N"),
            tabs_by_number: k("alt+N"),
        }
    }
}

/// One key with what is held with it. `key` is named as a browser names it (`b`, `Enter`,
/// `ArrowLeft`); a letter's shift is its capital, so `shift` is only for named keys.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Chord {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// The names a key may be written by, and the browser's name for it.
const NAMES: [(&str, &str); 18] = [
    ("enter", "Enter"),
    ("return", "Enter"),
    ("escape", "Escape"),
    ("esc", "Escape"),
    ("tab", "Tab"),
    ("space", " "),
    ("backspace", "Backspace"),
    ("pageup", "PageUp"),
    ("pgup", "PageUp"),
    ("pagedown", "PageDown"),
    ("pgdn", "PageDown"),
    ("home", "Home"),
    ("end", "End"),
    ("left", "ArrowLeft"),
    ("right", "ArrowRight"),
    ("up", "ArrowUp"),
    ("down", "ArrowDown"),
    ("delete", "Delete"),
];

/// `ctrl+b`, `%`, `alt+Left` as a [`Chord`], or why it is not a key.
pub fn chord(written: &str) -> Result<Chord, String> {
    let w = written.trim();
    // The last part is the key; a key that is itself `+` is written `ctrl++`.
    let (mods, key) = match w.strip_suffix("++") {
        Some(m) => (m, "+"),
        None if w == "+" => ("", "+"),
        None => w.rsplit_once('+').unwrap_or(("", w)),
    };
    let mut c = Chord::default();
    for m in mods.split('+').filter(|m| !m.is_empty()) {
        match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => c.ctrl = true,
            "alt" | "option" | "meta" => c.alt = true,
            "shift" => c.shift = true,
            other => return Err(format!("'{written}': '{other}' is not a key held with another (ctrl, alt or shift)")),
        }
    }
    let lower = key.to_ascii_lowercase();
    c.key = if key.chars().count() == 1 {
        key.to_string()
    } else if let Some((_, name)) = NAMES.iter().find(|(n, _)| *n == lower.trim_start_matches("arrow")) {
        name.to_string()
    } else if lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=12).contains(&n)) {
        key.to_ascii_uppercase()
    } else {
        return Err(format!("'{written}' is not a key: a letter or sign, or Enter, Escape, Tab, Space, PageUp, PageDown, Home, End, Left, Right, Up, Down, F1 to F12, with ctrl+, alt+ or shift+ before it"));
    };
    // Held with ctrl, a letter is the same letter whatever its case.
    if c.ctrl && c.key.chars().count() == 1 {
        c.key = c.key.to_ascii_lowercase();
    }
    Ok(c)
}

/// The digits 1 to 9 as `pattern` writes them (`N`, `alt+N`); none when it is empty.
pub fn digits(pattern: &str) -> Result<Vec<Chord>, String> {
    let p = pattern.trim();
    if p.is_empty() {
        return Ok(vec![]);
    }
    if !p.ends_with('N') || p.matches('N').count() != 1 {
        return Err(format!("'{pattern}' stands for the digits 1 to 9 with N, as `N` or `alt+N`"));
    }
    (1..=9).map(|n| chord(&p.replace('N', &n.to_string()))).collect()
}

impl Keys {
    /// Every entry but the prefix and the digits: its name, and what is written for it.
    pub fn entries(&self) -> [(&'static str, &str); 22] {
        [
            ("new_tab", &self.new_tab),
            ("split_right", &self.split_right),
            ("split_down", &self.split_down),
            ("next_tab", &self.next_tab),
            ("previous_tab", &self.previous_tab),
            ("sidebar", &self.sidebar),
            ("focus_left", &self.focus_left),
            ("focus_right", &self.focus_right),
            ("focus_up", &self.focus_up),
            ("focus_down", &self.focus_down),
            ("zoom", &self.zoom),
            ("scroll_up", &self.scroll_up),
            ("scroll_down", &self.scroll_down),
            ("copy_mode", &self.copy_mode),
            ("close_pane", &self.close_pane),
            ("end_terminal", &self.end_terminal),
            ("fold_sidebar", &self.fold_sidebar),
            ("help", &self.help),
            ("detach", &self.detach),
            ("menu", &self.menu),
            ("rename_tab", &self.rename_tab),
            ("rename_pane", &self.rename_pane),
        ]
    }

    /// The table read: each entry with its keys, the prefix, and the digits. Refused, in a
    /// sentence that names the entry, when a key is not a key or one key does two things.
    pub fn bound(&self) -> Result<Bound, String> {
        let at = |entry: &str, e: String| format!("`keys.{entry}`: {e}");
        let prefix = chord(&self.prefix).map_err(|e| at("prefix", e))?;
        let mut entries = vec![];
        let mut taken: Vec<(Chord, &str)> = vec![];
        for (name, written) in self.entries() {
            let chords: Vec<Chord> = written.split_whitespace().map(chord).collect::<Result<_, _>>().map_err(|e| at(name, e))?;
            for c in &chords {
                if let Some((_, other)) = taken.iter().find(|(t, _)| t == c) {
                    return Err(at(name, format!("'{}' already does `{other}`: one key does one thing", written.split_whitespace().find(|w| chord(w).as_ref() == Ok(c)).unwrap_or_default())));
                }
                taken.push((c.clone(), name));
            }
            entries.push((name, chords));
        }
        let boxes = digits(&self.boxes_by_number).map_err(|e| at("boxes_by_number", e))?;
        let tabs = digits(&self.tabs_by_number).map_err(|e| at("tabs_by_number", e))?;
        for (name, list) in [("boxes_by_number", &boxes), ("tabs_by_number", &tabs)] {
            if let Some((_, other)) = list.iter().find_map(|c| taken.iter().find(|(t, _)| t == c)) {
                return Err(at(name, format!("its digits are already taken by `{other}`")));
            }
        }
        if !boxes.is_empty() && boxes == tabs {
            return Err(at("tabs_by_number", "the same digits as `boxes_by_number`: hold another key with them (alt+N)".into()));
        }
        Ok(Bound { prefix, entries, boxes, tabs })
    }
}

/// The keys table read ([`Keys::bound`]).
#[derive(Clone, Debug, PartialEq)]
pub struct Bound {
    pub prefix: Chord,
    pub entries: Vec<(&'static str, Vec<Chord>)>,
    /// The digits 1 to 9 for the boxes, and for the tabs; empty when turned off.
    pub boxes: Vec<Chord>,
    pub tabs: Vec<Chord>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_written_as_a_person_says_it() {
        assert_eq!(chord("ctrl+b").unwrap(), Chord { key: "b".into(), ctrl: true, ..Default::default() });
        assert_eq!(chord("ctrl+B").unwrap().key, "b", "held with ctrl, a letter has no case");
        assert_eq!(chord("X").unwrap(), Chord { key: "X".into(), ..Default::default() });
        assert_eq!(chord("alt+Left").unwrap(), Chord { key: "ArrowLeft".into(), alt: true, ..Default::default() });
        assert_eq!((chord("pgup").unwrap().key, chord("Esc").unwrap().key, chord("space").unwrap().key, chord("f5").unwrap().key), ("PageUp".into(), "Escape".into(), " ".into(), "F5".into()));
        assert_eq!((chord("+").unwrap().key, chord("ctrl++").unwrap()), ("+".into(), Chord { key: "+".into(), ctrl: true, ..Default::default() }));
        assert!(chord("hyper+b").unwrap_err().contains("'hyper' is not a key held with another"));
        assert!(chord("banana").unwrap_err().contains("'banana' is not a key"));
        assert_eq!(digits("alt+N").unwrap()[2], Chord { key: "3".into(), alt: true, ..Default::default() });
        assert!(digits("").unwrap().is_empty() && digits("M").is_err());
    }

    #[test]
    fn the_default_table_is_read_and_a_wrong_one_names_its_entry() {
        let b = Keys::default().bound().unwrap();
        assert_eq!((b.prefix.key.as_str(), b.entries.len(), b.boxes.len(), b.tabs.len()), ("b", 22, 9, 9));
        let twice = Keys { zoom: "c".into(), ..Default::default() }.bound().unwrap_err();
        assert_eq!(twice, "`keys.zoom`: 'c' already does `new_tab`: one key does one thing");
        assert!(Keys { help: "ctrl+?+".into(), ..Default::default() }.bound().unwrap_err().starts_with("`keys.help`: "));
        assert!(Keys { new_tab: "1".into(), ..Default::default() }.bound().unwrap_err().contains("`keys.boxes_by_number`: its digits are already taken by `new_tab`"));
        assert!(Keys { tabs_by_number: "N".into(), ..Default::default() }.bound().is_err());
        let off = Keys { boxes_by_number: String::new(), tabs_by_number: "N".into(), ..Default::default() }.bound().unwrap();
        assert!(off.boxes.is_empty() && off.tabs[0].key == "1", "the digits can go to the tabs instead");
    }
}
