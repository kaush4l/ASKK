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
use crate::ui::features::terminals::ended;
pub use super::side::side_row;
use ratatui::prelude::{Buffer, Color, Line, Modifier, Rect, Style, Widget};
use ratatui::widgets::Block;
use unicode_width::UnicodeWidthChar;

/// How wide the sidebar is, open and folded.
pub const SIDE_OPEN: u16 = 32;
pub const SIDE_FOLDED: u16 = 4;
/// The smallest window that is drawn at all.
pub const LEAST: (u16, u16) = (40, 8);
/// Rows above the first box in the sidebar: the head, and the heading.
pub(super) const SIDE_HEAD: u16 = 2;
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
    /// Copy mode on this pane: where its cursor is and where the selection began.
    pub copy: Option<CopyView>,
}

/// Copy mode as drawn: cells as (column, row of the pane, from 0); a row above the pane is
/// below 0. `back`: how many rows up the pane is looked at; `block`: the selection is a
/// rectangle; `query`: the text being typed after `/`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CopyView {
    pub cursor: (u16, i32),
    pub from: Option<(u16, i32)>,
    pub back: u16,
    pub block: bool,
    pub query: Option<String>,
}

/// An open menu as drawn: where, its title, its lines, the one chosen.
#[derive(Clone, Debug, PartialEq)]
pub struct MenuView {
    pub at: Rect,
    pub title: String,
    pub items: Vec<String>,
    pub chosen: usize,
}

/// A place's heading in the sidebar: where in the list it begins, its name, its git state.
#[derive(Clone, Debug, PartialEq)]
pub struct Head {
    pub at: usize,
    pub name: String,
    /// The branch and how it stands (`main ✓`, `main ● 2 ↑1`); empty when it is no repository.
    pub git: String,
    pub clean: bool,
}

/// What the foot says.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Foot {
    /// The keys go to the pane: say how to reach the others.
    Pane,
    /// The prefix was pressed: the next key works the panes.
    Prefix,
    /// Navigate mode: the keys move over the boxes, the places, the panes and the tabs.
    Side,
    /// Copy mode: the keys move over the pane, select and copy.
    Copy,
    /// A name is typed for a tab or a pane.
    Naming,
}

pub struct Picture<'a> {
    /// Who answers: the service's address, or that this terminal is its own host.
    pub host: &'a str,
    /// The boxes in the order the sidebar lists them.
    pub boxes: Vec<&'a SessionBox>,
    /// Where each place begins in that list; none when every box runs in one place.
    pub heads: Vec<Head>,
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
    /// The keys in force: the prefix, the foot's hints, every key (for the help, when it is
    /// open), and how a terminal that ended is forgotten.
    pub prefix: String,
    pub hints: Vec<(String, &'static str)>,
    pub keys: Vec<(String, &'static str)>,
    pub forget: String,
    /// One sentence at the foot: what just happened, or why something could not be done.
    pub note: &'a str,
    pub note_bad: bool,
    pub help: bool,
    /// The menu open, if one is.
    pub menu: Option<MenuView>,
    /// While a name is typed: what is named, and the name so far.
    pub naming: Option<(String, String)>,
    /// The boxes told of that nobody has looked at since: marked `◆` in the sidebar.
    pub rung: Vec<&'a str>,
    /// How navigate mode is entered, for the sidebar's "+N more".
    pub navigate: String,
    pub theme: super::theme::Theme,
}

pub(super) const DIM: Style = Style::new().fg(Color::DarkGray);
pub(super) const KEY: Style = Style::new().fg(Color::Blue).add_modifier(Modifier::BOLD);
pub(super) const STRONG: Style = Style::new().add_modifier(Modifier::BOLD);
pub(super) const HEADING: Style = Style::new().fg(Color::DarkGray).add_modifier(Modifier::BOLD);
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
pub(super) fn put(buf: &mut Buffer, x: u16, y: u16, end: u16, text: &str, how: Style) -> u16 {
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
fn put_keys<K: AsRef<str>>(buf: &mut Buffer, mut x: u16, y: u16, end: u16, pairs: &[(K, &str)]) -> u16 {
    for (key, does) in pairs {
        x = put(buf, x, y, end, key.as_ref(), KEY);
        x = put(buf, x, y, end, &format!(" {does}  "), DIM);
    }
    x
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
fn screen_body(buf: &mut Buffer, room: Rect, s: &Screen, back: u16, forget: &str, copy: Option<&CopyView>) -> Option<(u16, u16)> {
    let skip = s.lines.len().saturating_sub(usize::from(room.height));
    let end = room.x + room.width;
    for (row, line) in s.lines.iter().skip(skip).enumerate() {
        let mut x = room.x;
        for span in &line.spans {
            x = put(buf, x, room.y + row as u16, end, &span.text, look(span));
        }
    }
    if let Some(c) = copy {
        copy_marks(buf, room, c);
        return None;
    }
    if back > 0 && room.height > 0 {
        let y = room.y + room.height - 1;
        put(buf, room.x, y, end, &format!(" ↑ {back} rows up · wheel down or type to return "), KEY.add_modifier(Modifier::REVERSED));
        return None;
    }
    if !s.alive && room.height > 0 {
        let y = room.y + room.height - 1;
        put(buf, room.x, y, end, &format!(" its program {} · {forget} forgets it ", ended(s.exit)), DIM.add_modifier(Modifier::REVERSED));
        return None;
    }
    let (col, row) = s.cursor?;
    let row = usize::from(row).checked_sub(skip)?;
    (col < room.width && row < usize::from(room.height)).then(|| (room.x + col, room.y + row as u16))
}

/// Copy mode over a pane: the selection reversed, the cursor's cell bright, and a line
/// that says which keys work here.
fn copy_marks(buf: &mut Buffer, room: Rect, c: &CopyView) {
    let (from, to) = match c.from {
        Some(m) if (m.1, m.0) <= (c.cursor.1, c.cursor.0) => (Some(m), c.cursor),
        Some(m) => (Some(c.cursor), m),
        None => (None, c.cursor),
    };
    for row in 0..room.height {
        for col in 0..room.width {
            let cell = (col, i32::from(row));
            let selected = from.is_some_and(|f| match c.block {
                true => cell.1 >= f.1 && cell.1 <= to.1 && cell.0 >= f.0.min(to.0) && cell.0 <= f.0.max(to.0),
                false => (cell.1, cell.0) >= (f.1, f.0) && (cell.1, cell.0) <= (to.1, to.0),
            });
            let at = (room.x + col, room.y + row);
            if cell == c.cursor {
                buf[at].set_style(Style::new().bg(Color::Yellow).fg(Color::Black));
            } else if selected {
                buf[at].set_style(Style::new().add_modifier(Modifier::REVERSED));
            }
        }
    }
    if room.height > 0 {
        let y = room.y + room.height - 1;
        let up = if c.back > 0 { format!(" · ↑ {} rows up", c.back) } else { String::new() };
        let doing = match (c.from.is_some(), c.block) {
            (true, true) => "y copies the rectangle",
            (true, false) => "y copies",
            (false, _) => "v selects",
        };
        let line = match &c.query {
            Some(q) => format!(" find upwards: {q}▏ · enter finds · esc stops "),
            None => format!(" copy · {doing} · esc leaves{up} "),
        };
        put(buf, room.x, y, room.x + room.width, &line, KEY.add_modifier(Modifier::REVERSED));
    }
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

fn pane(buf: &mut Buffer, v: &PaneView, forget: &str) -> Option<(u16, u16)> {
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
        Body::Screen(s, back) => screen_body(buf, room, s, *back, forget, v.copy.as_ref()),
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
            let x = put(buf, start, at.y, end, &format!(" {}", p.prefix), KEY);
            let x = put(buf, x, at.y, end, "  then  ", DIM);
            put_keys(buf, x, at.y, end, &p.hints);
        }
        Foot::Prefix => {
            let x = put(buf, start, at.y, end, &format!(" {} …", p.prefix), KEY.add_modifier(Modifier::REVERSED));
            let x = put(buf, x, at.y, end, "  ", DIM);
            put_keys(buf, x, at.y, end, &p.hints.iter().cloned().chain([("esc".to_string(), "nothing")]).collect::<Vec<_>>());
        }
        Foot::Copy => {
            put_keys(buf, start + 1, at.y, end, &[("hjkl", "move"), ("v", "select"), ("y", "copy"), ("esc", "leave"), ("w b e", "word"), ("/ n N", "find"), ("ctrl+v", "rectangle")]);
        }
        Foot::Side => {
            let x = put(buf, start, at.y, end, " NAVIGATE ", KEY.add_modifier(Modifier::REVERSED));
            put_keys(buf, x + 1, at.y, end, &[("↑ ↓", "box"), ("[ ]", "place"), ("h j k l", "pane"), ("n p", "tab"), ("z", "zoom"), ("m", "menu"), ("enter", "show it"), ("esc", "leave")]);
        }
        Foot::Naming => {
            let (what, text) = p.naming.clone().unwrap_or_default();
            let x = put(buf, start, at.y, end, &format!(" name {what}: "), KEY);
            let x = put(buf, x, at.y, end, &text, STRONG);
            put_keys(buf, x + 2, at.y, end, &[("enter", "keep"), ("esc", "leave it")]);
        }
    }
}

/// An open menu, over what is under it: its title, its lines, the chosen one reversed.
fn menu(buf: &mut Buffer, m: &MenuView) {
    ratatui::widgets::Clear.render(m.at, buf);
    Block::bordered().border_style(KEY).title(Line::styled(format!(" {} ", m.title), STRONG)).title_bottom(Line::styled(" ↑ ↓ enter · esc ", DIM)).render(m.at, buf);
    let room = inner(m.at);
    for (i, item) in m.items.iter().take(usize::from(room.height)).enumerate() {
        let y = room.y + i as u16;
        let how = if i == m.chosen { KEY.add_modifier(Modifier::REVERSED) } else { Style::new() };
        if i == m.chosen {
            buf.set_style(Rect { y, height: 1, ..room }, how);
        }
        put(buf, room.x + 1, y, room.x + room.width, item, how);
    }
}

fn help(buf: &mut Buffer, area: Rect, p: &Picture) {
    let w = 92.min(area.width.saturating_sub(2));
    let h = (p.keys.len() as u16 + 4).min(area.height.saturating_sub(1));
    let at = Rect { x: area.x + (area.width - w) / 2, y: area.y + (area.height - h) / 2, width: w, height: h };
    ratatui::widgets::Clear.render(at, buf);
    Block::bordered().border_style(KEY).title(format!(" keys, each after {} ", p.prefix)).title_bottom(Line::styled(" any key closes this · `keys` in settings.json changes them ", DIM)).render(at, buf);
    let room = inner(at);
    let wide = p.keys.iter().map(|(k, _)| k.chars().count()).max().unwrap_or(0) as u16 + 4;
    for (i, (key, does)) in p.keys.iter().take(usize::from(room.height.saturating_sub(1))).enumerate() {
        let y = room.y + 1 + i as u16;
        put(buf, room.x + 2, y, room.x + room.width, key, KEY);
        put(buf, room.x + wide, y, room.x + room.width, does, Style::new());
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
    super::side::sidebar(buf, at.side, p);
    tab_line(buf, at.tabs, p);
    let cursor = p.panes.iter().filter_map(|v| pane(buf, v, &p.forget)).last();
    foot(buf, at.foot, p);
    if let Some(m) = &p.menu {
        menu(buf, m);
    }
    if p.help {
        help(buf, area, p);
    }
    p.theme.paint(buf, area);
    if p.help || p.menu.is_some() {
        return None;
    }
    if let Some((what, text)) = &p.naming {
        let x = at.foot.x + (format!(" name {what}: {text}").chars().count() as u16).min(at.foot.width.saturating_sub(1));
        return Some((x, at.foot.y));
    }
    cursor.filter(|_| p.foot != Foot::Side)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::core::boxes::State;
    use crate::core::screen::Line as Row;

    fn picture<'a>(boxes: &'a [SessionBox], seen: &'a Seen, panes: Vec<PaneView<'a>>) -> Picture<'a> {
        let keys = crate::ui::features::terminals::Keymap::default();
        let navigate = keys.says(crate::ui::features::terminals::Action::Navigate);
        let theme = super::super::theme::Theme { palette: None, truecolor: true };
        Picture { host: "h", boxes: boxes.iter().collect(), heads: vec![], seen, side_open: true, side_at: 0, shown: "", tabs: vec!["one".into()], tab: 0, panes, foot: Foot::Pane, prefix: keys.prefix(), hints: keys.hints(), keys: keys.help(), forget: keys.says(crate::ui::features::terminals::Action::EndTerminal), note: "", note_bad: false, help: false, menu: None, naming: None, rung: vec![], navigate, theme }
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
        let view = PaneView { at, focused: true, head: "sh · sh".into(), mark: Some(Mark::Working), zoomed: false, body: Body::Screen(&screen, 0), copy: None };
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
        let view = PaneView { at, focused: false, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&tall, 0), copy: None };
        assert_eq!(draw(&mut buf, area, &folded(vec![view])), None, "a pane that is not in focus has no cursor");
        let drawn = rows(&buf);
        assert!(drawn[usize::from(room.y + room.height - 1)].contains("│row 30") && !drawn.iter().any(|r| r.contains("│row 1 ")), "{drawn:?}");
        assert_eq!(buf[(at.x, at.y)].fg, Color::DarkGray);
        // Looked back in, the pane says how far up it is and how to return, and has no cursor.
        let mut buf = Buffer::empty(area);
        let view = PaneView { at, focused: true, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&screen, 12), copy: None };
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
            let view = PaneView { at, focused: true, head: "e".into(), mark: None, zoomed: false, body: Body::Talk { lines: &lines, input: "typed", back }, copy: None };
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
        assert!(rows(&buf)[2].starts_with(" ○ e1 · engine") && rows(&buf)[12].starts_with(" +15 more (ctrl+b w, then ↓)"), "the hint names the key in force: {:?}", rows(&buf));
        assert_eq!((side_row(side, true, &[], 20, 0, 2), side_row(side, true, &[], 20, 0, 3), side_row(side, true, &[], 20, 0, 4), side_row(side, true, &[], 20, 0, 1)), (Some(0), Some(0), Some(1), None));
        // With the sidebar's cursor on the tenth box, the window of five ends on it.
        (p.side_at, p.foot) = (9, Foot::Side);
        let mut buf = Buffer::empty(area);
        draw(&mut buf, area, &p);
        assert!(rows(&buf)[2].starts_with(" ○ e6") && rows(&buf)[10].starts_with(" ○ e10"), "{:?}", rows(&buf));
        assert!(buf[(1, 10)].modifier.contains(Modifier::REVERSED), "the chosen row is marked");
        assert_eq!(side_row(side, true, &[], 20, 9, 10), Some(9), "a click lands on the row that is drawn there");
        assert_eq!(side_row(side, false, &[], 3, 0, 4), Some(2), "folded, a box is one row");
        assert_eq!(side_row(side, false, &[], 3, 0, 5), None);
        assert_eq!((tab_at(Rect::new(4, 0, 50, 1), &["one".into(), "two".into()], 4), tab_at(Rect::new(4, 0, 50, 1), &["one".into(), "two".into()], 11), tab_at(Rect::new(4, 0, 50, 1), &["one".into()], 30)), (Some(0), Some(1), None));
    }

    #[test]
    fn the_sidebar_heads_each_place_with_its_git_state_and_a_click_on_a_heading_shows_nothing() {
        let boxes: Vec<SessionBox> = ["a", "b", "c"].iter().map(|n| SessionBox { id: format!("terminal:{n}"), title: n.to_string(), kind: "sh".into(), state: State::Working, ..Default::default() }).collect();
        let seen = Seen::default();
        let area = Rect { x: 0, y: 0, width: 100, height: 14 };
        let side = parts(area, true).side;
        let mut p = picture(&boxes, &seen, vec![]);
        p.heads = vec![Head { at: 0, name: "askk".into(), git: "main ✓".into(), clean: true }, Head { at: 2, name: "demo".into(), git: "wip ● 2 ↑1".into(), clean: false }];
        let mut buf = Buffer::empty(area);
        draw(&mut buf, area, &p);
        let drawn = rows(&buf);
        assert!(drawn[2].starts_with(" askk main ✓") && drawn[3].starts_with(" ● a · sh") && drawn[5].starts_with(" ● b · sh"), "{drawn:?}");
        assert!(drawn[7].starts_with(" demo wip ● 2 ↑1") && drawn[8].starts_with(" ● c · sh"), "{drawn:?}");
        assert_eq!(buf[(6, 7)].fg, Color::Yellow, "a place with changes is told apart from a clean one");
        let at = [0, 2];
        assert_eq!((side_row(side, true, &at, 3, 0, 2), side_row(side, true, &at, 3, 0, 3), side_row(side, true, &at, 3, 0, 8)), (None, Some(0), Some(2)));
        assert_eq!(side_row(side, false, &at, 3, 0, 4), Some(2), "folded, there are no headings");
    }

    #[test]
    fn copy_mode_marks_the_selection_and_the_cursor_and_says_its_keys() {
        let screen = Screen { cols: 20, rows: 5, lines: vec![Row { spans: vec![Span::plain("first row")] }, Row { spans: vec![Span::plain("second row")] }], alive: true, ..Default::default() };
        let area = Rect { x: 0, y: 0, width: 60, height: 10 };
        let at = parts(area, false).main;
        let room = inner(at);
        let seen = Seen::default();
        let mut buf = Buffer::empty(area);
        let copy = CopyView { cursor: (3, 1), from: Some((6, 0)), back: 4, ..Default::default() };
        let view = PaneView { at, focused: true, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&screen, 4), copy: Some(copy) };
        let p = Picture { side_open: false, foot: Foot::Copy, ..picture(&[], &seen, vec![view]) };
        assert_eq!(draw(&mut buf, area, &p), None, "the program's cursor is not shown while copying");
        assert!(buf[(room.x + 6, room.y)].modifier.contains(Modifier::REVERSED) && !buf[(room.x + 5, room.y)].modifier.contains(Modifier::REVERSED), "from the mark on");
        assert!(buf[(room.x + 2, room.y + 1)].modifier.contains(Modifier::REVERSED), "up to the cursor");
        assert_eq!(buf[(room.x + 3, room.y + 1)].bg, Color::Yellow, "the cursor's own cell");
        let drawn = rows(&buf);
        assert!(drawn[usize::from(room.y + room.height - 1)].contains("copy · y copies · esc leaves · ↑ 4 rows up"), "{drawn:?}");
        assert!(drawn[9].contains("v select") && drawn[9].contains("esc leave") && drawn[9].contains("w b e word"), "{}", drawn[9]);
        // A rectangle: the same columns of each row, not the rows between.
        let mut buf = Buffer::empty(area);
        let copy = CopyView { cursor: (3, 1), from: Some((6, 0)), block: true, ..Default::default() };
        let view = PaneView { at, focused: true, head: "sh".into(), mark: None, zoomed: false, body: Body::Screen(&screen, 0), copy: Some(copy) };
        draw(&mut buf, area, &Picture { side_open: false, foot: Foot::Copy, ..picture(&[], &seen, vec![view]) });
        assert!(buf[(room.x + 4, room.y)].modifier.contains(Modifier::REVERSED) && !buf[(room.x + 7, room.y)].modifier.contains(Modifier::REVERSED) && !buf[(room.x + 2, room.y)].modifier.contains(Modifier::REVERSED));
        assert!(rows(&buf)[usize::from(room.y + room.height - 1)].contains("y copies the rectangle"));
    }

    #[test]
    fn a_menu_is_drawn_over_the_panes_and_a_theme_paints_every_cell() {
        let seen = Seen::default();
        let area = Rect { x: 0, y: 0, width: 60, height: 12 };
        let m = MenuView { at: Rect::new(10, 2, 24, 5), title: "pane · sh".into(), items: vec!["split right".into(), "zoom".into(), "close the pane".into()], chosen: 1 };
        let mut buf = Buffer::empty(area);
        let p = Picture { menu: Some(m), ..picture(&[], &seen, vec![]) };
        assert_eq!(draw(&mut buf, area, &p), None, "no cursor while a menu is open");
        let drawn = rows(&buf);
        assert!(drawn[2].contains("┌ pane · sh ") && drawn[3].contains("│ split right") && drawn[4].contains("│ zoom") && drawn[6].contains("↑ ↓ enter · esc"), "{drawn:?}");
        assert!(buf[(12, 4)].modifier.contains(Modifier::REVERSED) && !buf[(12, 3)].modifier.contains(Modifier::REVERSED), "the chosen line is marked");
        let glass = super::super::theme::Theme { palette: Some(super::super::theme::GLASS_DARK), truecolor: true };
        let mut buf = Buffer::empty(area);
        draw(&mut buf, area, &Picture { theme: glass, ..picture(&[], &seen, vec![]) });
        assert_eq!((buf[(45, 5)].bg, buf[(0, 0)].fg), (Color::Rgb(0, 0, 0), Color::Rgb(0xf4, 0xef, 0xe6)), "the page's ground and ink");
        assert_eq!(buf[(2, 11)].fg, Color::Rgb(0xb8, 0xae, 0xf0), "a key in the foot is the page's accent");
        // Naming: the foot is the line typed into, and the cursor waits at its end.
        let mut buf = Buffer::empty(area);
        let at = draw(&mut buf, area, &Picture { foot: Foot::Naming, naming: Some(("the pane".into(), "logs".into())), ..picture(&[], &seen, vec![]) });
        assert!(rows(&buf)[11].starts_with(" name the pane: logs  enter keep  esc leave it"), "{}", rows(&buf)[11]);
        assert_eq!(at, Some((20, 11)));
    }
}
