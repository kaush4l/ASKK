//! # Copy: moving over a terminal's pane and what scrolled off it, selecting, copying
//!
//! tmux's and herdr's copy mode. `ctrl+b [` (the keys table's `copy_mode`) stops the pane
//! where it is and puts a cursor of its own on it; the cursor moves over the screen and up
//! into what scrolled off the top (`terminal_scrolled`), `v` starts a selection there, and
//! `y` or Enter copies what is selected to the outer terminal's clipboard (OSC 52, written
//! by `client.rs`). Esc or `q` leaves. Dragging the mouse over a terminal's pane selects the
//! same way, and letting go copies.
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

    /// What is selected, as text: rows end with a line end, and spaces at a row's end go.
    pub fn text(&self) -> String {
        let Some(((c0, r0), (c1, r1))) = self.selection() else { return String::new() };
        let mut rows = vec![];
        for r in r0..=r1 {
            let line: Vec<char> = self.lines.get(&r).map(|l| l.chars().collect()).unwrap_or_default();
            let from = if r == r0 { usize::from(c0) } else { 0 };
            let to = if r == r1 { (usize::from(c1) + 1).min(line.len()) } else { line.len() };
            rows.push(line.get(from.min(to)..to).map(|s| s.iter().collect::<String>()).unwrap_or_default().trim_end().to_string());
        }
        rows.join("\n")
    }

    /// The length of row `r`, as far as it is known.
    fn width(&self, r: i32) -> u16 {
        self.lines.get(&r).map(|l| l.trim_end().chars().count() as u16).unwrap_or(0)
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

    /// A key in copy mode.
    pub(super) fn copy_key(&mut self, name: &str, ctrl: bool) -> Vec<Want> {
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
    /// and a cursor above the top of what is kept comes down to it.
    pub(super) fn copy_took(&mut self, id: &str, screen: &Screen, back: u16) {
        if let Some(c) = self.copy.as_mut().filter(|c| c.id == id) {
            c.take(screen, back);
            c.at.1 = c.at.1.max(-i32::from(back));
        }
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
    }
}
