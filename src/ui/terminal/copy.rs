//! # Copy: moving over a terminal's pane and what scrolled off it, selecting, copying
//!
//! tmux's and herdr's copy mode. `ctrl+b [` (the keys table's `copy_mode`) stops the pane
//! where it is and puts a cursor of its own on it; the cursor moves over the screen and up
//! into what scrolled off the top (`terminal_scrolled`), `v` starts a selection there, and
//! `y` or Enter copies what is selected to the outer terminal's clipboard (OSC 52, written
//! by `client.rs`). Esc or `q` leaves. Dragging the mouse over a terminal's pane selects the
//! same way, and letting go copies.
//!
//! | keys | do |
//! | --- | --- |
//! | h j k l, arrows, 0 $, g G, PgUp PgDn, ctrl+u ctrl+d | move |
//! | w b e | to the next word, back to the start of one, to its end (a word is what is between spaces, vim's `W`) |
//! | `/` a text, Enter | find it upwards, into what scrolled off (asked for a page at a time until the top of what is kept); `n` finds it again further up, `N` back down |
//! | v (or space), ctrl+v (or r) | select from here; select a rectangle instead of rows |
//! | y, Enter | copy what is selected, and leave |
//!
//! A row is counted from the top of the screen as it stands now: 0 is its first row, -1
//! the last row that scrolled off. The pane looks `back` rows up, so the row drawn at the
//! top of the pane is `-back`. Rows are remembered as their text while they are looked at,
//! so a selection may be longer than the pane.
use super::app::{App, Mode, Want};
use crate::core::screen::Screen;
use crate::ui::features::terminals::{inside, Inside};
use std::collections::BTreeMap;

/// A cell: its column, and its row as counted above.
pub type Cell = (u16, i32);

/// A pane in copy mode.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Copy {
    /// The terminal it looks at.
    pub id: String,
    pub at: Cell,
    /// Where the selection began; `None` until `v`.
    pub mark: Option<Cell>,
    /// The text of each row seen, by its row.
    pub lines: BTreeMap<i32, String>,
    /// It was started by the mouse: letting go copies and leaves.
    pub mouse: bool,
    /// The selection is a rectangle, not rows.
    pub block: bool,
    /// What is typed after `/`, while it is typed.
    pub query: Option<String>,
    /// The last text looked for.
    pub sought: String,
    /// A find going on up into what scrolled off: the text, and where the cursor was.
    pub hunt: Option<(String, Cell)>,
}

/// A move by words.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Word {
    Next,
    Back,
    End,
}

impl Copy {
    /// Remember the rows of `screen`, looked at `back` rows up.
    pub fn take(&mut self, screen: &Screen, back: u16) {
        for (r, line) in screen.lines.iter().enumerate() {
            self.lines.insert(r as i32 - i32::from(back), line.text());
        }
    }

    /// The selection, first cell first; `None` while nothing is selected.
    pub fn selection(&self) -> Option<(Cell, Cell)> {
        let mark = self.mark?;
        let (a, b) = if (mark.1, mark.0) <= (self.at.1, self.at.0) { (mark, self.at) } else { (self.at, mark) };
        Some((a, b))
    }

    /// What is selected, as text: rows end with a line end, and spaces at a row's end go. A
    /// rectangle is the same columns of every row.
    pub fn text(&self) -> String {
        let Some(((c0, r0), (c1, r1))) = self.selection() else { return String::new() };
        let (left, right) = (c0.min(c1), c0.max(c1));
        let mut rows = vec![];
        for r in r0..=r1 {
            let line: Vec<char> = self.lines.get(&r).map(|l| l.chars().collect()).unwrap_or_default();
            let from = if self.block { usize::from(left) } else if r == r0 { usize::from(c0) } else { 0 };
            let to = if self.block { (usize::from(right) + 1).min(line.len()) } else if r == r1 { (usize::from(c1) + 1).min(line.len()) } else { line.len() };
            rows.push(line.get(from.min(to)..to).map(|s| s.iter().collect::<String>()).unwrap_or_default().trim_end().to_string());
        }
        rows.join("\n")
    }

    /// The length of row `r`, as far as it is known.
    fn width(&self, r: i32) -> u16 {
        self.lines.get(&r).map(|l| l.trim_end().chars().count() as u16).unwrap_or(0)
    }

    /// Every cell of the rows known, in reading order, each row ending in one space.
    fn cells(&self) -> Vec<(Cell, bool)> {
        let mut out = vec![];
        for (r, line) in &self.lines {
            let chars: Vec<char> = line.trim_end().chars().collect();
            out.extend(chars.iter().enumerate().map(|(c, ch)| ((c as u16, *r), ch.is_whitespace())));
            out.push(((chars.len() as u16, *r), true));
        }
        out
    }

    /// Where a move by words from the cursor lands; `None` when there is no word that way.
    pub fn word(&self, how: Word) -> Option<Cell> {
        let all = self.cells();
        let (col, row) = self.at;
        let i = all.iter().position(|((c, r), _)| *r == row && *c >= col).or_else(|| all.iter().rposition(|((_, r), _)| *r <= row))?;
        let space = |j: usize| all[j].1;
        let mut j = i;
        match how {
            Word::Next => {
                while j < all.len() && !space(j) {
                    j += 1;
                }
                while j < all.len() && space(j) {
                    j += 1;
                }
            }
            Word::End => {
                j += 1;
                while j < all.len() && space(j) {
                    j += 1;
                }
                while j + 1 < all.len() && !space(j + 1) {
                    j += 1;
                }
            }
            Word::Back => {
                j = j.checked_sub(1)?;
                while j > 0 && space(j) {
                    j -= 1;
                }
                while j > 0 && !space(j - 1) {
                    j -= 1;
                }
                if space(j) {
                    return None;
                }
            }
        }
        all.get(j).filter(|(_, s)| !s).map(|(c, _)| *c)
    }

    /// Where `text` is next, up from the cursor (`up`) or down from it, in the rows known.
    /// While a find goes on up into what scrolled off, it is from where it began.
    pub fn find(&self, text: &str, up: bool) -> Option<Cell> {
        if text.is_empty() {
            return None;
        }
        let low = text.to_lowercase();
        let hits = |r: i32| -> Vec<u16> {
            let line = self.lines.get(&r).map(|l| l.to_lowercase()).unwrap_or_default();
            line.match_indices(&low).map(|(at, _)| line[..at].chars().count() as u16).collect()
        };
        let (col, row) = self.hunt.as_ref().map(|(_, from)| *from).unwrap_or(self.at);
        let rows: Vec<i32> = self.lines.keys().copied().collect();
        if up {
            rows.iter().rev().filter(|r| **r <= row).find_map(|r| hits(*r).into_iter().rev().find(|c| *r < row || *c < col).map(|c| (c, *r)))
        } else {
            rows.iter().filter(|r| **r >= row).find_map(|r| hits(*r).into_iter().find(|c| *r > row || *c > col).map(|c| (c, *r)))
        }
    }

    /// The first row known.
    pub fn top(&self) -> i32 {
        self.lines.keys().next().copied().unwrap_or(0)
    }
}

impl App {
    /// The rows of the pane in focus, and its columns: where a cursor may go.
    fn copy_room(&self) -> (u16, u16) {
        let at = self.tabs.shown(self.main()).into_iter().find(|(p, _, _)| *p == self.tabs.focus()).map(|(_, r, _)| super::draw::inner(r)).unwrap_or_default();
        (at.height.max(1), at.width.max(1))
    }

    /// Go into copy mode on the pane in focus, the cursor at `at` (else at the program's).
    pub(super) fn copy_begin(&mut self, at: Option<Cell>, mouse: bool) -> Vec<Want> {
        let Inside::Terminal(id) = inside(self.shown()) else {
            self.note = "copy mode is for a terminal's pane".into();
            self.note_bad = true;
            return vec![];
        };
        let back = self.backs.get(&id).copied().unwrap_or(0);
        let (rows, _) = self.copy_room();
        let cursor = self.screens.get(&id).and_then(|s| s.cursor).map(|(c, r)| (c, i32::from(r) - i32::from(back)));
        let mut copy = Copy { id: id.clone(), at: at.or(cursor).unwrap_or((0, i32::from(rows) - 1 - i32::from(back))), mouse, ..Default::default() };
        if let Some(screen) = self.screens.get(&id) {
            copy.take(screen, back);
        }
        if mouse {
            copy.mark = Some(copy.at);
        }
        // The pane stands still while it is copied from: what the program writes waits.
        self.backs.insert(id.clone(), back);
        (self.copy, self.mode) = (Some(copy), Mode::Copy);
        vec![]
    }

    /// Leave copy mode; the pane goes back to its end and lives again.
    pub(super) fn copy_end(&mut self) -> Vec<Want> {
        self.mode = Mode::Pane;
        match self.copy.take() {
            Some(c) => {
                self.backs.remove(&c.id);
                vec![Want::Screen(c.id)]
            }
            None => vec![],
        }
    }

    /// Copy what is selected and leave.
    fn copy_out(&mut self) -> Vec<Want> {
        let text = self.copy.as_ref().map(Copy::text).unwrap_or_default();
        let mut wants = self.copy_end();
        if text.is_empty() {
            self.note = "nothing was selected: v starts a selection where the cursor is".into();
        } else {
            self.note = format!("copied {} characters to the clipboard", text.chars().count());
            wants.insert(0, Want::Copy(text));
        }
        self.note_bad = false;
        wants
    }

    /// Put the cursor at `to`, and look further up or down so that it is in view.
    fn copy_go(&mut self, to: Cell) -> Vec<Want> {
        let (rows, cols) = self.copy_room();
        let Some(c) = self.copy.as_mut() else { return vec![] };
        c.at = (to.0.min(cols - 1), to.1.min(i32::from(rows) - 1));
        let back = self.backs.get(&c.id).copied().unwrap_or(0);
        let top = -i32::from(back);
        let want = if c.at.1 < top {
            -c.at.1
        } else if c.at.1 > top + i32::from(rows) - 1 {
            i32::from(rows) - 1 - c.at.1
        } else {
            return vec![];
        };
        let back = want.clamp(0, i32::from(u16::MAX)) as u16;
        let id = c.id.clone();
        self.backs.insert(id.clone(), back);
        vec![Want::Scrolled { id, back }]
    }

    /// A key while the text to find is typed after `/`.
    fn query_key(&mut self, name: &str, ctrl: bool) -> Vec<Want> {
        let Some(c) = self.copy.as_mut() else { return vec![] };
        let q = c.query.get_or_insert_with(String::new);
        match name {
            "Enter" => {
                let text = c.query.take().unwrap_or_default();
                if text.is_empty() {
                    return vec![];
                }
                c.sought = text.clone();
                return self.seek(&text, true);
            }
            "Escape" => c.query = None,
            "Backspace" => {
                q.pop();
            }
            "u" if ctrl => q.clear(),
            k if !ctrl && k.chars().count() == 1 => q.push_str(k),
            _ => {}
        }
        vec![]
    }

    /// Find `text` from the cursor: in the rows known, else further up, a page at a time.
    fn seek(&mut self, text: &str, up: bool) -> Vec<Want> {
        let Some(c) = self.copy.as_ref() else { return vec![] };
        if let Some(at) = c.find(text, up) {
            if let Some(c) = self.copy.as_mut() {
                c.hunt = None;
            }
            self.say(format!("found '{text}'"), false);
            return self.copy_go(at);
        }
        if !up {
            self.say(format!("'{text}' is not further down"), true);
            return vec![];
        }
        let (origin, top) = (c.hunt.as_ref().map(|(_, o)| *o).unwrap_or(c.at), c.top());
        let (rows, _) = self.copy_room();
        if let Some(c) = self.copy.as_mut() {
            c.hunt = Some((text.to_string(), origin));
        }
        self.say(format!("looking further up for '{text}'…"), false);
        self.copy_go((0, top - i32::from(rows.saturating_sub(1)).max(1)))
    }

    /// A key in copy mode.
    pub(super) fn copy_key(&mut self, name: &str, ctrl: bool) -> Vec<Want> {
        if self.copy.as_ref().is_some_and(|c| c.query.is_some()) {
            return self.query_key(name, ctrl);
        }
        let Some(c) = self.copy.clone() else { return self.copy_end() };
        let (rows, _) = self.copy_room();
        let (col, row) = c.at;
        let half = i32::from(rows / 2).max(1);
        let to = match name {
            "ArrowUp" | "k" => (col, row - 1),
            "ArrowDown" | "j" => (col, row + 1),
            "ArrowLeft" | "h" => (col.saturating_sub(1), row),
            "ArrowRight" | "l" => (col + 1, row),
            "PageUp" => (col, row - i32::from(rows - 1).max(1)),
            "PageDown" => (col, row + i32::from(rows - 1).max(1)),
            "u" if ctrl => (col, row - half),
            "d" if ctrl => (col, row + half),
            "0" | "Home" => (0, row),
            "$" | "End" => (c.width(row).saturating_sub(1), row),
            "g" => (0, i32::from(i16::MIN)),
            "G" => (0, i32::from(rows) - 1),
            "w" | "b" | "e" => {
                let how = match name {
                    "w" => Word::Next,
                    "b" => Word::Back,
                    _ => Word::End,
                };
                match c.word(how) {
                    Some(to) => to,
                    None => return vec![],
                }
            }
            "/" => {
                if let Some(c) = self.copy.as_mut() {
                    c.query = Some(String::new());
                }
                return vec![];
            }
            "n" | "N" if !c.sought.is_empty() => return self.seek(&c.sought, name == "n"),
            "n" | "N" => {
                self.say("nothing was looked for yet: / and a text finds it", true);
                return vec![];
            }
            "v" if ctrl => {
                if let Some(c) = self.copy.as_mut() {
                    c.block ^= true;
                    c.mark = c.mark.or(Some(c.at));
                }
                return vec![];
            }
            "r" => {
                if let Some(c) = self.copy.as_mut() {
                    c.block ^= true;
                }
                return vec![];
            }
            "v" | " " => {
                if let Some(c) = self.copy.as_mut() {
                    c.mark = if c.mark.is_some() { None } else { Some(c.at) };
                }
                return vec![];
            }
            "y" | "Enter" => return self.copy_out(),
            "Escape" | "q" => return self.copy_end(),
            _ => return vec![],
        };
        self.copy_go(to)
    }

    /// A screen of the terminal in copy mode arrived, `back` rows up: its rows are remembered,
    /// and a cursor above the top of what is kept comes down to it. A find going on up goes on
    /// with the rows that came, until the top of what is kept.
    pub(super) fn copy_took(&mut self, id: &str, screen: &Screen, back: u16) -> Vec<Want> {
        let asked = self.backs.get(id).copied().unwrap_or(0);
        let Some(c) = self.copy.as_mut().filter(|c| c.id == id) else { return vec![] };
        c.take(screen, back);
        c.at.1 = c.at.1.max(-i32::from(back));
        let Some((text, origin)) = c.hunt.clone() else { return vec![] };
        if c.find(&text, true).is_some() || back >= asked {
            return self.seek(&text, true);
        }
        // The top of what is kept, and it is not there: back where the find began.
        if let Some(c) = self.copy.as_mut() {
            c.hunt = None;
        }
        self.backs.insert(id.to_string(), back);
        self.say(format!("'{text}' is not in what is kept"), true);
        self.copy_go(origin)
    }

    /// The cell of the pane in focus under (`x`, `y`) on the screen, when it is inside it.
    pub(super) fn copy_cell(&self, x: u16, y: u16) -> Option<Cell> {
        let room = self.tabs.shown(self.main()).into_iter().find(|(p, _, _)| *p == self.tabs.focus()).map(|(_, r, _)| super::draw::inner(r))?;
        let Inside::Terminal(id) = inside(self.shown()) else { return None };
        let inside_it = x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height;
        let back = self.backs.get(&id).copied().unwrap_or(0);
        inside_it.then(|| (x - room.x, i32::from(y - room.y) - i32::from(back)))
    }

    /// The mouse held down over the pane in focus at `from` was dragged to `to`: a selection.
    pub(super) fn copy_drag(&mut self, from: Cell, to: (u16, u16)) -> Vec<Want> {
        let mut wants = vec![];
        if self.mode != Mode::Copy {
            wants = self.copy_begin(Some(from), true);
        }
        let room = self.tabs.shown(self.main()).into_iter().find(|(p, _, _)| *p == self.tabs.focus()).map(|(_, r, _)| super::draw::inner(r)).unwrap_or_default();
        let back = self.copy.as_ref().and_then(|c| self.backs.get(&c.id)).copied().unwrap_or(0);
        let x = to.0.clamp(room.x, (room.x + room.width).saturating_sub(1)) - room.x;
        let y = i32::from(to.1) - i32::from(room.y) - i32::from(back);
        wants.extend(self.copy_go((x, y)));
        wants
    }

    /// The mouse let go: a selection made by dragging is copied.
    pub(super) fn copy_let_go(&mut self) -> Vec<Want> {
        match &self.copy {
            Some(c) if c.mouse => self.copy_out(),
            _ => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(rows: &[(i32, &str)]) -> Copy {
        Copy { id: "1".into(), lines: rows.iter().map(|(r, t)| (*r, t.to_string())).collect(), ..Default::default() }
    }

    #[test]
    fn what_is_selected_is_the_text_from_the_mark_to_the_cursor_either_way() {
        let mut c = seen(&[(-2, "older row   "), (-1, "$ echo hello"), (0, "hello"), (1, "$ ")]);
        assert_eq!(c.text(), "", "nothing selected yet");
        (c.mark, c.at) = (Some((2, -1)), (2, 0));
        assert_eq!(c.text(), "echo hello\nhel", "from the mark, through the cursor's own cell");
        (c.mark, c.at) = (Some((4, 0)), (0, -2));
        assert_eq!(c.text(), "older row\n$ echo hello\nhello", "backwards is the same; spaces at a row's end go");
        (c.mark, c.at) = (Some((6, 0)), (30, 0));
        assert_eq!(c.text(), "", "past the end of a row there is nothing");
        assert_eq!(c.width(-1), 12);
        (c.block, c.mark, c.at) = (true, Some((2, -2)), (5, 0));
        assert_eq!(c.text(), "der\necho\nllo", "a rectangle: the same columns of each row");
    }

    #[test]
    fn words_are_found_between_spaces_and_a_text_upwards_and_down() {
        let mut c = seen(&[(-1, "git commit -m wip"), (0, "  cargo test --quiet"), (1, "$ ")]);
        c.at = (0, -1);
        let mut walk = |how| {
            let to = c.word(how);
            c.at = to.unwrap_or(c.at);
            to
        };
        assert_eq!((walk(Word::Next), walk(Word::Next), walk(Word::End), walk(Word::Next)), (Some((4, -1)), Some((11, -1)), Some((12, -1)), Some((14, -1))));
        assert_eq!(walk(Word::Next), Some((2, 0)), "the next word may be on the next row, after its spaces");
        assert_eq!((walk(Word::Back), walk(Word::Back)), (Some((14, -1)), Some((11, -1))));
        c.at = (0, -1);
        assert_eq!(c.word(Word::Back), None, "nothing before the first word");
        c.at = (0, 1);
        assert_eq!((c.find("TEST", true), c.find("commit", true), c.find("nope", true)), (Some((8, 0)), Some((4, -1)), None), "upwards, whatever the case");
        c.at = (0, -1);
        assert_eq!((c.find("cargo", false), c.find("git", false)), (Some((2, 0)), None), "down: after the cursor only");
        assert_eq!(c.top(), -1);
    }
}
