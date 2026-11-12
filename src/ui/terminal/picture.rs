//! # Picture: the app as the values `draw.rs` draws
//!
//! What the full screen shows is worked out here from what the app holds, once per draw:
//! which panes are in view and what each holds, the names of the tabs, the foot. Nothing is
//! asked and nothing changes: it is the app, read.
use super::app::{App, Mode};
use super::draw::{Body, Foot, PaneView, Picture};
use crate::ui::features::terminals::{inside, Inside};

const EMPTY: [&str; 4] = ["This pane shows nothing yet.", "", "ctrl+b w   choose a box in the sidebar (or click one)", "ctrl+b c   a new tab with a shell"];

impl App {
    pub(super) fn tab_names(&self) -> Vec<String> {
        self.tabs.tabs.iter().map(|t| self.name_of(self.tabs.shown_in(t.focus))).collect()
    }

    fn name_of(&self, box_id: &str) -> String {
        match self.boxes.iter().find(|b| b.id == box_id) {
            Some(b) => b.title.clone(),
            None if box_id.is_empty() => "empty".into(),
            None => box_id.to_string(),
        }
    }

    /// The screen as it stands, for `draw`.
    pub fn picture(&self) -> Picture<'_> {
        let focus = self.tabs.focus();
        let zoomed = self.tabs.tab().zoomed;
        let words = |lines: &[&str]| Body::Words(lines.iter().map(|l| l.to_string()).collect());
        let panes = self
            .tabs
            .shown(self.main())
            .into_iter()
            .map(|(pane, at, box_id)| {
                let b = self.boxes.iter().find(|b| b.id == box_id);
                let gone = b.is_none() && self.known.contains(box_id);
                let body = match inside(box_id) {
                    _ if gone => words(&["This box is gone: its terminal was closed, or the service was restarted.", "", "ctrl+b w   choose another box", "ctrl+b x   close this pane"]),
                    Inside::Terminal(id) => match self.screens.get(&id) {
                        Some(screen) => Body::Screen(screen, self.backs.get(&id).copied().unwrap_or(0)),
                        None => words(&["…"]),
                    },
                    Inside::Engine(_) | Inside::Session(_) => match self.talks.get(box_id) {
                        Some(t) => Body::Talk { lines: &t.lines, input: &t.input, back: t.back },
                        None => words(&["…"]),
                    },
                    Inside::Other if self.opening.contains_key(&pane) => words(&["starting a shell…"]),
                    Inside::Other => words(&EMPTY),
                };
                let head = match b {
                    Some(b) => format!("{} · {}", b.title, b.kind),
                    None => self.name_of(box_id),
                };
                PaneView { at, focused: pane == focus && self.mode != Mode::Side, head, mark: b.map(|b| self.seen.mark(b)), zoomed, body }
            })
            .collect();
        Picture {
            host: &self.host,
            boxes: &self.boxes,
            seen: &self.seen,
            side_open: self.side_open,
            side_at: self.side_at,
            shown: self.shown(),
            tabs: self.tab_names(),
            tab: self.tabs.at,
            panes,
            foot: match self.mode {
                Mode::Pane => Foot::Pane,
                Mode::Prefix => Foot::Prefix,
                Mode::Side => Foot::Side,
            },
            note: &self.note,
            note_bad: self.note_bad,
            help: self.help,
        }
    }
}
