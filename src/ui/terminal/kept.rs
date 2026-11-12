//! # Kept: what a window finds when it opens
//!
//! herdr's server keeps the layout and gives it back; so does askk's service. A window that
//! opens asks for the layout the last one kept (`terminal_layout`) and for the boxes, and
//! once it has both it lays out again what it can:
//!
//! | it finds | it does |
//! | --- | --- |
//! | a kept layout, and nothing pressed yet | the same tabs and splits, the same focus, each pane on the box it showed |
//! | a pane on a box that is gone (the service was restarted, the terminal closed) | the pane stays, empty |
//! | a terminal that runs and is in no pane | a tab of its own (up to eight), as before there was a layout to keep |
//!
//! From then on, every change to the layout is kept again (`App::to_keep`, asked by
//! `client.rs` after each batch of events), so the next window finds it.
use super::app::{App, Want};
use super::panes::Tabs;
use crate::core::terminals::Layout;
use crate::ui::features::terminals::{inside, Inside};

/// How many terminals that were already running get a tab of their own when a window opens.
const TABS_BACK: usize = 8;

/// What a window has found so far.
#[derive(Clone, Debug, PartialEq)]
pub struct Opened {
    /// The tabs as a new window has them: a kept layout replaces only these.
    first: Tabs,
    layout: Option<Layout>,
    boxes: bool,
    found: bool,
    /// The layout the service keeps, as this window last knew it.
    pub kept: Option<Layout>,
    /// The keys have been read once (a later read that changes them is said).
    pub keys_read: bool,
}

impl Opened {
    pub fn new(first: &str) -> Opened {
        Opened { first: Tabs::new(first), layout: None, boxes: false, found: false, kept: None, keys_read: false }
    }

    /// The boxes have come once.
    pub fn has_boxes(&self) -> bool {
        self.boxes
    }

    /// Both the layout and the boxes have come, and what could be laid out again was.
    pub fn done(&self) -> bool {
        self.found
    }
}

impl App {
    /// The kept layout came (empty when none is kept, or it could not be asked for).
    pub(super) fn found_layout(&mut self, layout: Layout) -> Vec<Want> {
        if self.opened.layout.is_some() {
            return vec![];
        }
        self.opened.kept = Some(layout.clone());
        self.opened.layout = Some(layout);
        if self.opened.boxes {
            return self.found();
        }
        vec![]
    }

    /// The boxes came.
    pub(super) fn found_boxes(&mut self) -> Vec<Want> {
        if self.opened.boxes {
            return vec![];
        }
        self.opened.boxes = true;
        if self.opened.layout.is_some() {
            return self.found();
        }
        vec![]
    }

    /// Lay out again what was kept, with what still runs.
    fn found(&mut self) -> Vec<Want> {
        self.opened.found = true;
        let layout = self.opened.layout.clone().unwrap_or_default();
        let untouched = self.tabs == self.opened.first;
        let restored = match Tabs::from_laid(&layout).filter(|_| untouched) {
            Some(tabs) => {
                self.tabs = tabs;
                true
            }
            None => false,
        };
        // A pane on a box that is no longer there is empty: there is nothing to show in it.
        let listed = |id: &str| self.boxes.iter().any(|b| b.id == id);
        let gone: Vec<_> = self.tabs.every().into_iter().filter(|(_, b)| !b.is_empty() && !listed(b)).map(|(p, _)| p).collect();
        for pane in gone {
            self.tabs.show(pane, "");
        }
        // Each terminal that runs and is in no pane gets a tab of its own.
        let shown: Vec<String> = self.tabs.every().into_iter().map(|(_, b)| b.to_string()).collect();
        let at = self.tabs.at;
        let left: Vec<String> = self.boxes.iter().filter(|b| matches!(inside(&b.id), Inside::Terminal(_)) && !shown.contains(&b.id)).map(|b| b.id.clone()).collect();
        // The order a terminal was opened in, as the service lists them: oldest first.
        let mut left = left;
        left.sort_by_key(|id| id.trim_start_matches("terminal:").parse::<u64>().unwrap_or(u64::MAX));
        for id in left.into_iter().take(TABS_BACK) {
            let pane = self.tabs.new_tab();
            self.tabs.show(pane, &id);
        }
        self.tabs.at = at;
        if restored {
            if restored_note(&layout) {
                self.note = "the tabs and splits of the last window are laid out again".into();
            }
            return self.look();
        }
        vec![]
    }
}

/// Whether a layout is worth saying was laid out again: more than one pane.
fn restored_note(layout: &Layout) -> bool {
    layout.tabs.len() > 1 || layout.tabs.iter().any(|t| matches!(t.panes, crate::core::terminals::Laid::Split { .. }))
}
