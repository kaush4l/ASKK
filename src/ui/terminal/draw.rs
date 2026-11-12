//! # Draw: the full screen, from values
//!
//! The screen of `askk terminal` on a real terminal, laid out as herdr lays out its own
//! (`docs/components.md`, "The terminal"): a sidebar that folds, a line of tabs, panes with
//! a frame each, and a foot of key hints.
//!
//! ```text
//!  askk · 127.0.0.1:8090        ‹ │ 1 developer  2 sh
//!  boxes                          │┌ ○ developer · engine ──────┐┌ ● sh · sh ─────────────┐
//!  ? reviewer · claude            ││ user: What is 17 * 23?     ││ $ cargo test           │
//!    which folder?                ││ model: 17 * 23 is 391.     ││ running 282 tests      │
//! ▎● sh · sh                      ││ ────────────────────────── ││                        │
//!    running 282 tests            ││ > _                        ││                        │
//!  ○ developer · engine           │└────────────────────────────┘└────────────────────────┘
//!  ctrl+b  then  c tab  v split right  - split down  w boxes  z zoom  ? help  q detach
//! ```
//!
//! Everything here is a function from a [`Picture`] to cells in a buffer: it asks nothing
//! and remembers nothing, so a test draws a picture into a buffer and reads the cells. Where
//! a part is ([`parts`], [`side_row`], [`tab_at`]) is asked by the same functions that draw
//! it, so a click lands on what is shown.
use super::layout::Look;
use crate::core::boxes::SessionBox;
use crate::core::screen::{Screen, Span};
use crate::ui::features::boxes::{Mark, Seen};
use crate::ui::features::terminals::{ended, HELP, HINTS, PREFIX};
use ratatui::prelude::{Buffer, Color, Line, Modifier, Rect, Style, Widget};
use ratatui::widgets::Block;
use unicode_width::UnicodeWidthChar;

/// How wide the sidebar is, open and folded.
pub const SIDE_OPEN: u16 = 32;
pub const SIDE_FOLDED: u16 = 4;
/// The smallest window that is drawn at all.
pub const LEAST: (u16, u16) = (40, 8);
/// Rows above the first box in the sidebar: the head, and the heading.
const SIDE_HEAD: u16 = 2;
/// The longest name a tab shows.
const TAB_NAME: usize = 18;

/// The lines of an engine's or a session's pane carry the same colours as the lines mode.
pub const TALK: Look = Look { styled: true };

/// Where each part of the screen is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Parts {
    pub side: Rect,
    pub tabs: Rect,
    pub main: Rect,
    pub foot: Rect,
}

pub fn parts(area: Rect, side_open: bool) -> Parts {
    let side_w = if side_open { SIDE_OPEN } else { SIDE_FOLDED }.min(area.width / 2);
    let above = area.height.saturating_sub(1);
    Parts {
        side: Rect { width: side_w, height: above, ..area },
        tabs: Rect { x: area.x + side_w, width: area.width - side_w, height: above.min(1), ..area },
        main: Rect { x: area.x + side_w, y: area.y + above.min(1), width: area.width - side_w, height: above.saturating_sub(1) },
        foot: Rect { y: area.y + above, height: area.height - above, ..area },
    }
}

/// The room inside a pane's frame.
pub fn inner(pane: Rect) -> Rect {
    Rect { x: pane.x + 1, y: pane.y + 1, width: pane.width.saturating_sub(2), height: pane.height.saturating_sub(2) }
}

/// How many boxes fit in the sidebar, and the first one drawn so that `chosen` is in view.
fn side_window(side: Rect, open: bool, boxes: usize, chosen: usize) -> (usize, usize) {
    let rows = usize::from(side.height.saturating_sub(SIDE_HEAD));
    let fits = if open { rows / 2 } else { rows }.max(1);
    let first = if boxes <= fits { 0 } else { chosen.saturating_sub(fits - 1).min(boxes - fits) };
    (first, fits)
}

/// The box drawn at row `y` of the sidebar, as its place in the list.
pub fn side_row(side: Rect, open: bool, boxes: usize, chosen: usize, y: u16) -> Option<usize> {
    let (first, fits) = side_window(side, open, boxes, chosen);
    let row = usize::from(y.checked_sub(side.y + SIDE_HEAD)?) / if open { 2 } else { 1 };
    (row < fits && first + row < boxes).then_some(first + row)
}

/// Each tab as it is written in the line of tabs.
fn tab_labels(names: &[String]) -> Vec<String> {
    names.iter().enumerate().map(|(i, n)| format!(" {} {} ", i + 1, n.chars().take(TAB_NAME).collect::<String>())).collect()
}

/// The tab written at column `x` of the line of tabs.
pub fn tab_at(tabs: Rect, names: &[String], x: u16) -> Option<usize> {
    let mut at = tabs.x;
    for (i, label) in tab_labels(names).iter().enumerate() {
        let w = label.chars().count() as u16;
        if x >= at && x < at + w {
            return Some(i);
        }
        at += w;
    }
    None
}

/// What a pane holds.
pub enum Body<'a> {
    /// A terminal's screen, and how many rows up it is looked at (0 = at its end).
    Screen(&'a Screen, u16),
    /// An engine's or a session's lines, and the line being typed. `back`: rows scrolled up.
    Talk { lines: &'a [String], input: &'a str, back: usize },
    /// Nothing to show but a few words.
    Words(Vec<String>),
}

pub struct PaneView<'a> {
    pub at: Rect,
    /// This pane is the one in focus.
    pub focused: bool,
    /// Its box's name and kind, and its mark.
    pub head: String,
    pub mark: Option<Mark>,
    pub zoomed: bool,
    pub body: Body<'a>,
}

/// What the foot says.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Foot {
    /// The keys go to the pane: say how to reach the others.
    Pane,
    /// The prefix was pressed: the next key works the panes.
    Prefix,
    /// The keys go to the sidebar.
    Side,
}

pub struct Picture<'a> {
    /// Who answers: the service's address, or that this terminal is its own host.
    pub host: &'a str,
    /// The boxes in the order they are listed.
    pub boxes: &'a [SessionBox],
    pub seen: &'a Seen,
    pub side_open: bool,
    /// The row the sidebar's own cursor is on.
    pub side_at: usize,
    /// The box the pane in focus shows.
    pub shown: &'a str,
    pub tabs: Vec<String>,
    pub tab: usize,
    pub panes: Vec<PaneView<'a>>,
    pub foot: Foot,
    /// One sentence at the foot: what just happened, or why something could not be done.
    pub note: &'a str,
    pub note_bad: bool,
    pub help: bool,
}

const DIM: Style = Style::new().fg(Color::DarkGray);
const KEY: Style = Style::new().fg(Color::Blue).add_modifier(Modifier::BOLD);
const STRONG: Style = Style::new().add_modifier(Modifier::BOLD);
const HEADING: Style = Style::new().fg(Color::DarkGray).add_modifier(Modifier::BOLD);
const BAD: Style = Style::new().fg(Color::LightRed);

/// A mark's colour, as herdr colours its states; the sign says the same without colour.
pub fn mark_style(mark: Mark) -> Style {
    Style::new().fg(match mark {
        Mark::Blocked => Color::Red,
        Mark::Failed => Color::LightRed,
        Mark::Done => Color::Cyan,
        Mark::Working => Color::Yellow,
        Mark::Idle => Color::Green,
        Mark::Unknown => Color::DarkGray,
    })
}

/// A colour of the screen object (`core/screen.rs`): none, one of 256, or `#rrggbb`.
fn ink(c: &str) -> Option<Color> {
    match c.strip_prefix('#') {
        Some(hex) if hex.len() == 6 => u32::from_str_radix(hex, 16).ok().map(|v| Color::Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)),
        Some(_) => None,
        None => c.parse::<u8>().ok().map(Color::Indexed),
    }
}

/// A span's look as a style.
fn look(s: &Span) -> Style {
    let mut style = Style::new();
    if let Some(fg) = ink(&s.fg) {
        style = style.fg(fg);
    }
    if let Some(bg) = ink(&s.bg) {
        style = style.bg(bg);
    }
    for (on, modifier) in [(s.bold, Modifier::BOLD), (s.dim, Modifier::DIM), (s.italic, Modifier::ITALIC), (s.underline, Modifier::UNDERLINED), (s.inverse, Modifier::REVERSED)] {
        if on {
            style = style.add_modifier(modifier);
        }
    }
    style
}

/// A line of the lines mode, with its colours, as letters each with a style. Only the few
/// codes `layout.rs` writes are read; anything else is left out.
fn letters(line: &str) -> Vec<(char, Style)> {
    let mut out = vec![];
    let mut style = Style::new();
    let mut rest = line.chars();
    while let Some(c) = rest.next() {
        if c != '\x1b' {
            out.push((c, style));
            continue;
        }
        let code: String = rest.by_ref().skip(1).take_while(|c| *c != 'm').collect();
        for n in code.split(';') {
            style = match n {
                "0" | "" => Style::new(),
                "1" => style.add_modifier(Modifier::BOLD),
                "90" => style.fg(Color::DarkGray),
                "34" => style.fg(Color::Blue),
                "32" => style.fg(Color::Green),
                "36" => style.fg(Color::Cyan),
                "33" => style.fg(Color::Yellow),
                "91" => style.fg(Color::LightRed),
                _ => style,
            };
        }
    }
    out
}

/// Styled lines as rows no wider than `width`: a long line goes on in the next row.
fn wrapped(lines: &[String], width: u16) -> Vec<Vec<(char, Style)>> {
    let mut rows = vec![];
    for line in lines {
        let mut row = vec![];
        let mut used = 0;
        for (c, style) in letters(line) {
            let w = c.width().unwrap_or(0) as u16;
            if used + w > width && !row.is_empty() {
                rows.push(std::mem::take(&mut row));
                used = 0;
            }
            row.push((c, style));
            used += w;
        }
        rows.push(row);
    }
    rows
}

/// Write `text` at (`x`, `y`), no further than `end`; the column after it comes back.
fn put(buf: &mut Buffer, x: u16, y: u16, end: u16, text: &str, how: Style) -> u16 {
    if x >= end || !buf.area.contains((x, y).into()) {
        return x;
    }
    buf.set_stringn(x, y, text, usize::from(end - x), how).0
}

fn put_row(buf: &mut Buffer, x: u16, y: u16, end: u16, row: &[(char, Style)]) {
    let mut at = x;
    for (c, style) in row {
        at = put(buf, at, y, end, c.encode_utf8(&mut [0; 4]), *style);
    }
}

/// Pairs of a key and what it does, as the foot writes them: the key bright, the rest dim.
fn put_keys(buf: &mut Buffer, mut x: u16, y: u16, end: u16, pairs: &[(&str, &str)]) -> u16 {
    for (key, does) in pairs {
        x = put(buf, x, y, end, key, KEY);
        x = put(buf, x, y, end, &format!(" {does}  "), DIM);
    }
    x
}

fn sidebar(buf: &mut Buffer, side: Rect, p: &Picture) {
    let end = side.x + side.width.saturating_sub(1);
    // The line between the sidebar and the rest.
    for y in side.y..side.y + side.height {
        put(buf, end, y, end + 1, "│", DIM);
    }
    if !p.side_open {
        put(buf, side.x, side.y, end, " ›", KEY);
    } else {
        let x = put(buf, side.x, side.y, end, " askk", STRONG);
        put(buf, x, side.y, end.saturating_sub(2), &format!(" · {}", p.host), DIM);
        put(buf, end.saturating_sub(2), side.y, end, "‹ ", KEY);
        put(buf, side.x, side.y + 1, end, " boxes", HEADING);
    }
    let (first, fits) = side_window(side, p.side_open, p.boxes.len(), p.side_at);
    for (row, (i, b)) in p.boxes.iter().enumerate().skip(first).take(fits).enumerate() {
        let mark = p.seen.mark(b);
        let chosen = p.foot == Foot::Side && i == p.side_at;
        let y = side.y + SIDE_HEAD + row as u16 * if p.side_open { 2 } else { 1 };
        if chosen {
            buf.set_style(Rect { x: side.x, y, width: side.width.saturating_sub(1), height: 1 }, Style::new().add_modifier(Modifier::REVERSED));
        }
        // The box the pane in focus shows carries a bar at the edge.
        put(buf, side.x, y, end, if b.id == p.shown { "▎" } else { " " }, KEY);
        let x = put(buf, side.x + 1, y, end, mark.sign(), mark_style(mark));
        if !p.side_open {
            continue;
        }
        let x = put(buf, x, y, end, &format!(" {}", b.title), STRONG);
        put(buf, x, y, end, &format!(" · {}", b.kind), DIM);
        let under = if b.last.is_empty() { mark.word().to_string() } else { b.last.clone() };
        put(buf, side.x + 3, y + 1, end, &under, DIM);
    }
    // What does not fit is counted, not dropped in silence.
    let more = p.boxes.len().saturating_sub(first + fits);
    if more > 0 && side.height > 0 {
        let y = side.y + side.height - 1;
        put(buf, side.x, y, end, &if p.side_open { format!(" +{more} more (w, then ↓)") } else { format!("+{more}") }, DIM);
    }
}

fn tab_line(buf: &mut Buffer, tabs: Rect, p: &Picture) {
    let end = tabs.x + tabs.width;
    let mut x = tabs.x;
    for (i, label) in tab_labels(&p.tabs).iter().enumerate() {
        x = put(buf, x, tabs.y, end, label, if i == p.tab { STRONG.add_modifier(Modifier::REVERSED) } else { DIM });
    }
}

/// A terminal's screen inside `room`. A screen taller than the room shows its last rows:
/// that is where a program writes. The cursor's cell comes back when it is in view.
fn screen_body(buf: &mut Buffer, room: Rect, s: &Screen, back: u16) -> Option<(u16, u16)> {
    let skip = s.lines.len().saturating_sub(usize::from(room.height));
    let end = room.x + room.width;
    for (row, line) in s.lines.iter().skip(skip).enumerate() {
        let mut x = room.x;
        for span in &line.spans {
            x = put(buf, x, room.y + row as u16, end, &span.text, look(span));
        }
    }
    if back > 0 && room.height > 0 {
        let y = room.y + room.height - 1;
        put(buf, room.x, y, end, &format!(" ↑ {back} rows up · wheel down or type to return "), KEY.add_modifier(Modifier::REVERSED));
        return None;
    }
    if !s.alive && room.height > 0 {
        let y = room.y + room.height - 1;
        put(buf, room.x, y, end, &format!(" its program {} · {PREFIX} X forgets it ", ended(s.exit)), DIM.add_modifier(Modifier::REVERSED));
        return None;
    }
    let (col, row) = s.cursor?;
    let row = usize::from(row).checked_sub(skip)?;
    (col < room.width && row < usize::from(room.height)).then(|| (room.x + col, room.y + row as u16))
}

/// An engine's or a session's lines, a rule, and the line being typed.
fn talk_body(buf: &mut Buffer, room: Rect, lines: &[String], input: &str, back: usize) -> Option<(u16, u16)> {
    if room.height < 3 || room.width < 4 {
        return None;
    }
    let end = room.x + room.width;
    let rows = wrapped(lines, room.width);
    let fits = usize::from(room.height - 2);
    let last = rows.len().saturating_sub(back.min(rows.len().saturating_sub(fits)));
    for (i, row) in rows[last.saturating_sub(fits)..last].iter().enumerate() {
        put_row(buf, room.x, room.y + i as u16, end, row);
    }
    if lines.is_empty() {
        put(buf, room.x + 1, room.y, end, "Nothing has been said here yet. Type a line below; Enter sends it.", DIM);
    }
    let rule_y = room.y + room.height - 2;
    put(buf, room.x, rule_y, end, &"─".repeat(usize::from(room.width)), DIM);
    if back > 0 && last < rows.len() {
        put(buf, room.x + 1, rule_y, end, &format!(" {} rows below · PageDown ", rows.len() - last), DIM);
    }
    // A line longer than the pane shows its end, where the typing is.
    let y = room.y + room.height - 1;
    let room_for = usize::from(room.width.saturating_sub(3));
    let shown: String = input.chars().rev().take(room_for).collect::<Vec<_>>().into_iter().rev().collect();
    let x = put(buf, room.x, y, end, "> ", KEY);
    let x = put(buf, x, y, end, &shown, Style::new());
    Some((x.min(end.saturating_sub(1)), y))
}

fn pane(buf: &mut Buffer, v: &PaneView) -> Option<(u16, u16)> {
    if v.at.width < 2 || v.at.height < 2 {
        return None;
    }
    let mut title = vec![ratatui::text::Span::raw(" ")];
    if let Some(mark) = v.mark {
        title.push(ratatui::text::Span::styled(format!("{} ", mark.sign()), mark_style(mark)));
    }
    title.push(ratatui::text::Span::styled(format!("{} ", v.head), if v.focused { STRONG } else { DIM }));
    if v.zoomed {
        title.push(ratatui::text::Span::styled("· zoomed ", KEY));
    }
    Block::bordered().border_style(if v.focused { KEY } else { DIM }).title(Line::from(title)).render(v.at, buf);
    let room = inner(v.at);
    let cursor = match &v.body {
        Body::Screen(s, back) => screen_body(buf, room, s, *back),
        Body::Talk { lines, input, back } => talk_body(buf, room, lines, input, *back),
        Body::Words(words) => {
            for (i, line) in words.iter().take(usize::from(room.height)).enumerate() {
                put(buf, room.x + 1, room.y + i as u16, room.x + room.width, line, DIM);
            }
            None
        }
    };
    cursor.filter(|_| v.focused)
}

fn foot(buf: &mut Buffer, at: Rect, p: &Picture) {
    let end = at.x + at.width;
    // What just happened is said first: the keys are known, the sentence is new.
    let start = if p.note.is_empty() { at.x } else { put(buf, at.x, at.y, end, &format!(" {} ·", p.note), if p.note_bad { BAD } else { STRONG }) };
    match p.foot {
        Foot::Pane => {
            let x = put(buf, start, at.y, end, &format!(" {PREFIX}"), KEY);
            let x = put(buf, x, at.y, end, "  then  ", DIM);
            put_keys(buf, x, at.y, end, &HINTS);
        }
        Foot::Prefix => {
            let x = put(buf, start, at.y, end, &format!(" {PREFIX} …"), KEY.add_modifier(Modifier::REVERSED));
            let x = put(buf, x, at.y, end, "  ", DIM);
            put_keys(buf, x, at.y, end, &HINTS.iter().copied().chain([("esc", "nothing")]).collect::<Vec<_>>());
        }
        Foot::Side => {
            put_keys(buf, start + 1, at.y, end, &[("↑ ↓", "choose a box"), ("enter", "show it in the pane"), ("esc", "back to the pane")]);
        }
    }
}

fn help(buf: &mut Buffer, area: Rect) {
    let w = 78.min(area.width.saturating_sub(2));
    let h = (HELP.len() as u16 + 4).min(area.height.saturating_sub(1));
    let at = Rect { x: area.x + (area.width - w) / 2, y: area.y + (area.height - h) / 2, width: w, height: h };
    ratatui::widgets::Clear.render(at, buf);
    Block::bordered().border_style(KEY).title(format!(" keys, each after {PREFIX} ")).title_bottom(Line::styled(" any key closes this ", DIM)).render(at, buf);
    let room = inner(at);
    for (i, (key, does)) in HELP.iter().take(usize::from(room.height.saturating_sub(1))).enumerate() {
        let y = room.y + 1 + i as u16;
        put(buf, room.x + 2, y, room.x + room.width, key, KEY);
        put(buf, room.x + 11, y, room.x + room.width, does, Style::new());
    }
}

/// Draw the whole screen. Where the cursor belongs comes back: in the pane in focus, at
/// its program's cursor or at the end of the line being typed.
pub fn draw(buf: &mut Buffer, area: Rect, p: &Picture) -> Option<(u16, u16)> {
    if area.width < LEAST.0 || area.height < LEAST.1 {
        put(buf, area.x, area.y, area.x + area.width, &format!("askk needs a window of at least {} × {}", LEAST.0, LEAST.1), Style::new());
        return None;
    }
    let at = parts(area, p.side_open);
    sidebar(buf, at.side, p);
    tab_line(buf, at.tabs, p);
    let cursor = p.panes.iter().filter_map(|v| pane(buf, v)).last();
    foot(buf, at.foot, p);
    if p.help {
        help(buf, area);
        return None;
    }
    cursor.filter(|_| p.foot != Foot::Side)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::core::boxes::State;
    use crate::core::screen::Line as Row;

    fn picture<'a>(boxes: &'a [SessionBox], seen: &'a Seen, panes: Vec<PaneView<'a>>) -> Picture<'a> {
        Picture { host: "h", boxes, seen, side_open: true, side_at: 0, shown: "", tabs: vec!["one".into()], tab: 0, panes, foot: Foot::Pane, note: "", note_bad: false, help: false }
    }

    /// The buffer as rows of text. The cell after a wide letter belongs to that letter.
    pub fn rows(buf: &Buffer) -> Vec<String> {
        let row = |y: u16| {
            let (mut text, mut skip) = (String::new(), 0);
            for x in 0..buf.area.width {
                if skip > 0 {
                    skip -= 1;
                    continue;
                }
                let symbol = buf[(x, y)].symbol();
                skip = unicode_width::UnicodeWidthStr::width(symbol).saturating_sub(1);
                text.push_str(symbol);
            }
            text.trim_end().to_string()
        };
        (0..buf.area.height).map(row).collect()
    }

    #[test]
    fn the_parts_fill_the_window_and_a_window_too_small_says_so() {
        let area = Rect { x: 0, y: 0, width: 120, height: 30 };
        let at = parts(area, true);
        assert_eq!((at.side, at.tabs, at.main, at.foot), (Rect::new(0, 0, 32, 29), Rect::new(32, 0, 88, 1), Rect::new(32, 1, 88, 28), Rect::new(0, 29, 120, 1)));
        assert_eq!(parts(area, false).main, Rect::new(4, 1, 116, 28), "folded, the sidebar is four cells");
        assert_eq!(inner(Rect::new(32, 1, 88, 28)), Rect::new(33, 2, 86, 26));
        let small = Rect { x: 0, y: 0, width: 39, height: 8 };
        let mut buf = Buffer::empty(small);
        let seen = Seen::default();
        assert_eq!(draw(&mut buf, small, &picture(&[], &seen, vec![])), None);
        assert_eq!(rows(&buf)[0], "askk needs a window of at least 40 × 8");
    }

    #[test]
    fn a_terminals_screen_is_drawn_with_its_looks_and_its_cursor() {
        let red = Span { text: "red".into(), fg: "1".into(), bold: true, ..Default::default() };
        let true_colour = Span { text: "tc".into(), fg: "#0a141e".into(), bg: "200".into(), inverse: true, underline: true, ..Default::default() };
        let screen = Screen { cols: 20, rows: 5, lines: vec![Row { spans: vec![Span::plain("$ "), red, true_colour] }, Row { spans: vec![Span::plain("日本 x")] }], cursor: Some((6, 1)), alive: true, ..Default::default() };
        let area = Rect { x: 0, y: 0, width: 60, height: 10 };
        let at = parts(area, false).main;
        let seen = Seen::default();
        let mut buf = Buffer::empty(area);
        let view = PaneView { at, focused: true, head: "sh · sh".into(), mark: Some(Mark::Working), zoomed: false, body: Body::Screen(&screen, 0) };
        let folded = |panes| Picture { side_open: false, ..picture(&[], &seen, panes) };
        let cursor = draw(&mut buf, area, &folded(vec![view]));
        let room = inner(at);
        assert_eq!(cursor, Some((room.x + 6, room.y + 1)), "the program's cursor, inside the pane");
        assert!(rows(&buf)[usize::from(room.y)].contains("│$ redtc") && rows(&buf)[usize::from(room.y) + 1].contains("│日本 x"), "{:?}", rows(&buf));
        let cell = &buf[(room.x + 2, room.y)];
        assert_eq!((cell.symbol(), cell.fg, cell.modifier.contains(Modifier::BOLD)), ("r", Color::Indexed(1), true));
        let cell = &buf[(room.x + 5, room.y)];
        assert_eq!((cell.fg, cell.bg), (Color::Rgb(10, 20, 30), Color::Indexed(200)));
        assert!(cell.modifier.contains(Modifier::REVERSED | Modifier::UNDERLINED));
        assert_eq!(buf[(at.x, at.y)].fg, Color::Blue, "the pane in focus has a bright frame");
        // A screen taller than the pane shows its last rows, where the program writes.
        let tall = Screen { cols: 20, rows: 30, lines: (1..=30).map(|n| Row { spans: vec![Span::plain(format!("row {n}"))] }).collect(), cursor: Some((0, 29)), alive: true, ..Default::default() };
        let mut buf = Buffer::empty(area);
        let view = PaneView { at, focused: false, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&tall, 0) };
        assert_eq!(draw(&mut buf, area, &folded(vec![view])), None, "a pane that is not in focus has no cursor");
        let drawn = rows(&buf);
        assert!(drawn[usize::from(room.y + room.height - 1)].contains("│row 30") && !drawn.iter().any(|r| r.contains("│row 1 ")), "{drawn:?}");
        assert_eq!(buf[(at.x, at.y)].fg, Color::DarkGray);
        // Looked back in, the pane says how far up it is and how to return, and has no cursor.
        let mut buf = Buffer::empty(area);
        let view = PaneView { at, focused: true, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&screen, 12) };
        assert_eq!(draw(&mut buf, area, &folded(vec![view])), None);
        assert!(rows(&buf)[usize::from(room.y + room.height - 1)].contains("↑ 12 rows up · wheel down or type to return"), "{:?}", rows(&buf));
    }

    #[test]
    fn lines_keep_the_colours_of_the_lines_mode_wrap_and_scroll() {
        let run = super::super::layout::failed(TALK, "no engine");
        let cells = letters(&run);
        assert_eq!(cells.iter().map(|(c, _)| *c).collect::<String>(), "× could not: no engine", "the colour codes are not letters");
        assert_eq!((cells[0].1.fg, cells[2].1.fg), (Some(Color::LightRed), None), "the mark is red, the words are not");
        assert_eq!(letters(&TALK.ink(super::super::layout::Ink::Key, "k"))[0].1, Style::new().add_modifier(Modifier::BOLD).fg(Color::Blue));
        let long = vec!["a".repeat(25), "日本語日本語".into()];
        let wrapped_rows: Vec<String> = wrapped(&long, 10).iter().map(|r| r.iter().map(|(c, _)| *c).collect()).collect();
        assert_eq!(wrapped_rows, ["aaaaaaaaaa", "aaaaaaaaaa", "aaaaa", "日本語日本", "語"], "a wide letter takes two cells");
        // Twenty lines in a pane with room for four: the last four, then four further back.
        let lines: Vec<String> = (1..=20).map(|n| format!("line {n}")).collect();
        let area = Rect { x: 0, y: 0, width: 50, height: 10 };
        let at = parts(area, false).main;
        let seen = Seen::default();
        let show = |back: usize| {
            let mut buf = Buffer::empty(area);
            let view = PaneView { at, focused: true, head: "e".into(), mark: None, zoomed: false, body: Body::Talk { lines: &lines, input: "typed", back } };
            let cursor = draw(&mut buf, area, &Picture { side_open: false, ..picture(&[], &seen, vec![view]) });
            (rows(&buf), cursor)
        };
        let (drawn, cursor) = show(0);
        assert!(drawn[2].contains("│line 17") && drawn[5].contains("│line 20") && drawn[7].contains("│> typed"), "{drawn:?}");
        assert_eq!(cursor, Some((inner(at).x + 7, 7)), "the cursor is after what was typed");
        let (drawn, _) = show(4);
        assert!(drawn[2].contains("│line 13") && drawn[5].contains("│line 16") && drawn[6].contains("4 rows below"), "{drawn:?}");
        assert!(show(999).0[2].contains("│line 1"), "scrolled past the start, it stops at the start");
    }

    #[test]
    fn the_sidebar_counts_what_does_not_fit_and_a_click_finds_the_row_it_shows() {
        let boxes: Vec<SessionBox> = (1..=20).map(|n| SessionBox { id: format!("engine:e{n}"), title: format!("e{n}"), kind: "engine".into(), state: State::Idle, ..Default::default() }).collect();
        let seen = Seen::default();
        let area = Rect { x: 0, y: 0, width: 100, height: 14 };
        let side = parts(area, true).side;
        // 13 rows, 2 above the list: room for 5 boxes of two rows each.
        let mut p = picture(&boxes, &seen, vec![]);
        let mut buf = Buffer::empty(area);
        draw(&mut buf, area, &p);
        assert!(rows(&buf)[2].starts_with(" ○ e1 · engine") && rows(&buf)[12].starts_with(" +15 more"), "{:?}", rows(&buf));
        assert_eq!((side_row(side, true, 20, 0, 2), side_row(side, true, 20, 0, 3), side_row(side, true, 20, 0, 4), side_row(side, true, 20, 0, 1)), (Some(0), Some(0), Some(1), None));
        // With the sidebar's cursor on the tenth box, the window of five ends on it.
        (p.side_at, p.foot) = (9, Foot::Side);
        let mut buf = Buffer::empty(area);
        draw(&mut buf, area, &p);
        assert!(rows(&buf)[2].starts_with(" ○ e6") && rows(&buf)[10].starts_with(" ○ e10"), "{:?}", rows(&buf));
        assert!(buf[(1, 10)].modifier.contains(Modifier::REVERSED), "the chosen row is marked");
        assert_eq!(side_row(side, true, 20, 9, 10), Some(9), "a click lands on the row that is drawn there");
        assert_eq!(side_row(side, false, 3, 0, 4), Some(2), "folded, a box is one row");
        assert_eq!(side_row(side, false, 3, 0, 5), None);
        assert_eq!((tab_at(Rect::new(4, 0, 50, 1), &["one".into(), "two".into()], 4), tab_at(Rect::new(4, 0, 50, 1), &["one".into(), "two".into()], 11), tab_at(Rect::new(4, 0, 50, 1), &["one".into()], 30)), (Some(0), Some(1), None));
    }
}
