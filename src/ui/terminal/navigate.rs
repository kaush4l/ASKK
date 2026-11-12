//! # Navigate: going over the boxes, places, panes and tabs without the prefix, and naming
//!
//! herdr's navigate mode. `ctrl+b w` (the keys table's `sidebar`) enters it and it stays
//! until Esc: each key moves, no prefix before it.
//!
//! | key | does |
//! | --- | --- |
//! | ↑ ↓ | the box above or below in the sidebar (herdr's workspace up and down) |
//! | `[` `]` | the first box of the place before or after (a place is herdr's workspace) |
//! | h j k l, ← → | the pane on that side takes the focus |
//! | n p, Tab, 1-9 | the next or previous tab, or the one with that number |
//! | z | zoom the pane in focus, and back |
//! | m | the menu of the box chosen (`menu.rs`) |
//! | Enter | show the box chosen in the pane in focus, and leave |
//! | Esc, q | leave |
//!
//! Naming: `ctrl+b T` names the tab shown and `ctrl+b P` the pane in focus (herdr's
//! `rename_tab`, `rename_pane`), as do their menus. The foot becomes a line to type the name
//! into; Enter keeps it, Esc leaves it as it was, an empty name takes the name away. The
//! names are kept with the layout (`core/terminals.rs`, `LaidTab`).
use super::app::{App, Key, Mode, Want};
use super::panes::Pane;
use crate::core::terminals::NAME_MOST;
use crate::ui::features::terminals::Way;

/// What is being named.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Named {
    /// The tab with this place, from 0.
    Tab(usize),
    Pane(Pane),
}

/// A name being typed.
#[derive(Clone, Debug, PartialEq)]
pub struct Naming {
    pub what: Named,
    pub text: String,
}

impl App {
    /// A key in navigate mode.
    pub(super) fn navigate_key(&mut self, k: &Key) -> Vec<Want> {
        let listed = self.listed();
        let main = self.main();
        let way = match k.name.as_str() {
            "h" | "ArrowLeft" => Some(Way::Left),
            "l" | "ArrowRight" => Some(Way::Right),
            "k" => Some(Way::Up),
            "j" => Some(Way::Down),
            _ => None,
        };
        if let Some(way) = way {
            self.tabs.tab_mut().go(way, main);
            return self.look();
        }
        match k.name.as_str() {
            "ArrowUp" => self.side_at = self.side_at.saturating_sub(1),
            "ArrowDown" => self.side_at = (self.side_at + 1).min(listed.len().saturating_sub(1)),
            "[" | "]" => {
                let starts = self.heads_at();
                let next = if k.name == "]" { starts.iter().find(|s| **s > self.side_at).copied() } else { starts.iter().rev().find(|s| **s < self.side_at).copied() };
                match next {
                    Some(at) => self.side_at = at,
                    None if starts.is_empty() => self.say("every box runs in one place", false),
                    None => self.say(if k.name == "]" { "this is the last place" } else { "this is the first place" }, false),
                }
            }
            "n" | "Tab" => {
                self.tabs.turn(1);
                return self.look();
            }
            "p" => {
                self.tabs.turn(-1);
                return self.look();
            }
            "z" => self.tabs.tab_mut().zoomed ^= true,
            "m" => {
                let id = listed.get(self.side_at).map(|i| self.boxes[*i].id.clone()).unwrap_or_default();
                let row = super::draw::parts(self.area, self.side_open).side.y + super::draw::SIDE_HEAD;
                return self.box_menu(&id, (2, row));
            }
            "Enter" => {
                if let Some(id) = listed.get(self.side_at).map(|i| self.boxes[*i].id.clone()) {
                    return self.show(&id);
                }
                self.mode = Mode::Pane;
            }
            "Escape" | "q" => self.mode = Mode::Pane,
            n if n.len() == 1 && n.chars().all(|c| c.is_ascii_digit() && c != '0') => {
                let number = n.parse().unwrap_or(1);
                if !self.tabs.go_to(number) {
                    self.say(format!("there is no tab {number}"), true);
                }
                return self.look();
            }
            _ => {}
        }
        vec![]
    }

    /// Begin naming the tab or the pane, with its name as it is.
    pub(super) fn naming_begin(&mut self, what: Named) {
        let text = match what {
            Named::Tab(i) => self.tabs.tabs.get(i).map(|t| t.name.clone()).unwrap_or_default(),
            Named::Pane(p) => self.tabs.pane_name(p).unwrap_or_default().to_string(),
        };
        self.naming = Some(Naming { what, text });
    }

    /// A key while a name is typed.
    pub(super) fn naming_key(&mut self, k: &Key) -> Vec<Want> {
        let Some(n) = self.naming.as_mut() else { return vec![] };
        match k.name.as_str() {
            "Enter" => {
                let Some(Naming { what, text }) = self.naming.take() else { return vec![] };
                let name = text.trim().to_string();
                let said = match what {
                    Named::Tab(i) => {
                        if let Some(t) = self.tabs.tabs.get_mut(i) {
                            t.name = name.clone();
                        }
                        "the tab"
                    }
                    Named::Pane(p) => {
                        self.tabs.name_pane(p, &name);
                        "the pane"
                    }
                };
                self.say(if name.is_empty() { format!("{said} has no name now") } else { format!("{said} is called {name}") }, false);
            }
            "Escape" => self.naming = None,
            "Backspace" => {
                n.text.pop();
            }
            "u" if k.ctrl => n.text.clear(),
            c if !k.ctrl && !k.alt && c.chars().count() == 1 && n.text.chars().count() < NAME_MOST => n.text.push_str(c),
            _ => {}
        }
        vec![]
    }
}
