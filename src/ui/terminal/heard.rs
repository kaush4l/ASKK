//! # Heard: what the service says, taken in
//!
//! The change feed names keys (`terminals/3`, `settings.json`, `workspaces`, an engine's
//! path); [`App::changed`] says what to ask again because of them, and only for what is in
//! view. A terminal's screen arrives at its end or further up; [`App::took`] keeps it where
//! the pane looks, and leaves out what came too late.
use super::app::{App, Want};
use crate::core::screen::Screen;
use crate::ui::features::terminals::{inside, Inside};

impl App {
    /// What the change feed's keys mean for what is in view.
    pub(super) fn changed(&mut self, keys: &[String]) -> Vec<Want> {
        // The layout this window keeps is its own: hearing it back changes nothing.
        let keys: Vec<&String> = keys.iter().filter(|k| *k != crate::core::terminals::LAYOUT && !k.starts_with(crate::core::terminals::SESSIONS)).collect();
        if keys.is_empty() {
            return vec![];
        }
        let mut wants = vec![Want::Boxes];
        if keys.iter().any(|k| *k == crate::core::settings::KEY) {
            wants.push(Want::Keys);
        }
        let other = keys.iter().any(|k| !k.starts_with("terminals/") && *k != crate::core::workspaces::KEY && *k != crate::core::settings::KEY);
        for (_, _, box_id) in self.tabs.shown(self.main()) {
            match inside(box_id) {
                Inside::Terminal(id) if keys.iter().any(|k| **k == crate::core::terminals::key(&id)) => wants.push(self.screen(id)),
                Inside::Engine(_) | Inside::Session(_) if other => wants.push(Want::Talk(box_id.to_string())),
                _ => {}
            }
        }
        wants
    }

    /// A terminal's screen arrived, `back` rows up (`None`: at its end).
    pub(super) fn took(&mut self, id: String, screen: Screen, back: Option<u16>) -> Vec<Want> {
        let copying = self.copy.as_ref().is_some_and(|c| c.id == id);
        let mut wants = vec![];
        match back {
            // A screen of the end that arrives while the pane is looked back in is late.
            None if !self.backs.contains_key(&id) => {
                self.screens.insert(id, screen);
            }
            None => {}
            // No further up than there is: at 0 the pane is at its end again (unless it is
            // copied from: then it stands still where it is).
            Some(back) => {
                if copying {
                    wants = self.copy_took(&id, &screen, back);
                    if !wants.iter().any(|w| matches!(w, Want::Scrolled { .. })) {
                        self.backs.insert(id.clone(), back);
                    }
                    self.screens.insert(id, screen);
                } else if back == 0 {
                    self.backs.remove(&id);
                    self.screens.insert(id, screen);
                } else if self.backs.contains_key(&id) {
                    // A look back that arrives after the pane returned to its end is late.
                    self.backs.insert(id.clone(), back);
                    self.screens.insert(id, screen);
                }
            }
        }
        wants
    }

}
