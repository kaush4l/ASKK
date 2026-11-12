//! # Tell: a box that comes to need the owner while it is not shown
//!
//! herdr tells when an agent finishes or needs you, and each client keeps its own "done".
//! So does this window: when a box comes to wait for the owner (blocked), fails, or is done
//! (it was seen working and is idle now) while no pane in view shows it, the window
//!
//! - says so in the foot, in one sentence;
//! - marks its row in the sidebar with `◆` until a pane shows it, or it is working again;
//! - tells the outer terminal as `terminal.notify` in `settings.json` says: `bell` rings
//!   it (BEL), `osc9` and `osc777` ask it for a desktop notification (OSC 9, as iTerm2,
//!   WezTerm, kitty and Windows Terminal take it; OSC 777, as foot, WezTerm and urxvt do);
//!   `off` tells nothing beyond the foot and the mark.
//!
//! A box that already waited when the window opened is not told: only a change is, and a
//! box that appears later already waiting.
use super::app::{App, Want};
use crate::core::boxes::SessionBox;
use crate::ui::features::boxes::Mark;
use std::collections::BTreeMap;

/// The marks that are told.
fn told(mark: Mark) -> bool {
    matches!(mark, Mark::Blocked | Mark::Failed | Mark::Done)
}

impl App {
    /// The marks of the boxes as this window showed them, before a new list is taken in.
    pub(super) fn marks(&self) -> BTreeMap<String, Mark> {
        self.boxes.iter().map(|b| (b.id.clone(), self.seen.mark(b))).collect()
    }

    /// Whether a pane of the tab shown shows `box_id`.
    pub(super) fn in_view(&self, box_id: &str) -> bool {
        self.tabs.shown(self.main()).iter().any(|(_, _, b)| *b == box_id)
    }

    /// After a new list was taken in: what to tell, against the marks `before` it.
    pub(super) fn tell(&mut self, before: &BTreeMap<String, Mark>) -> Vec<Want> {
        let changed: Vec<(SessionBox, Mark)> = self
            .boxes
            .iter()
            .map(|b| (b, self.seen.mark(b)))
            .filter(|(b, now)| told(*now) && before.get(&b.id) != Some(now) && !self.in_view(&b.id))
            .map(|(b, now)| (b.clone(), now))
            .collect();
        // A mark stays while the box still needs the owner, and nobody has looked.
        let needs: Vec<String> = self.boxes.iter().filter(|b| told(self.seen.mark(b))).map(|b| b.id.clone()).collect();
        self.rung.retain(|id| needs.contains(id));
        let mut wants = vec![];
        for (b, mark) in changed {
            self.rung.insert(b.id.clone());
            let body = format!("{} · {} {}", b.title, b.kind, mark.word());
            self.say(format!("◆ {body}"), mark != Mark::Done);
            let t = &self.look_of;
            if t.notify.trim() != "off" {
                wants.push(Want::Tell { bell: t.tells("bell"), osc9: t.tells("osc9"), osc777: t.tells("osc777"), title: "askk".into(), body });
            }
        }
        wants
    }

    /// The boxes in view have been seen: their marks go.
    pub(super) fn unmark_in_view(&mut self) {
        let shown: Vec<String> = self.tabs.shown(self.main()).iter().map(|(_, _, b)| b.to_string()).collect();
        self.rung.retain(|id| !shown.contains(id));
    }
}
