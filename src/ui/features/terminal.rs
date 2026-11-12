//! # Terminal: a screen as cells to draw, and typing as the bytes a program reads
//!
//! The service holds a terminal and gives its screen as an object (`core/screen.rs`). Two
//! things about it are the same in every UI, so they are said here once:
//!
//! - **What to draw** ([`rows`]): every row of the screen as cells that share a look, with
//!   the cell under the cursor on its own. A colour is one of three things ([`Ink`]): the
//!   terminal's own, one of the 16 base colours (a UI has its own palette for those, so they
//!   suit light and dark), or an exact colour (the 240 others of the 256, and `#rrggbb`).
//! - **What a key sends** ([`keys`]): text as it is, Enter as `\r`, Backspace as `\x7f`,
//!   arrows as their escape sequences, Control with a letter as its control byte.
#![cfg_attr(feature = "local", allow(dead_code))]
use crate::core::screen::{Line, Screen, Span};

/// A colour of a cell.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Ink {
    /// The terminal's own ink (for text) or ground (behind it).
    #[default]
    Own,
    /// The terminal's other own colour: its ground used as ink, or its ink as ground.
    Other,
    /// One of the 16 base colours, `0..=15`.
    Base(u8),
    /// An exact colour, as `#rrggbb`.
    Exact(String),
}

/// The exact colour of one of the 256 indexed colours from 16 up: the 6×6×6 cube, then the
/// 24 greys.
fn indexed(n: u8) -> String {
    const STEPS: [u8; 6] = [0, 95, 135, 175, 215, 255];
    if n >= 232 {
        let v = 8 + 10 * (n - 232);
        return format!("#{v:02x}{v:02x}{v:02x}");
    }
    let n = n - 16;
    format!("#{:02x}{:02x}{:02x}", STEPS[(n / 36) as usize], STEPS[(n / 6 % 6) as usize], STEPS[(n % 6) as usize])
}

/// Read a screen's colour: `""`, `"0"`..`"255"`, or `"#rrggbb"`. Anything else is the
/// terminal's own, so a colour this build does not know never breaks a row.
pub fn ink(colour: &str) -> Ink {
    if let Some(hex) = colour.strip_prefix('#') {
        return if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) { Ink::Exact(colour.to_ascii_lowercase()) } else { Ink::Own };
    }
    match colour.parse::<u8>() {
        Ok(n) if n < 16 => Ink::Base(n),
        Ok(n) => Ink::Exact(indexed(n)),
        Err(_) => Ink::Own,
    }
}

/// A run of text in one look, ready to draw.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Cell {
    pub text: String,
    pub fg: Ink,
    pub bg: Ink,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    /// The cursor is on this cell (it is then one character wide).
    pub cursor: bool,
}

fn cell(s: &Span, text: String, cursor: bool) -> Cell {
    let (mut fg, mut bg) = (ink(&s.fg), ink(&s.bg));
    if s.inverse {
        // Ink and ground change places; an own colour becomes the other own colour.
        let other = |i: Ink| if i == Ink::Own { Ink::Other } else { i };
        (fg, bg) = (other(bg), other(fg));
    }
    Cell { text, fg, bg, bold: s.bold, dim: s.dim, italic: s.italic, underline: s.underline, cursor }
}

/// One row as cells; `cursor` is the column the cursor is at, when it is in this row.
fn row(line: &Line, cursor: Option<usize>) -> Vec<Cell> {
    let Some(col) = cursor else {
        return line.spans.iter().map(|s| cell(s, s.text.clone(), false)).collect();
    };
    let mut out = vec![];
    let mut at = 0;
    let mut placed = false;
    for s in &line.spans {
        let n = s.text.chars().count();
        if placed || col >= at + n {
            out.push(cell(s, s.text.clone(), false));
        } else {
            // The cursor is in this span: what is before it, the one character under it, the rest.
            let chars: Vec<char> = s.text.chars().collect();
            let k = col - at;
            for (part, on) in [(&chars[..k], false), (&chars[k..=k], true), (&chars[k + 1..], false)] {
                if !part.is_empty() {
                    out.push(cell(s, part.iter().collect(), on));
                }
            }
            placed = true;
        }
        at += n;
    }
    if !placed {
        // Past the end of what is written: blanks up to it, then the cursor on a blank.
        if col > at {
            out.push(Cell { text: " ".repeat(col - at), ..Default::default() });
        }
        out.push(Cell { text: " ".into(), cursor: true, ..Default::default() });
    }
    out
}

/// Every row of the screen, top to bottom, as cells: exactly `screen.rows` of them (rows
/// with nothing on them are empty). The cursor is shown only while the program runs.
pub fn rows(screen: &Screen) -> Vec<Vec<Cell>> {
    let cursor = screen.cursor.filter(|_| screen.alive).map(|(c, r)| (c as usize, r as usize));
    let empty = Line::default();
    let n = (screen.rows as usize).max(screen.lines.len()).max(cursor.map(|(_, r)| r + 1).unwrap_or(0));
    (0..n).map(|r| row(screen.lines.get(r).unwrap_or(&empty), cursor.filter(|(_, at)| *at == r).map(|(c, _)| c))).collect()
}

/// One line on how a terminal stands: its title while it runs, how it ended once it has.
pub fn standing(screen: &Screen) -> String {
    match (screen.alive, screen.exit) {
        (true, _) if screen.title.is_empty() => "running".into(),
        (true, _) => screen.title.clone(),
        (false, Some(0)) => "ended".into(),
        (false, Some(code)) => format!("ended with code {code}"),
        (false, None) => "ended: the service no longer holds it".into(),
    }
}

/// A key as the window reports it: the key's name (`a`, `Enter`, `ArrowUp`) and what was held.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Typed {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub meta: bool,
    pub shift: bool,
}

/// What a key sends to the program, or `None` when the key is not for it (a key held with
/// Command belongs to the window; Shift+Tab leaves the terminal, so the keyboard alone can
/// always get out of it).
pub fn keys(t: &Typed) -> Option<String> {
    if t.meta {
        return None;
    }
    let esc = |rest: &str| format!("\x1b{rest}");
    let named = match t.key.as_str() {
        "Enter" => Some("\r".to_string()),
        "Backspace" => Some("\x7f".to_string()),
        "Tab" if t.shift => return None,
        "Tab" => Some("\t".to_string()),
        "Escape" => Some("\x1b".to_string()),
        "ArrowUp" => Some(esc("[A")),
        "ArrowDown" => Some(esc("[B")),
        "ArrowRight" => Some(esc("[C")),
        "ArrowLeft" => Some(esc("[D")),
        "Home" => Some(esc("[H")),
        "End" => Some(esc("[F")),
        "Insert" => Some(esc("[2~")),
        "Delete" => Some(esc("[3~")),
        "PageUp" => Some(esc("[5~")),
        "PageDown" => Some(esc("[6~")),
        "F1" => Some(esc("OP")),
        "F2" => Some(esc("OQ")),
        "F3" => Some(esc("OR")),
        "F4" => Some(esc("OS")),
        "F5" => Some(esc("[15~")),
        "F6" => Some(esc("[17~")),
        "F7" => Some(esc("[18~")),
        "F8" => Some(esc("[19~")),
        "F9" => Some(esc("[20~")),
        "F10" => Some(esc("[21~")),
        "F11" => Some(esc("[23~")),
        "F12" => Some(esc("[24~")),
        _ => None,
    };
    if named.is_some() {
        return named;
    }
    // One character: a letter, a digit, a sign, a space. A longer name is a key that types
    // nothing by itself (Shift, Dead, Unidentified).
    let mut chars = t.key.chars();
    let (c, None) = (chars.next()?, chars.next()) else { return None };
    if t.ctrl {
        let byte = match c.to_ascii_lowercase() {
            l @ 'a'..='z' => l as u8 - b'a' + 1,
            ' ' | '@' | '2' => 0,
            '[' => 0x1b,
            '\\' => 0x1c,
            ']' => 0x1d,
            '^' | '6' => 0x1e,
            '_' | '-' => 0x1f,
            '?' | '8' => 0x7f,
            _ => return None,
        };
        return Some((byte as char).to_string());
    }
    Some(if t.alt { format!("\x1b{c}") } else { c.to_string() })
}

/// Made-up screens, to show and to test what draws a terminal without a terminal: a shell
/// with coloured output and a cursor, every colour there is, and a program that ended badly.
pub fn samples() -> Vec<(&'static str, Screen)> {
    let s = |text: &str| Span::plain(text);
    let c = |text: &str, fg: &str| Span { text: text.into(), fg: fg.into(), ..Default::default() };
    let line = |spans: Vec<Span>| Line { spans };
    let shell = Screen {
        cols: 64,
        rows: 9,
        lines: vec![
            line(vec![c("owner@askk", "2"), s(":"), c("~/askk", "4"), s("$ ls")]),
            line(vec![c("assets", "12"), s("  "), c("src", "12"), s("  Cargo.toml  "), c("run.sh", "10"), s("  "), Span { text: "README.md".into(), underline: true, ..Default::default() }]),
            line(vec![c("owner@askk", "2"), s(":"), c("~/askk", "4"), s("$ cargo test")]),
            line(vec![Span { text: "   Compiling".into(), fg: "2".into(), bold: true, ..Default::default() }, s(" askk v0.1.0")]),
            line(vec![s("test a_box_opens_in_place ... "), c("ok", "2")]),
            line(vec![s("test a_queue_keeps_its_order ... "), c("FAILED", "1")]),
            line(vec![Span { text: " note ".into(), inverse: true, ..Default::default() }, Span { text: " dim and slanted".into(), dim: true, italic: true, ..Default::default() }]),
            line(vec![c("owner@askk", "2"), s(":"), c("~/askk", "4"), s("$ git sta")]),
        ],
        cursor: Some((26, 7)),
        title: "zsh".into(),
        alive: true,
        exit: None,
    };
    let block = |n: usize, bg: String| Span { text: " ".repeat(n), bg, ..Default::default() };
    let colours = Screen {
        cols: 64,
        rows: 7,
        lines: vec![
            line((0..16).map(|n| Span { text: format!(" {n} "), fg: if n == 0 || n == 8 { "15".into() } else { "0".into() }, bg: n.to_string(), ..Default::default() }).collect()),
            line((0..16).map(|n| c("Aa ", &n.to_string())).collect()),
            line((16..80).map(|n: u16| block(1, n.to_string())).collect()),
            line((80..144).map(|n: u16| block(1, n.to_string())).collect()),
            line((144..208).map(|n: u16| block(1, n.to_string())).collect()),
            line((208..256).map(|n: u16| block(1, n.to_string())).collect()),
            line((0..64).map(|i: u32| block(1, format!("#{:02x}{:02x}{:02x}", 255 - i * 4, 60 + i * 2, i * 4))).collect()),
        ],
        cursor: None,
        title: "colours".into(),
        alive: true,
        exit: None,
    };
    let ended = Screen {
        cols: 64,
        rows: 4,
        lines: vec![line(vec![s("$ node build.mjs")]), line(vec![c("error", "9"), s(": no such file: build.mjs")])],
        cursor: Some((0, 2)),
        title: "node".into(),
        alive: false,
        exit: Some(1),
    };
    vec![("A shell at work", shell), ("Every colour", colours), ("A program that ended badly", ended)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(key: &str) -> Typed {
        Typed { key: key.into(), ..Default::default() }
    }

    #[test]
    fn a_colour_is_the_terminals_own_a_base_colour_or_an_exact_one() {
        assert_eq!(ink(""), Ink::Own);
        assert_eq!((ink("0"), ink("15")), (Ink::Base(0), Ink::Base(15)));
        assert_eq!(ink("16"), Ink::Exact("#000000".into()));
        assert_eq!(ink("196"), Ink::Exact("#ff0000".into()), "the cube's pure red");
        assert_eq!(ink("231"), Ink::Exact("#ffffff".into()));
        assert_eq!((ink("232"), ink("255")), (Ink::Exact("#080808".into()), Ink::Exact("#eeeeee".into())));
        assert_eq!(ink("#A0b1C2"), Ink::Exact("#a0b1c2".into()));
        for bad in ["#fff", "#gggggg", "256", "red", "-1", "#a0b1c2;x"] {
            assert_eq!(ink(bad), Ink::Own, "{bad}");
        }
    }

    #[test]
    fn a_screen_is_rows_of_cells_with_the_cursor_on_one_character() {
        let (_, screen) = samples().remove(0);
        let rows = rows(&screen);
        assert_eq!(rows.len(), 9, "as many rows as the screen has, the empty one too");
        assert!(rows[8].is_empty());
        let text = |r: &Vec<Cell>| r.iter().map(|c| c.text.as_str()).collect::<String>();
        assert_eq!(text(&rows[0]), "owner@askk:~/askk$ ls");
        assert_eq!((rows[0][0].fg.clone(), rows[0][1].fg.clone()), (Ink::Base(2), Ink::Own));
        // The cursor is one blank past the end of the last line.
        let last = &rows[7];
        assert_eq!(text(last), "owner@askk:~/askk$ git sta ");
        assert_eq!(last.iter().filter(|c| c.cursor).count(), 1);
        assert!(last.last().is_some_and(|c| c.cursor && c.text == " "));
        // Ink and ground change places.
        assert_eq!((rows[6][0].fg.clone(), rows[6][0].bg.clone()), (Ink::Other, Ink::Other));
        assert!(rows[6][1].dim && rows[6][1].italic && rows[3][0].bold && rows[1][6].underline);
    }

    #[test]
    fn the_cursor_inside_a_span_cuts_it_in_three_and_a_dead_terminal_has_none() {
        let mut screen = Screen { cols: 10, rows: 2, lines: vec![Line { spans: vec![Span { text: "héllo".into(), fg: "3".into(), ..Default::default() }] }], cursor: Some((1, 0)), alive: true, ..Default::default() };
        let r = rows(&screen);
        let cut: Vec<(&str, bool)> = r[0].iter().map(|c| (c.text.as_str(), c.cursor)).collect();
        assert_eq!(cut, [("h", false), ("é", true), ("llo", false)], "cut on letters, not bytes");
        assert!(r[0].iter().all(|c| c.fg == Ink::Base(3)), "each piece keeps the look");
        screen.cursor = Some((8, 1));
        let r = rows(&screen);
        assert_eq!(r[1].iter().map(|c| (c.text.len(), c.cursor)).collect::<Vec<_>>(), [(8, false), (1, true)], "blanks up to a cursor past the text");
        screen.alive = false;
        screen.exit = Some(1);
        assert!(rows(&screen).iter().flatten().all(|c| !c.cursor));
        assert_eq!(standing(&screen), "ended with code 1");
        screen.exit = Some(0);
        assert_eq!(standing(&screen), "ended");
        let (_, shell) = samples().remove(0);
        assert_eq!(standing(&shell), "zsh");
        for (name, s) in samples() {
            assert!(rows(&s).len() >= s.rows as usize && s.lines.iter().all(|l| l.text().chars().count() <= s.cols as usize), "{name} fits its screen");
        }
    }

    #[test]
    fn typing_is_the_bytes_a_program_reads() {
        assert_eq!(keys(&typed("a")), Some("a".into()));
        assert_eq!(keys(&typed("é")), Some("é".into()));
        assert_eq!(keys(&typed(" ")), Some(" ".into()));
        assert_eq!(keys(&typed("Enter")), Some("\r".into()));
        assert_eq!(keys(&typed("Backspace")), Some("\x7f".into()));
        assert_eq!(keys(&typed("Tab")), Some("\t".into()));
        assert_eq!(keys(&typed("Escape")), Some("\x1b".into()));
        assert_eq!([keys(&typed("ArrowUp")), keys(&typed("ArrowDown")), keys(&typed("ArrowRight")), keys(&typed("ArrowLeft"))], [Some("\x1b[A".into()), Some("\x1b[B".into()), Some("\x1b[C".into()), Some("\x1b[D".into())]);
        assert_eq!(keys(&typed("Delete")), Some("\x1b[3~".into()));
        let ctrl = |key: &str| keys(&Typed { key: key.into(), ctrl: true, ..Default::default() });
        assert_eq!((ctrl("c"), ctrl("C"), ctrl("d"), ctrl("z")), (Some("\x03".into()), Some("\x03".into()), Some("\x04".into()), Some("\x1a".into())));
        assert_eq!((ctrl("["), ctrl(" ")), (Some("\x1b".into()), Some("\0".into())));
        assert_eq!(ctrl("1"), None);
        assert_eq!(keys(&Typed { key: "b".into(), alt: true, ..Default::default() }), Some("\x1bb".into()));
        assert_eq!(keys(&Typed { key: "c".into(), meta: true, ..Default::default() }), None, "Command+C is the window's");
        assert_eq!(keys(&Typed { key: "Tab".into(), shift: true, ..Default::default() }), None, "Shift+Tab leaves the terminal");
        for nothing in ["Shift", "Control", "Dead", "Unidentified", "Process", ""] {
            assert_eq!(keys(&typed(nothing)), None, "{nothing}");
        }
    }
}
