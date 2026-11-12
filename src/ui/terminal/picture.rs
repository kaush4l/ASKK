//! # Picture: the app as the values `draw.rs` draws
//!
//! What the full screen shows is worked out here from what the app holds, once per draw:
//! which panes are in view and what each holds, the names of the tabs, the sidebar's groups,
//! the foot. Nothing is asked and nothing changes: it is the app, read.
use super::app::{App, Mode};
use super::draw::{Body, CopyView, Foot, Head, PaneView, Picture};
use crate::ui::features::terminals::{inside, Action, Inside};

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

    /// The boxes grouped by the place they run in, as herdr's Spaces: each group in the order
    /// of what needs the owner first, and the groups in the order of their first box.
    pub(super) fn groups(&self) -> Vec<(String, Vec<usize>)> {
        let mut out: Vec<(String, Vec<usize>)> = vec![];
        for (i, b) in self.boxes.iter().enumerate() {
            match out.iter_mut().find(|(place, _)| *place == b.place) {
                Some((_, list)) => list.push(i),
                None => out.push((b.place.clone(), vec![i])),
            }
        }
        out
    }

    /// The boxes in the order the sidebar lists them, as places in `boxes`.
    pub(super) fn listed(&self) -> Vec<usize> {
        self.groups().into_iter().flat_map(|(_, list)| list).collect()
    }

    /// Where in that list each place begins; none when every box runs in one place.
    pub(super) fn heads_at(&self) -> Vec<usize> {
        let groups = self.groups();
        if groups.len() < 2 {
            return vec![];
        }
        groups.iter().scan(0, |at, (_, list)| Some(std::mem::replace(at, *at + list.len()))).collect()
    }

    /// Each place's heading: its name, and its git state where it is a repository.
    fn heads(&self) -> Vec<Head> {
        let at = self.heads_at();
        self.groups()
            .into_iter()
            .zip(at)
            .map(|((place, _), at)| {
                let git = self.places.iter().find(|w| w.place == place).and_then(|w| w.git.clone());
                let name = if place.is_empty() { "workspace".to_string() } else { place };
                match git {
                    Some(g) => {
                        let mut state = if g.changed == 0 { "✓".to_string() } else { format!("● {}", g.changed) };
                        if g.ahead > 0 {
                            state.push_str(&format!(" ↑{}", g.ahead));
                        }
                        if g.behind > 0 {
                            state.push_str(&format!(" ↓{}", g.behind));
                        }
                        Head { at, name, git: format!("{} {state}", g.branch), clean: g.changed == 0 }
                    }
                    None => Head { at, name, git: String::new(), clean: true },
                }
            })
            .collect()
    }

    /// The screen as it stands, for `draw`.
    pub fn picture(&self) -> Picture<'_> {
        let focus = self.tabs.focus();
        let zoomed = self.tabs.tab().zoomed;
        let words = |lines: &[String]| Body::Words(lines.to_vec());
        let (choose, shell, close) = (self.keys.says(Action::Navigate), self.keys.says(Action::NewTab), self.keys.says(Action::ClosePane));
        let empty = ["This pane shows nothing yet.".to_string(), String::new(), format!("{choose}   choose a box in the sidebar (or click one)"), format!("{shell}   a new tab with a shell")];
        let panes = self
            .tabs
            .shown(self.main())
            .into_iter()
            .map(|(pane, at, box_id)| {
                let b = self.boxes.iter().find(|b| b.id == box_id);
                let gone = b.is_none() && self.known.contains(box_id);
                let mut copy = None;
                let body = match inside(box_id) {
                    _ if gone => words(&["This box is gone: its terminal was closed, or the service was restarted.".into(), String::new(), format!("{choose}   choose another box"), format!("{close}   close this pane")]),
                    Inside::Terminal(id) => match self.screens.get(&id) {
                        Some(screen) => {
                            let back = self.backs.get(&id).copied().unwrap_or(0);
                            if let Some(c) = self.copy.as_ref().filter(|c| c.id == id && pane == focus) {
                                let seen = |(col, row): (u16, i32)| (col, row + i32::from(back));
                                copy = Some(CopyView { cursor: seen(c.at), from: c.mark.map(seen), back });
                            }
                            Body::Screen(screen, back)
                        }
                        None => words(&["…".into()]),
                    },
                    Inside::Engine(_) | Inside::Session(_) => match self.talks.get(box_id) {
                        Some(t) => Body::Talk { lines: &t.lines, input: &t.input, back: t.back },
                        None => words(&["…".into()]),
                    },
                    Inside::Other if self.opening.contains_key(&pane) => words(&["starting a shell…".into()]),
                    Inside::Other => words(&empty),
                };
                let head = match b {
                    Some(b) => format!("{} · {}", b.title, b.kind),
                    None => self.name_of(box_id),
                };
                PaneView { at, focused: pane == focus && self.mode != Mode::Side, head, mark: b.map(|b| self.seen.mark(b)), zoomed, body, copy }
            })
            .collect();
        Picture {
            host: &self.host,
            boxes: self.listed().into_iter().map(|i| &self.boxes[i]).collect(),
            heads: self.heads(),
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
                Mode::Copy => Foot::Copy,
            },
            prefix: self.keys.prefix(),
            hints: self.keys.hints(),
            keys: if self.help { self.keys.help() } else { vec![] },
            forget: self.keys.says(Action::EndTerminal),
            note: &self.note,
            note_bad: self.note_bad,
            help: self.help,
        }
    }
}
