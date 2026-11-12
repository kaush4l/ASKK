//! # Panes: tabs of split panes, as plain values
//!
//! What herdr calls a tab: a layout of panes, split right or down, with one pane in focus
//! and, at times, zoomed to fill the tab. Nothing here draws or asks: a [`Tab`] is a tree of
//! splits, and every question about it (where is each pane, which pane is at this cell, which
//! pane is to the left) is a function a test can read.
//!
//! - [`Tab`]: the tree, the pane in focus, whether it is zoomed.
//! - [`Tabs`]: the tabs, the one shown, and what each pane shows (a box's id).
//! - A pane is a number ([`Pane`]) that is never used twice, so an answer that arrives late
//!   for a pane that is gone finds nothing.
use crate::core::terminals::{Laid, LaidTab, Layout};
use crate::ui::features::terminals::Way;
use ratatui::layout::Rect;
use std::collections::BTreeMap;

pub type Pane = u32;

/// The smallest pane that can still show something: its frame and a few cells inside.
pub const LEAST: (u16, u16) = (12, 4);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    /// Side by side: the new pane is to the right.
    Right,
    /// One above the other: the new pane is below.
    Down,
}

#[derive(Clone, Debug, PartialEq)]
enum Node {
    Leaf(Pane),
    /// Two halves; `share` is what the first gets, in parts of a thousand.
    Split { dir: Dir, share: u16, first: Box<Node>, second: Box<Node> },
}

/// The two parts of `area` a split makes.
fn halves(area: Rect, dir: Dir, share: u16) -> (Rect, Rect) {
    let part = |whole: u16| ((u32::from(whole) * u32::from(share) + 500) / 1000) as u16;
    match dir {
        Dir::Right => {
            let w = part(area.width).min(area.width);
            (Rect { width: w, ..area }, Rect { x: area.x + w, width: area.width - w, ..area })
        }
        Dir::Down => {
            let h = part(area.height).min(area.height);
            (Rect { height: h, ..area }, Rect { y: area.y + h, height: area.height - h, ..area })
        }
    }
}

impl Node {
    fn place(&self, area: Rect, out: &mut Vec<(Pane, Rect)>) {
        match self {
            Node::Leaf(p) => out.push((*p, area)),
            Node::Split { dir, share, first, second } => {
                let (a, b) = halves(area, *dir, *share);
                first.place(a, out);
                second.place(b, out);
            }
        }
    }

    /// Put `new` beside `at`. False when `at` is not in this tree.
    fn split(&mut self, at: Pane, dir: Dir, new: Pane) -> bool {
        match self {
            Node::Leaf(p) if *p == at => {
                *self = Node::Split { dir, share: 500, first: Box::new(Node::Leaf(at)), second: Box::new(Node::Leaf(new)) };
                true
            }
            Node::Leaf(_) => false,
            Node::Split { first, second, .. } => first.split(at, dir, new) || second.split(at, dir, new),
        }
    }

    /// The tree without `gone`: the other half of its split takes the room. `None` when
    /// `gone` was all there was.
    fn without(self, gone: Pane) -> Option<Node> {
        match self {
            Node::Leaf(p) if p == gone => None,
            leaf @ Node::Leaf(_) => Some(leaf),
            Node::Split { dir, share, first, second } => match (first.without(gone), second.without(gone)) {
                (Some(a), Some(b)) => Some(Node::Split { dir, share, first: Box::new(a), second: Box::new(b) }),
                (one, other) => one.or(other),
            },
        }
    }

    /// Move the border under (`x`, `y`) to that cell: the split whose line between its halves
    /// was at `from` gets a new share. True when a border was there.
    fn drag(&mut self, area: Rect, from: (u16, u16), to: (u16, u16)) -> bool {
        let Node::Split { dir, share, first, second } = self else { return false };
        let (a, b) = halves(area, *dir, *share);
        let inside = |r: Rect, (x, y): (u16, u16)| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        // The border between two panes is the last cell of the first and the first of the second.
        let on_line = match dir {
            Dir::Right => inside(area, from) && (from.0 + 1 == b.x || from.0 == b.x),
            Dir::Down => inside(area, from) && (from.1 + 1 == b.y || from.1 == b.y),
        };
        if on_line {
            let (whole, at, least) = match dir {
                Dir::Right => (area.width, to.0.saturating_sub(area.x), LEAST.0),
                Dir::Down => (area.height, to.1.saturating_sub(area.y), LEAST.1),
            };
            if whole >= 2 * least {
                let at = at.clamp(least, whole - least);
                *share = ((u32::from(at) * 1000 + u32::from(whole) / 2) / u32::from(whole)) as u16;
            }
            return true;
        }
        if inside(a, from) {
            first.drag(a, from, to)
        } else {
            second.drag(b, from, to)
        }
    }
}

/// One tab: a layout of panes.
#[derive(Clone, Debug, PartialEq)]
pub struct Tab {
    root: Node,
    pub focus: Pane,
    pub zoomed: bool,
}

impl Tab {
    pub fn new(pane: Pane) -> Tab {
        Tab { root: Node::Leaf(pane), focus: pane, zoomed: false }
    }

    /// Every pane and where it is in `area`, in reading order; all of them, zoomed or not.
    pub fn all(&self, area: Rect) -> Vec<(Pane, Rect)> {
        let mut out = vec![];
        self.root.place(area, &mut out);
        out
    }

    /// The panes that are drawn: all of them, or only the one in focus when it is zoomed.
    pub fn shown(&self, area: Rect) -> Vec<(Pane, Rect)> {
        if self.zoomed {
            return vec![(self.focus, area)];
        }
        self.all(area)
    }

    pub fn panes(&self) -> Vec<Pane> {
        self.all(Rect::default()).into_iter().map(|(p, _)| p).collect()
    }

    /// Split the pane in focus; the new pane gets the focus. Refused, in a sentence, when
    /// the halves would be too small to show anything.
    pub fn split(&mut self, dir: Dir, new: Pane, area: Rect) -> Result<(), String> {
        let at = self.all(area).into_iter().find(|(p, _)| *p == self.focus).map(|(_, r)| r).unwrap_or(area);
        let (a, b) = halves(at, dir, 500);
        if [a, b].iter().any(|r| r.width < LEAST.0 || r.height < LEAST.1) {
            return Err(format!("this pane is too small to split {}: make the window larger, or close a pane (x)", if dir == Dir::Right { "to the right" } else { "downwards" }));
        }
        self.root.split(self.focus, dir, new);
        self.focus = new;
        self.zoomed = false;
        Ok(())
    }

    /// Take the pane in focus away. False when it was the last one: the tab itself goes.
    pub fn close(&mut self) -> bool {
        let before = self.panes();
        match self.root.clone().without(self.focus) {
            Some(rest) => {
                // The focus goes to the pane before the closed one, else to the first.
                let at = before.iter().position(|p| *p == self.focus).unwrap_or(0);
                self.root = rest;
                let left = self.panes();
                self.focus = left.get(at.saturating_sub(1)).or(left.first()).copied().unwrap_or(self.focus);
                self.zoomed = false;
                true
            }
            None => false,
        }
    }

    /// The pane at a cell.
    pub fn at(&self, area: Rect, x: u16, y: u16) -> Option<Pane> {
        self.shown(area).into_iter().find(|(_, r)| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height).map(|(p, _)| p)
    }

    /// Move the focus to the nearest pane on that side of the one in focus.
    pub fn go(&mut self, way: Way, area: Rect) {
        if self.zoomed {
            return;
        }
        let all = self.all(area);
        let Some(here) = all.iter().find(|(p, _)| *p == self.focus).map(|(_, r)| *r) else { return };
        // The middle of the pane in focus, and for each other pane how far its near edge is
        // on that side; panes that do not overlap it sideways are not "on that side".
        let overlap = |a0: u16, a1: u16, b0: u16, b1: u16| a0 < b1 && b0 < a1;
        let next = all
            .iter()
            .filter(|(p, _)| *p != self.focus)
            .filter_map(|(p, r)| {
                let far = match way {
                    Way::Left if r.x + r.width <= here.x && overlap(r.y, r.y + r.height, here.y, here.y + here.height) => here.x - (r.x + r.width),
                    Way::Right if r.x >= here.x + here.width && overlap(r.y, r.y + r.height, here.y, here.y + here.height) => r.x - (here.x + here.width),
                    Way::Up if r.y + r.height <= here.y && overlap(r.x, r.x + r.width, here.x, here.x + here.width) => here.y - (r.y + r.height),
                    Way::Down if r.y >= here.y + here.height && overlap(r.x, r.x + r.width, here.x, here.x + here.width) => r.y - (here.y + here.height),
                    _ => return None,
                };
                Some((far, *p))
            })
            .min();
        if let Some((_, pane)) = next {
            self.focus = pane;
        }
    }

    /// Drag the border at `from` to `to`. True when there was a border to drag.
    pub fn drag(&mut self, area: Rect, from: (u16, u16), to: (u16, u16)) -> bool {
        !self.zoomed && self.root.drag(area, from, to)
    }
}

/// Every tab, the one shown, and what each pane shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Tabs {
    pub tabs: Vec<Tab>,
    pub at: usize,
    next: Pane,
    /// The id of the box each pane shows; a pane not in here shows nothing yet.
    shows: BTreeMap<Pane, String>,
}

impl Tabs {
    /// One tab with one pane, showing `box_id` (empty = nothing yet).
    pub fn new(box_id: &str) -> Tabs {
        let mut t = Tabs { tabs: vec![Tab::new(1)], at: 0, next: 2, shows: BTreeMap::new() };
        t.show(1, box_id);
        t
    }

    pub fn tab(&self) -> &Tab {
        &self.tabs[self.at.min(self.tabs.len() - 1)]
    }

    pub fn tab_mut(&mut self) -> &mut Tab {
        let at = self.at.min(self.tabs.len() - 1);
        &mut self.tabs[at]
    }

    pub fn focus(&self) -> Pane {
        self.tab().focus
    }

    /// The box a pane shows; empty when it shows nothing.
    pub fn shown_in(&self, pane: Pane) -> &str {
        self.shows.get(&pane).map(String::as_str).unwrap_or_default()
    }

    pub fn show(&mut self, pane: Pane, box_id: &str) {
        if box_id.is_empty() {
            self.shows.remove(&pane);
        } else {
            self.shows.insert(pane, box_id.to_string());
        }
    }

    /// Whether `pane` is still there (an answer for it may arrive after it was closed).
    pub fn has(&self, pane: Pane) -> bool {
        self.tabs.iter().any(|t| t.panes().contains(&pane))
    }

    /// A new tab with one empty pane, shown at once. The pane's number comes back.
    pub fn new_tab(&mut self) -> Pane {
        let pane = self.fresh();
        self.tabs.push(Tab::new(pane));
        self.at = self.tabs.len() - 1;
        pane
    }

    fn fresh(&mut self) -> Pane {
        self.next += 1;
        self.next - 1
    }

    /// Split the pane in focus; the new, empty pane's number comes back.
    pub fn split(&mut self, dir: Dir, area: Rect) -> Result<Pane, String> {
        let pane = self.fresh();
        self.tab_mut().split(dir, pane, area)?;
        Ok(pane)
    }

    /// Close the pane in focus; a tab whose last pane closes goes too. False when it was the
    /// last pane of the last tab, which stays (empty): there is always somewhere to look.
    pub fn close(&mut self) -> bool {
        let gone = self.focus();
        if self.tab_mut().close() {
            self.shows.remove(&gone);
            return true;
        }
        if self.tabs.len() > 1 {
            self.tabs.remove(self.at.min(self.tabs.len() - 1));
            self.at = self.at.min(self.tabs.len() - 1);
            self.shows.remove(&gone);
            return true;
        }
        self.shows.remove(&gone);
        false
    }

    /// Go to the next (`+1`) or previous (`-1`) tab, round and round.
    pub fn turn(&mut self, by: isize) {
        let n = self.tabs.len() as isize;
        self.at = (self.at as isize + by).rem_euclid(n) as usize;
    }

    /// Go to the tab with this number, from 1. False when there is none.
    pub fn go_to(&mut self, number: usize) -> bool {
        let there = number >= 1 && number <= self.tabs.len();
        if there {
            self.at = number - 1;
        }
        there
    }

    /// The panes of the tab shown that are drawn, with where they are and what they show.
    pub fn shown(&self, area: Rect) -> Vec<(Pane, Rect, &str)> {
        self.tab().shown(area).into_iter().map(|(p, r)| (p, r, self.shown_in(p))).collect()
    }

    /// Every pane of every tab, with what it shows.
    pub fn every(&self) -> Vec<(Pane, &str)> {
        self.tabs.iter().flat_map(|t| t.panes()).map(|p| (p, self.shown_in(p))).collect()
    }

    /// The tabs as the service keeps them (`core/terminals.rs`, [`Layout`]): no pane numbers,
    /// only what each pane shows.
    pub fn laid(&self) -> Layout {
        fn node(n: &Node, shows: &BTreeMap<Pane, String>) -> Laid {
            match n {
                Node::Leaf(p) => Laid::Pane(shows.get(p).cloned().unwrap_or_default()),
                Node::Split { dir, share, first, second } => Laid::Split { down: *dir == Dir::Down, share: *share, first: Box::new(node(first, shows)), second: Box::new(node(second, shows)) },
            }
        }
        let tabs = self.tabs.iter().map(|t| LaidTab { panes: node(&t.root, &self.shows), focus: t.panes().iter().position(|p| *p == t.focus).unwrap_or(0), zoomed: t.zoomed }).collect();
        Layout { tabs, at: self.at.min(self.tabs.len().saturating_sub(1)) }
    }

    /// The tabs a kept layout lays out, with new pane numbers; `None` when it has no tabs.
    pub fn from_laid(layout: &Layout) -> Option<Tabs> {
        fn node(l: &Laid, t: &mut Tabs) -> Node {
            match l {
                Laid::Pane(box_id) => {
                    let p = t.fresh();
                    t.show(p, box_id);
                    Node::Leaf(p)
                }
                Laid::Split { down, share, first, second } => {
                    let first = Box::new(node(first, t));
                    Node::Split { dir: if *down { Dir::Down } else { Dir::Right }, share: (*share).clamp(1, 999), first, second: Box::new(node(second, t)) }
                }
            }
        }
        if layout.tabs.is_empty() {
            return None;
        }
        let mut t = Tabs { tabs: vec![], at: 0, next: 1, shows: BTreeMap::new() };
        for laid in &layout.tabs {
            let root = node(&laid.panes, &mut t);
            let mut tab = Tab { root, focus: 0, zoomed: laid.zoomed };
            let panes = tab.panes();
            tab.focus = panes.get(laid.focus).or(panes.first()).copied().unwrap_or(0);
            t.tabs.push(tab);
        }
        t.at = layout.at.min(t.tabs.len() - 1);
        Some(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 10, y: 1, width: 80, height: 20 };

    fn rect(x: u16, y: u16, width: u16, height: u16) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn a_pane_splits_right_and_down_and_the_halves_fill_the_tab() {
        let mut t = Tab::new(1);
        assert_eq!(t.shown(AREA), [(1, AREA)]);
        t.split(Dir::Right, 2, AREA).unwrap();
        assert_eq!(t.shown(AREA), [(1, rect(10, 1, 40, 20)), (2, rect(50, 1, 40, 20))]);
        assert_eq!(t.focus, 2, "the new pane is the one in focus");
        t.split(Dir::Down, 3, AREA).unwrap();
        assert_eq!(t.shown(AREA), [(1, rect(10, 1, 40, 20)), (2, rect(50, 1, 40, 10)), (3, rect(50, 11, 40, 10))]);
        // Every cell of the tab belongs to exactly one pane.
        let cells: u32 = t.shown(AREA).iter().map(|(_, r)| u32::from(r.width) * u32::from(r.height)).sum();
        assert_eq!(cells, 80 * 20);
        assert_eq!((t.at(AREA, 10, 1), t.at(AREA, 89, 20), t.at(AREA, 60, 5), t.at(AREA, 9, 1)), (Some(1), Some(3), Some(2), None));
        // A pane too small to be two is not split, and says why.
        let small = rect(0, 0, 20, 6);
        let mut tiny = Tab::new(1);
        assert!(tiny.split(Dir::Right, 2, small).unwrap_err().contains("too small to split to the right"));
        assert!(tiny.split(Dir::Down, 2, small).unwrap_err().contains("too small to split downwards"));
        assert_eq!(tiny.panes(), [1]);
    }

    #[test]
    fn the_focus_moves_to_the_pane_on_that_side_and_zoom_shows_one_pane() {
        let mut t = Tab::new(1);
        t.split(Dir::Right, 2, AREA).unwrap();
        t.split(Dir::Down, 3, AREA).unwrap();
        // 1 | 2
        //   | 3   (focus on 3)
        t.go(Way::Up, AREA);
        assert_eq!(t.focus, 2);
        t.go(Way::Left, AREA);
        assert_eq!(t.focus, 1);
        t.go(Way::Left, AREA);
        assert_eq!(t.focus, 1, "nothing is further left");
        t.go(Way::Right, AREA);
        assert_eq!(t.focus, 2, "of the two on the right, the first");
        t.go(Way::Down, AREA);
        assert_eq!(t.focus, 3);
        t.zoomed = true;
        assert_eq!(t.shown(AREA), [(3, AREA)], "zoomed, the pane in focus fills the tab");
        assert_eq!(t.all(AREA).len(), 3, "the others are still there");
        t.go(Way::Up, AREA);
        assert_eq!(t.focus, 3, "a zoomed pane has no neighbours");
    }

    #[test]
    fn closing_a_pane_gives_its_room_to_its_neighbour_and_the_last_one_closes_the_tab() {
        let mut t = Tab::new(1);
        t.split(Dir::Right, 2, AREA).unwrap();
        t.split(Dir::Down, 3, AREA).unwrap();
        assert!(t.close());
        assert_eq!((t.shown(AREA), t.focus), (vec![(1, rect(10, 1, 40, 20)), (2, rect(50, 1, 40, 20))], 2));
        assert!(t.close());
        assert_eq!((t.shown(AREA), t.focus), (vec![(1, AREA)], 1));
        assert!(!t.close(), "the last pane is the tab itself");
    }

    #[test]
    fn a_border_dragged_moves_and_stops_where_a_pane_would_be_too_small() {
        let mut t = Tab::new(1);
        t.split(Dir::Right, 2, AREA).unwrap();
        // The border is where pane 1 ends (column 49) and pane 2 begins (column 50).
        assert!(t.drag(AREA, (49, 5), (30, 5)));
        assert_eq!(t.shown(AREA), [(1, rect(10, 1, 20, 20)), (2, rect(30, 1, 60, 20))]);
        assert!(t.drag(AREA, (30, 5), (0, 5)), "dragged past the edge");
        assert_eq!(t.shown(AREA)[0].1.width, LEAST.0, "the pane keeps its least width");
        assert!(!t.drag(AREA, (70, 5), (60, 5)), "the middle of a pane is not a border");
        t.split(Dir::Down, 3, AREA).unwrap();
        let before = t.shown(AREA);
        assert!(t.drag(AREA, (40, before[2].1.y), (40, 6)), "a border between an upper and a lower pane moves up and down");
        assert_eq!((t.shown(AREA)[1].1.height, t.shown(AREA)[2].1.y), (5, 6));
    }

    #[test]
    fn tabs_hold_what_each_pane_shows_and_never_use_a_pane_number_twice() {
        let mut tabs = Tabs::new("engine:askk");
        assert_eq!((tabs.focus(), tabs.shown_in(1)), (1, "engine:askk"));
        let b = tabs.split(Dir::Right, AREA).unwrap();
        tabs.show(b, "terminal:1");
        let c = tabs.new_tab();
        tabs.show(c, "terminal:1");
        assert_eq!((tabs.at, tabs.tabs.len(), tabs.focus()), (1, 2, c));
        assert_eq!((tabs.shown_in(b), tabs.shown_in(c)), ("terminal:1", "terminal:1"), "a box may be shown in two panes");
        assert_eq!(tabs.shown(AREA), [(c, AREA, "terminal:1")]);
        tabs.turn(1);
        assert_eq!(tabs.at, 0, "after the last tab comes the first");
        tabs.turn(-1);
        assert_eq!(tabs.at, 1);
        assert!(tabs.go_to(1) && !tabs.go_to(3) && !tabs.go_to(0));
        // Closing: a pane, then the tab with its last pane, never the last pane of all.
        tabs.go_to(2);
        assert!(tabs.close());
        assert_eq!((tabs.tabs.len(), tabs.at, tabs.has(c)), (1, 0, false));
        assert!(tabs.close());
        assert_eq!(tabs.tab().panes(), [1]);
        assert!(!tabs.close(), "the last pane of the last tab stays");
        assert_eq!(tabs.shown_in(1), "", "but it shows nothing any more");
        let d = tabs.new_tab();
        assert!(d > c, "a number is never used twice: {d}");
    }

    #[test]
    fn tabs_are_kept_as_a_layout_and_laid_out_again_from_it() {
        let mut tabs = Tabs::new("engine:askk");
        let b = tabs.split(Dir::Right, AREA).unwrap();
        tabs.show(b, "terminal:1");
        tabs.tab_mut().drag(AREA, (49, 5), (30, 5));
        let c = tabs.split(Dir::Down, AREA).unwrap();
        tabs.show(c, "terminal:2");
        tabs.tab_mut().go(Way::Up, AREA);
        let d = tabs.new_tab();
        tabs.show(d, "session:4");
        tabs.tab_mut().zoomed = true;
        tabs.go_to(1);
        let laid = tabs.laid();
        assert_eq!((laid.tabs.len(), laid.at, laid.tabs[0].focus, laid.tabs[1].zoomed), (2, 0, 1, true));
        let again = Tabs::from_laid(&laid).unwrap();
        assert_eq!(again.laid(), laid, "laid out again, it is the same layout");
        assert_eq!(again.tab().shown(AREA).iter().map(|(_, r)| *r).collect::<Vec<_>>(), tabs.tab().shown(AREA).iter().map(|(_, r)| *r).collect::<Vec<_>>(), "every pane where it was");
        assert_eq!(again.shown_in(again.focus()), "terminal:1", "the focus where it was");
        assert_eq!(again.every().iter().map(|(_, b)| *b).collect::<Vec<_>>(), ["engine:askk", "terminal:1", "terminal:2", "session:4"]);
        assert_eq!(Tabs::from_laid(&Layout::default()), None);
    }
}
