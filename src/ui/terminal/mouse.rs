//! # Mouse: what a click, a drag and the wheel do in the full screen
//!
//! | over | down | drag | wheel |
//! | --- | --- | --- | --- |
//! | the sidebar's head | folds it, and opens it | | |
//! | a box in the sidebar | shows it in the pane in focus | | |
//! | a tab's name | shows that tab | | |
//! | a pane | takes the focus there | inside a terminal's pane: selects, and letting go copies (`copy.rs`); on a border: moves it | looks back up, and down again |
//!
//! The mouse is the window's, never the program's.
use super::app::{App, Mode, Mouse, Want};
use super::draw;
use ratatui::layout::Rect;

impl App {
    pub(super) fn mouse(&mut self, m: Mouse) -> Vec<Want> {
        let at = draw::parts(self.area, self.side_open);
        let within = |r: Rect, x: u16, y: u16| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        match m {
            Mouse::Down(..) if self.help => self.help = false,
            Mouse::Down(..) if self.mode == Mode::Copy => return self.copy_end(),
            Mouse::Down(x, y) if within(at.side, x, y) => {
                // The head of the sidebar folds it and opens it; a row shows its box.
                if y == at.side.y {
                    self.side_open ^= true;
                } else if let Some(id) = draw::side_row(at.side, self.side_open, &self.heads_at(), self.listed().len(), self.side_at, y).and_then(|i| self.listed().get(i).copied()).map(|i| self.boxes[i].id.clone()) {
                    return self.show(&id);
                }
            }
            Mouse::Down(x, y) if within(at.tabs, x, y) => {
                if let Some(i) = draw::tab_at(at.tabs, &self.tab_names(), x) {
                    self.tabs.go_to(i + 1);
                    return self.look();
                }
            }
            Mouse::Down(x, y) if within(at.main, x, y) => {
                self.dragging = Some((x, y));
                if let Some(pane) = self.tabs.tab().at(at.main, x, y) {
                    self.tabs.tab_mut().focus = pane;
                    self.mode = Mode::Pane;
                    self.pressed = self.copy_cell(x, y);
                    return self.look();
                }
            }
            Mouse::Drag(x, y) => {
                if let Some(from) = self.pressed {
                    return self.copy_drag(from, (x, y));
                }
                if let Some(from) = self.dragging {
                    if self.tabs.tab_mut().drag(at.main, from, (x, y)) {
                        self.dragging = Some((x, y));
                    }
                }
            }
            Mouse::Up => {
                (self.dragging, self.pressed) = (None, None);
                return self.copy_let_go();
            }
            Mouse::Wheel(up, x, y) => {
                let over = self.tabs.tab().at(at.main, x, y).map(|p| self.tabs.shown_in(p).to_string()).unwrap_or_default();
                return self.scroll(&over, up, 3);
            }
            _ => {}
        }
        vec![]
    }

}
