//! # Terminals: what a person does with a box that is a screen, the same in every UI
//!
//! The service holds the terminals and gives each as a screen (`core/screen.rs`); a window
//! draws the screen and says what was typed (`terminal_type`). Written here once, so a page
//! and the terminal UI agree:
//!
//! | question | answer |
//! | --- | --- |
//! | what does a box hold, and so what does its pane show? | [`inside`]: a screen, an engine's conversation, an agent's session |
//! | what does a key send? | [`typed`]: the bytes a terminal sends for it, by the key's name as a browser says it |
//! | what is pasted text? | [`pasted`]: the text, with every line end as Enter |
//! | which keys work the panes? | `keymap.rs`: the keys herdr and tmux use, or the owner's |
//! | how does an ended program read? | [`ended`] |
//!
//! A program that draws its own screen asks for arrow keys in another form. No window needs
//! to know: every window sends the form here, and the service turns it (`host/terminals.rs`).
// A page comes to ask these too; until it does, a build without the terminal UI leaves them unused.
#![cfg_attr(not(feature = "server"), allow(dead_code))]

/// What a box holds, told from its id (`core/boxes.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inside {
    /// A terminal the service holds: its screen, and typing goes to its program.
    Terminal(String),
    /// An engine: its conversation and its last run, and a line to ask it.
    Engine(String),
    /// A session with another agent: its turns, and a line to prompt it.
    Session(u64),
    /// A kind of box this window does not know how to show.
    Other,
}

pub fn inside(box_id: &str) -> Inside {
    match box_id.split_once(':') {
        Some(("terminal", id)) if !id.is_empty() => Inside::Terminal(id.to_string()),
        Some(("engine", path)) if !path.is_empty() => Inside::Engine(path.to_string()),
        Some(("session", id)) => id.parse().map(Inside::Session).unwrap_or(Inside::Other),
        _ => Inside::Other,
    }
}

/// The id of the box that is the terminal `id`.
pub fn terminal_box(id: &str) -> String {
    format!("terminal:{id}")
}

/// The id of the box that is the engine at `path`.
pub fn engine_box(path: &str) -> String {
    format!("engine:{path}")
}

/// The number a terminal puts after a key's sequence for the keys held with it.
fn held(ctrl: bool, alt: bool, shift: bool) -> u8 {
    1 + u8::from(shift) + 2 * u8::from(alt) + 4 * u8::from(ctrl)
}

/// What a terminal sends for a key. `key` is the key's name as a browser says it
/// (`KeyboardEvent.key`): the letter itself, or `Enter`, `Backspace`, `Tab`, `Escape`,
/// `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`,
/// `Delete`, `Insert`, `F1`..`F12`. A key that sends nothing by itself (`Shift`) is `None`.
pub fn typed(key: &str, ctrl: bool, alt: bool, shift: bool) -> Option<String> {
    let esc = |rest: &str| Some(format!("\x1b{rest}"));
    // An arrow, Home or End: plain, or with the number for the keys held with it.
    let moved = |end: char| if (ctrl, alt, shift) == (false, false, false) { esc(&format!("[{end}")) } else { esc(&format!("[1;{}{end}", held(ctrl, alt, shift))) };
    let numbered = |n: u8| if (ctrl, alt, shift) == (false, false, false) { esc(&format!("[{n}~")) } else { esc(&format!("[{n};{}~", held(ctrl, alt, shift))) };
    let mut letters = key.chars();
    if let (Some(c), None) = (letters.next(), letters.next()) {
        let sent = match c {
            // Held with Ctrl, a letter is its place in the alphabet, and a few signs have one too.
            'a'..='z' | 'A'..='Z' if ctrl => char::from(c.to_ascii_uppercase() as u8 & 0x1f).to_string(),
            ' ' | '@' | '2' if ctrl => "\0".to_string(),
            '[' | '3' if ctrl => "\x1b".to_string(),
            '\\' | '4' if ctrl => "\x1c".to_string(),
            ']' | '5' if ctrl => "\x1d".to_string(),
            '^' | '6' if ctrl => "\x1e".to_string(),
            '_' | '-' | '7' | '/' if ctrl => "\x1f".to_string(),
            '?' | '8' if ctrl => "\x7f".to_string(),
            c => c.to_string(),
        };
        return Some(if alt { format!("\x1b{sent}") } else { sent });
    }
    let sent = match key {
        "Enter" => Some("\r".to_string()),
        "Backspace" => Some(if ctrl { "\x08" } else { "\x7f" }.to_string()),
        "Tab" => Some(if shift { "\x1b[Z" } else { "\t" }.to_string()),
        "Escape" => Some("\x1b".to_string()),
        "ArrowUp" => moved('A'),
        "ArrowDown" => moved('B'),
        "ArrowRight" => moved('C'),
        "ArrowLeft" => moved('D'),
        "Home" => moved('H'),
        "End" => moved('F'),
        "Insert" => numbered(2),
        "Delete" => numbered(3),
        "PageUp" => numbered(5),
        "PageDown" => numbered(6),
        "F1" => esc("OP"),
        "F2" => esc("OQ"),
        "F3" => esc("OR"),
        "F4" => esc("OS"),
        "F5" => numbered(15),
        "F6" => numbered(17),
        "F7" => numbered(18),
        "F8" => numbered(19),
        "F9" => numbered(20),
        "F10" => numbered(21),
        "F11" => numbered(23),
        "F12" => numbered(24),
        _ => None,
    }?;
    // Alt before a key that is one byte (Enter, Backspace, Tab, Escape) is Escape before it.
    Some(if alt && !sent.starts_with("\x1b[") && !sent.starts_with("\x1bO") { format!("\x1b{sent}") } else { sent })
}

/// Pasted text as typing: a terminal's Enter is `\r`, whatever the text's line ends were. A
/// program that asked for pasted text to be marked (bracketed paste, `core/screen.rs`) gets
/// it between the two marks, so it can tell a paste from typing; a mark inside the text is
/// taken out, so a paste cannot end itself early.
pub fn pasted(text: &str, bracketed: bool) -> String {
    let text = text.replace("\r\n", "\r").replace('\n', "\r");
    if !bracketed {
        return text;
    }
    format!("\x1b[200~{}\x1b[201~", text.replace("\x1b[200~", "").replace("\x1b[201~", ""))
}

pub use super::keymap::{Action, Keymap, Way};

/// How an ended program reads, as the end of the sentence "its program ...".
pub fn ended(exit: Option<i32>) -> String {
    match exit {
        Some(0) => "ended well (0)".to_string(),
        Some(code) => format!("ended with {code}"),
        None => "ended without saying how".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_box_says_by_its_id_what_its_pane_shows() {
        assert_eq!(inside("terminal:3"), Inside::Terminal("3".into()));
        assert_eq!(inside("engine:askk/developer"), Inside::Engine("askk/developer".into()));
        assert_eq!(inside("session:12"), Inside::Session(12));
        for other in ["", "terminal:", "session:x", "room:1", "engine"] {
            assert_eq!(inside(other), Inside::Other, "{other}");
        }
        assert_eq!(inside(&terminal_box("7")), Inside::Terminal("7".into()));
        assert_eq!(inside(&engine_box("askk/developer")), Inside::Engine("askk/developer".into()));
    }

    #[test]
    fn a_key_sends_what_a_terminal_sends_for_it() {
        let plain = |key: &str| typed(key, false, false, false);
        assert_eq!(plain("a").as_deref(), Some("a"));
        assert_eq!(plain("é").as_deref(), Some("é"));
        assert_eq!((plain("Enter").as_deref(), plain("Backspace").as_deref(), plain("Tab").as_deref(), plain("Escape").as_deref()), (Some("\r"), Some("\x7f"), Some("\t"), Some("\x1b")));
        assert_eq!((plain("ArrowUp").as_deref(), plain("ArrowLeft").as_deref(), plain("Home").as_deref(), plain("Delete").as_deref()), (Some("\x1b[A"), Some("\x1b[D"), Some("\x1b[H"), Some("\x1b[3~")));
        assert_eq!((plain("F1").as_deref(), plain("F5").as_deref(), plain("F12").as_deref()), (Some("\x1bOP"), Some("\x1b[15~"), Some("\x1b[24~")));
        // Held with Ctrl, Alt, Shift.
        assert_eq!(typed("c", true, false, false).as_deref(), Some("\x03"), "ctrl+c interrupts");
        assert_eq!(typed("D", true, false, true).as_deref(), Some("\x04"));
        assert_eq!(typed(" ", true, false, false).as_deref(), Some("\0"));
        assert_eq!(typed("f", false, true, false).as_deref(), Some("\x1bf"), "alt is Escape first");
        assert_eq!(typed("Backspace", false, true, false).as_deref(), Some("\x1b\x7f"));
        assert_eq!(typed("Tab", false, false, true).as_deref(), Some("\x1b[Z"));
        assert_eq!(typed("ArrowRight", true, false, false).as_deref(), Some("\x1b[1;5C"), "ctrl+right jumps a word");
        assert_eq!(typed("ArrowUp", false, false, true).as_deref(), Some("\x1b[1;2A"));
        // Keys that send nothing by themselves.
        for none in ["Shift", "Control", "Alt", "Meta", "CapsLock", ""] {
            assert_eq!(plain(none), None, "{none}");
        }
        assert_eq!(pasted("one\r\ntwo\nthree", false), "one\rtwo\rthree");
        assert_eq!(pasted("a\nb\x1b[201~rm", true), "\x1b[200~a\rbrm\x1b[201~", "marked, and no mark inside");
    }

    #[test]
    fn an_ended_program_reads_as_how_it_ended() {
        assert_eq!((ended(Some(0)), ended(Some(2)), ended(None)), ("ended well (0)".to_string(), "ended with 2".to_string(), "ended without saying how".to_string()));
    }
}
