//! # Menu: what a right-click opens
//!
//! herdr's right-click menus, drawn in the full screen over what is under them:
//!
//! | on | it offers |
//! | --- | --- |
//! | a pane | split right, split down, zoom, rename, copy mode and copy what it shows (a terminal), open its box in a new tab, close the pane, end its terminal |
//! | a tab's name | a new tab, rename, close the tab |
//! | a box in the sidebar | show it here, open it in a new tab, split right with it, copy its name or its last line, end its terminal |
//! | a place's heading | show its first box, open that in a new tab, copy the place's name, fold the sidebar |
//!
//! `ctrl+b m` opens the pane's menu from the keys, and `m` in navigate mode the menu of the
//! box chosen there. ↑ ↓ (or j k) choose, Enter does it, Esc or q leaves; a click on a line
//! does it, a click anywhere else leaves.
use super::app::{App, Key, Mode, Want};
use super::panes::{Dir, Pane};
use crate::ui::features::terminals::{inside, terminal_box, Action, Inside};
use ratatui::layout::Rect;

/// What a line of a menu does.
#[derive(Clone, Debug, PartialEq)]
pub enum Item {
    Split(Pane, Dir),
    Zoom(Pane),
    RenamePane(Pane),
    CopyMode(Pane),
    /// Copy what the terminal with this id shows.
    CopyScreen(String),
    /// A new tab that shows this box.
    NewTabWith(String),
    ClosePane(Pane),
    EndTerminal(String),
    NewTab,
    RenameTab(usize),
    CloseTab(usize),
    /// Show this box in the pane in focus.
    Show(String),
    /// Split the pane in focus to the right, the new half showing this box.
    SplitWith(String),
    /// Put this text on the clipboard.
    CopyText(String, &'static str),
    FoldSidebar,
}

/// An open menu: its title, the cell it was opened at, its lines, the one chosen.
#[derive(Clone, Debug, PartialEq)]
pub struct Menu {
    pub title: String,
    pub at: (u16, u16),
    pub items: Vec<(String, Item)>,
    pub chosen: usize,
}

impl Menu {
    /// Where it is drawn in `area`: at the cell it was opened at, moved in to fit.
    pub fn rect(&self, area: Rect) -> Rect {
        let wide = self.items.iter().map(|(l, _)| l.chars().count()).chain([self.title.chars().count() + 2]).max().unwrap_or(0) as u16 + 4;
        let (w, h) = (wide.min(area.width), (self.items.len() as u16 + 2).min(area.height));
        let x = self.at.0.min(area.x + area.width - w);
        let y = self.at.1.min(area.y + area.height - h);
        Rect { x, y, width: w, height: h }
    }
}

impl App {
    /// The menu of `pane`, opened at `at`.
    pub(super) fn pane_menu(&mut self, pane: Pane, at: (u16, u16)) -> Vec<Want> {
        let box_id = self.tabs.shown_in(pane).to_string();
        let zoomed = self.tabs.tab().zoomed && self.tabs.focus() == pane;
        let mut items = vec![("split right".to_string(), Item::Split(pane, Dir::Right)), ("split down".into(), Item::Split(pane, Dir::Down)), (if zoomed { "unzoom" } else { "zoom" }.into(), Item::Zoom(pane)), ("rename this pane".into(), Item::RenamePane(pane))];
        if let Inside::Terminal(id) = inside(&box_id) {
            items.push(("copy mode".into(), Item::CopyMode(pane)));
            items.push(("copy what it shows".into(), Item::CopyScreen(id)));
        }
        if !box_id.is_empty() {
            items.push(("open in a new tab".into(), Item::NewTabWith(box_id.clone())));
        }
        items.push(("close the pane".into(), Item::ClosePane(pane)));
        if let Inside::Terminal(id) = inside(&box_id) {
            items.push(("end its terminal".into(), Item::EndTerminal(id)));
        }
        let title = self.tabs.pane_name(pane).map(String::from).unwrap_or_else(|| self.tab_names_of(&box_id));
        self.open_menu(format!("pane · {title}"), at, items)
    }

    pub(super) fn tab_menu(&mut self, tab: usize, at: (u16, u16)) -> Vec<Want> {
        let name = self.tab_names().get(tab).cloned().unwrap_or_default();
        let items = vec![("new tab".to_string(), Item::NewTab), ("rename this tab".into(), Item::RenameTab(tab)), ("close this tab".into(), Item::CloseTab(tab))];
        self.open_menu(format!("tab {} · {name}", tab + 1), at, items)
    }

    pub(super) fn box_menu(&mut self, box_id: &str, at: (u16, u16)) -> Vec<Want> {
        let Some(b) = self.boxes.iter().find(|b| b.id == box_id).cloned() else { return vec![] };
        let mut items = vec![("show it here".to_string(), Item::Show(b.id.clone())), ("open in a new tab".into(), Item::NewTabWith(b.id.clone())), ("split right with it".into(), Item::SplitWith(b.id.clone())), ("copy its name".into(), Item::CopyText(b.title.clone(), "its name"))];
        if !b.last.is_empty() {
            items.push(("copy its last line".into(), Item::CopyText(b.last.clone(), "its last line")));
        }
        if let Inside::Terminal(id) = inside(&b.id) {
            items.push(("end its terminal".into(), Item::EndTerminal(id)));
        }
        self.open_menu(format!("{} · {}", b.title, b.kind), at, items)
    }

    /// The menu of the place whose heading is the `group`th.
    pub(super) fn place_menu(&mut self, group: usize, at: (u16, u16)) -> Vec<Want> {
        let Some((place, list)) = self.groups().into_iter().nth(group) else { return vec![] };
        let Some(first) = list.first().map(|i| self.boxes[*i].id.clone()) else { return vec![] };
        let name = if place.is_empty() { "workspace".to_string() } else { place };
        let items = vec![("show its first box".to_string(), Item::Show(first.clone())), ("open that in a new tab".into(), Item::NewTabWith(first)), ("copy the place's name".into(), Item::CopyText(name.clone(), "the place's name")), ("fold the sidebar".into(), Item::FoldSidebar)];
        self.open_menu(format!("place · {name}"), at, items)
    }

    fn tab_names_of(&self, box_id: &str) -> String {
        self.boxes.iter().find(|b| b.id == box_id).map(|b| b.title.clone()).unwrap_or_else(|| if box_id.is_empty() { "empty".into() } else { box_id.to_string() })
    }

    fn open_menu(&mut self, title: String, at: (u16, u16), items: Vec<(String, Item)>) -> Vec<Want> {
        self.menu = Some(Menu { title, at, items, chosen: 0 });
        vec![]
    }

    /// A key while a menu is open.
    pub(super) fn menu_key(&mut self, k: &Key) -> Vec<Want> {
        let Some(m) = self.menu.as_mut() else { return vec![] };
        match k.name.as_str() {
            "ArrowUp" | "k" => m.chosen = m.chosen.saturating_sub(1),
            "ArrowDown" | "j" => m.chosen = (m.chosen + 1).min(m.items.len().saturating_sub(1)),
            "Enter" | " " => {
                let item = m.items.get(m.chosen).map(|(_, i)| i.clone());
                self.menu = None;
                return item.map(|i| self.pick(i)).unwrap_or_default();
            }
            "Escape" | "q" => self.menu = None,
            _ => {}
        }
        vec![]
    }

    /// A click while a menu is open: on a line it does it; anywhere else it leaves.
    pub(super) fn menu_click(&mut self, x: u16, y: u16) -> Vec<Want> {
        let Some(m) = self.menu.take() else { return vec![] };
        let r = m.rect(self.area);
        let row = y.checked_sub(r.y + 1).map(usize::from);
        match row.and_then(|i| m.items.get(i)).filter(|_| x > r.x && x + 1 < r.x + r.width) {
            Some((_, item)) => self.pick(item.clone()),
            None => vec![],
        }
    }

    /// Do what a line of a menu says.
    fn pick(&mut self, item: Item) -> Vec<Want> {
        let focus = |app: &mut App, pane: Pane| {
            if app.tabs.tab().panes().contains(&pane) {
                app.tabs.tab_mut().focus = pane;
            }
        };
        match item {
            Item::Split(pane, dir) => {
                focus(self, pane);
                self.act(if dir == Dir::Right { Action::SplitRight } else { Action::SplitDown })
            }
            Item::Zoom(pane) => {
                focus(self, pane);
                self.act(Action::Zoom)
            }
            Item::RenamePane(pane) => {
                focus(self, pane);
                self.act(Action::RenamePane)
            }
            Item::CopyMode(pane) => {
                focus(self, pane);
                self.act(Action::CopyMode)
            }
            Item::ClosePane(pane) => {
                focus(self, pane);
                self.act(Action::ClosePane)
            }
            Item::CopyScreen(id) => match self.screens.get(&id).map(|s| s.text().trim_end().to_string()) {
                Some(text) if !text.is_empty() => {
                    self.say(format!("copied what it shows ({} characters) to the clipboard", text.chars().count()), false);
                    vec![Want::Copy(text)]
                }
                _ => {
                    self.say("it shows nothing to copy", true);
                    vec![]
                }
            },
            Item::CopyText(text, what) => {
                self.say(format!("copied {what} to the clipboard"), false);
                vec![Want::Copy(text)]
            }
            Item::NewTabWith(box_id) => {
                let pane = self.tabs.new_tab();
                self.tabs.show(pane, &box_id);
                self.mode = Mode::Pane;
                self.look()
            }
            Item::EndTerminal(id) => {
                let gone = terminal_box(&id);
                for pane in self.tabs.every().into_iter().filter(|(_, b)| *b == gone).map(|(p, _)| p).collect::<Vec<_>>() {
                    self.tabs.show(pane, "");
                }
                vec![Want::Close(id)]
            }
            Item::NewTab => self.act(Action::NewTab),
            Item::RenameTab(tab) => {
                self.tabs.go_to(tab + 1);
                self.act(Action::RenameTab)
            }
            Item::CloseTab(tab) => {
                self.tabs.close_tab(tab);
                self.look()
            }
            Item::Show(box_id) => self.show(&box_id),
            Item::SplitWith(box_id) => match self.tabs.split(Dir::Right, self.main()) {
                Ok(pane) => {
                    self.tabs.show(pane, &box_id);
                    self.mode = Mode::Pane;
                    self.look()
                }
                Err(e) => {
                    self.say(e, true);
                    vec![]
                }
            },
            Item::FoldSidebar => {
                self.side_open ^= true;
                vec![]
            }
        }
    }
}
