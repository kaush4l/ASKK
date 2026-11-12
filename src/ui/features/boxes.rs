//! # Boxes: what a person reads off them, the same in every UI
//!
//! The service says what each box is (`core/boxes.rs`). Here is what a window does with the
//! list, written once so a page, the Mac window and the terminal agree:
//!
//! | question | answer |
//! | --- | --- |
//! | in which order? | what needs the owner first: blocked, failed, done, working, idle ([`order`]) |
//! | which are on the canvas? | those that are not idle ([`running`]); the dashboard lists them all |
//! | what is "done"? | a box this window saw working and now sees idle, until it is looked at ([`Seen`]) |
//! | what does the folded pill say? | how many are in each state ([`count`]) |
//! | how is a box one line? | [`line`] |
//! | which box is open? | the one the address names after `#` ([`opened`], [`link`]), so a reload and the back button keep it |
//! | which boxes did the owner pin? | a list this window keeps ([`pins_from`], [`pins_text`]); a pinned box is on the canvas even when idle ([`on_canvas`]) |
//! | how is the pill searched and grouped? | [`found`], [`by_place`] |
// The page draws these (ui/web/views/boxes.rs); the terminal comes to say them as lines.
#![allow(dead_code)]
use crate::core::boxes::{Depth, SessionBox, State};
use std::collections::{BTreeMap, BTreeSet};

/// A box's state as a window shows it: the service's five, and the window's own "done".
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Mark {
    Blocked,
    Failed,
    Done,
    Working,
    Idle,
    Unknown,
}

/// How deep askk sees into a box, as the end of the sentence "askk sees ...".
pub fn sees(depth: Depth) -> &'static str {
    match depth {
        Depth::Screen => "its screen",
        Depth::Recognised => "its screen, and guesses its state",
        Depth::Reported => "what its agent reports",
        Depth::Spec => "its goal, learnings, tools and every run",
    }
}

impl Mark {
    /// One plain word that names the mark where a word may not have spaces (a style's name).
    pub fn key(self) -> &'static str {
        match self {
            Mark::Blocked => "blocked",
            Mark::Failed => "failed",
            Mark::Done => "done",
            Mark::Working => "working",
            Mark::Idle => "idle",
            Mark::Unknown => "unknown",
        }
    }

    /// The word a person is shown.
    pub fn word(self) -> &'static str {
        match self {
            Mark::Blocked => "waits for you",
            Mark::Failed => "failed",
            Mark::Done => "done",
            Mark::Working => "working",
            Mark::Idle => "idle",
            Mark::Unknown => "unknown",
        }
    }

    /// One sign that is not a colour, so a state is never told by colour alone.
    pub fn sign(self) -> &'static str {
        match self {
            Mark::Blocked => "?",
            Mark::Failed => "!",
            Mark::Done => "✓",
            Mark::Working => "●",
            Mark::Idle => "○",
            Mark::Unknown => "·",
        }
    }
}

/// What one window remembers between two looks at the list: which boxes it saw working, and
/// which of those finished without having been looked at since.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Seen {
    working: BTreeSet<String>,
    done: BTreeSet<String>,
}

impl Seen {
    /// Take in a new list. A box that was working and is now idle becomes done.
    pub fn take(&mut self, boxes: &[SessionBox]) {
        let now: BTreeMap<&str, State> = boxes.iter().map(|b| (b.id.as_str(), b.state)).collect();
        for id in std::mem::take(&mut self.working) {
            match now.get(id.as_str()) {
                Some(State::Idle) => {
                    self.done.insert(id);
                }
                Some(State::Working) => {
                    self.working.insert(id);
                }
                _ => {}
            }
        }
        for b in boxes.iter().filter(|b| b.state == State::Working) {
            self.working.insert(b.id.clone());
            self.done.remove(&b.id);
        }
        // A box that is gone, or no longer idle, is not "done" any more.
        self.done.retain(|id| now.get(id.as_str()) == Some(&State::Idle));
    }

    /// The owner looked at this box.
    pub fn looked(&mut self, id: &str) {
        self.done.remove(id);
    }

    /// Whether this box finished and has not been looked at since.
    pub fn is_done(&self, id: &str) -> bool {
        self.done.contains(id)
    }

    /// The mark this window shows for a box.
    pub fn mark(&self, b: &SessionBox) -> Mark {
        match b.state {
            State::Blocked => Mark::Blocked,
            State::Failed => Mark::Failed,
            State::Working => Mark::Working,
            State::Idle if self.done.contains(&b.id) => Mark::Done,
            State::Idle => Mark::Idle,
            State::Unknown => Mark::Unknown,
        }
    }
}

/// The boxes in the order a person needs them: what waits for them first. Boxes with the same
/// mark keep the order the service gave.
pub fn order(boxes: &[SessionBox], seen: &Seen) -> Vec<SessionBox> {
    let mut out = boxes.to_vec();
    out.sort_by_key(|b| seen.mark(b));
    out
}

/// Whether a box belongs on the canvas: anything that is not simply idle.
pub fn running(b: &SessionBox, seen: &Seen) -> bool {
    !matches!(seen.mark(b), Mark::Idle | Mark::Unknown)
}

/// How many boxes carry each mark, in the order of [`order`]; marks nobody carries are left out.
pub fn count(boxes: &[SessionBox], seen: &Seen) -> Vec<(Mark, usize)> {
    let mut by: BTreeMap<Mark, usize> = BTreeMap::new();
    for b in boxes {
        *by.entry(seen.mark(b)).or_default() += 1;
    }
    by.into_iter().collect()
}

/// A box as one line: its sign, its name, what kind it is and where, and its last line.
pub fn line(b: &SessionBox, seen: &Seen) -> String {
    let mark = seen.mark(b);
    let place = if b.place.is_empty() { String::new() } else { format!(" in {}", b.place) };
    let last = if b.last.is_empty() { String::new() } else { format!(": {}", b.last) };
    format!("{} {} ({}{place}, {}){last}", mark.sign(), b.title, b.kind, mark.word())
}

/// The address that opens a box in place on the canvas: the home page, the box after `#`.
pub fn link(id: &str) -> String {
    format!("/#{id}")
}

/// The box an address names after its `#`, when it names one (`engine:askk/developer`,
/// `session:12`). The address may have been written with `%` escapes.
pub fn opened(hash: &str) -> Option<String> {
    let mut out = Vec::new();
    let bytes = hash.trim().trim_start_matches('#').as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%').then(|| bytes.get(i + 1..i + 3)).flatten().and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    let id = String::from_utf8(out).ok()?;
    let (kind, name) = id.split_once(':')?;
    let ok = !kind.is_empty() && kind.chars().all(|c| c.is_ascii_lowercase()) && !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || c.is_control() || c == '%');
    ok.then_some(id)
}

/// The engine a box is, by its path, when it is one.
pub fn engine_of(id: &str) -> Option<&str> {
    id.strip_prefix("engine:").filter(|p| !p.is_empty())
}

/// The session a box is, by its number, when it is one.
pub fn session_of(id: &str) -> Option<u64> {
    id.strip_prefix("session:")?.parse().ok()
}

/// The pinned boxes as a window keeps them between visits (a JSON list of ids). Text that is
/// not such a list is no pins.
pub fn pins_from(text: &str) -> BTreeSet<String> {
    serde_json::from_str::<Vec<String>>(text).map(|v| v.into_iter().collect()).unwrap_or_default()
}

/// The text a window keeps for [`pins_from`].
pub fn pins_text(pins: &BTreeSet<String>) -> String {
    serde_json::to_string(&pins.iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

/// Whether a box belongs on the canvas: it runs, or the owner pinned it there.
pub fn on_canvas(b: &SessionBox, seen: &Seen, pins: &BTreeSet<String>) -> bool {
    running(b, seen) || pins.contains(&b.id)
}

/// Whether a box answers what was typed into the pill's find field: every word is in its
/// name, its kind, its place or its last line.
pub fn found(b: &SessionBox, typed: &str) -> bool {
    let hay = format!("{} {} {} {}", b.title, b.kind, b.place, b.last).to_lowercase();
    typed.to_lowercase().split_whitespace().all(|w| hay.contains(w))
}

/// Things in groups by their place, each group in the order its first member came; inside a
/// group the order is kept. `place` reads a thing's place; no place groups under `""`.
pub fn by_place<T>(things: Vec<T>, place: impl Fn(&T) -> String) -> Vec<(String, Vec<T>)> {
    let mut out: Vec<(String, Vec<T>)> = vec![];
    for t in things {
        let p = place(&t);
        match out.iter_mut().find(|(name, _)| *name == p) {
            Some((_, group)) => group.push(t),
            None => out.push((p, vec![t])),
        }
    }
    out
}

/// The heading of a group of boxes in the pill.
pub fn place_word(place: &str) -> &str {
    if place.is_empty() { "no place" } else { place }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(id: &str, state: State) -> SessionBox {
        SessionBox { id: id.into(), title: id.into(), kind: "engine".into(), state, ..Default::default() }
    }

    #[test]
    fn what_waits_for_the_owner_comes_first() {
        let list = [a("idle", State::Idle), a("works", State::Working), a("broke", State::Failed), a("asks", State::Blocked)];
        let seen = Seen::default();
        let ids: Vec<String> = order(&list, &seen).into_iter().map(|b| b.id).collect();
        assert_eq!(ids, ["asks", "broke", "works", "idle"]);
        assert_eq!(count(&list, &seen), [(Mark::Blocked, 1), (Mark::Failed, 1), (Mark::Working, 1), (Mark::Idle, 1)]);
        let on: Vec<&str> = list.iter().filter(|b| running(b, &seen)).map(|b| b.id.as_str()).collect();
        assert_eq!(on, ["works", "broke", "asks"], "an idle box stays off the canvas");
    }

    #[test]
    fn done_is_what_this_window_saw_finish_until_it_is_looked_at() {
        let mut seen = Seen::default();
        seen.take(&[a("x", State::Idle), a("y", State::Working)]);
        assert_eq!(seen.mark(&a("x", State::Idle)), Mark::Idle, "it was never seen working");
        let after = [a("x", State::Idle), a("y", State::Idle)];
        seen.take(&after);
        assert_eq!(seen.mark(&after[1]), Mark::Done);
        assert!(running(&after[1], &seen), "a finished box stays on the canvas until looked at");
        assert_eq!(order(&after, &seen)[0].id, "y");
        seen.take(&after);
        assert_eq!(seen.mark(&after[1]), Mark::Done, "another look at the list does not clear it");
        seen.looked("y");
        assert_eq!(seen.mark(&after[1]), Mark::Idle);
        // Working again, then failed: not done.
        seen.take(&[a("y", State::Working)]);
        seen.take(&[a("y", State::Failed)]);
        seen.take(&[a("y", State::Idle)]);
        assert_eq!(seen.mark(&a("y", State::Idle)), Mark::Idle);
    }

    #[test]
    fn a_box_reads_as_one_line_with_a_sign_that_is_not_a_colour() {
        let mut b = a("coder", State::Working);
        b.place = "askk".into();
        b.last = "calling run_code".into();
        assert_eq!(line(&b, &Seen::default()), "● coder (engine in askk, working): calling run_code");
        assert_eq!(line(&a("s", State::Blocked), &Seen::default()), "? s (engine, waits for you)");
        let signs: BTreeSet<&str> = [Mark::Blocked, Mark::Failed, Mark::Done, Mark::Working, Mark::Idle, Mark::Unknown].iter().map(|m| m.sign()).collect();
        assert_eq!(signs.len(), 6, "every state has its own sign");
    }

    #[test]
    fn the_address_names_the_open_box_and_nothing_else_opens_one() {
        assert_eq!(link("engine:askk/developer"), "/#engine:askk/developer");
        assert_eq!(opened("engine:askk/developer"), Some("engine:askk/developer".into()));
        assert_eq!(opened("#session:12"), Some("session:12".into()));
        assert_eq!(opened("engine%3Aaskk%2Fdeveloper"), Some("engine:askk/developer".into()), "written with escapes");
        for none in ["", "#", "top", "engine:", ":x", "Engine:x", "engine:a b", "engine:%zz", "engine:%0a"] {
            assert_eq!(opened(none), None, "{none:?}");
        }
        assert_eq!((engine_of("engine:askk/developer"), engine_of("session:3"), engine_of("engine:")), (Some("askk/developer"), None, None));
        assert_eq!((session_of("session:12"), session_of("session:x"), session_of("engine:1")), (Some(12), None, None));
    }

    #[test]
    fn a_pinned_box_is_on_the_canvas_even_when_idle_and_pins_survive_as_text() {
        let seen = Seen::default();
        let mut pins = pins_from("not json");
        assert!(pins.is_empty());
        assert!(!on_canvas(&a("idle", State::Idle), &seen, &pins) && on_canvas(&a("works", State::Working), &seen, &pins));
        pins.insert("idle".into());
        pins.insert("b".into());
        assert!(on_canvas(&a("idle", State::Idle), &seen, &pins));
        assert_eq!(pins_text(&pins), r#"["b","idle"]"#);
        assert_eq!(pins_from(&pins_text(&pins)), pins);
    }

    #[test]
    fn the_pill_is_searched_by_words_and_grouped_by_place() {
        let mut b = a("coder", State::Working);
        b.place = "askk".into();
        b.last = "calling run_code".into();
        assert!(found(&b, "") && found(&b, "COD") && found(&b, "askk run_code") && found(&b, "engine") && !found(&b, "coder claude"));
        let groups = by_place(vec![("x", "askk"), ("y", ""), ("z", "askk"), ("w", "site")], |t| t.1.to_string());
        assert_eq!(groups, [("askk".to_string(), vec![("x", "askk"), ("z", "askk")]), (String::new(), vec![("y", "")]), ("site".to_string(), vec![("w", "site")])]);
        assert_eq!((place_word(""), place_word("askk")), ("no place", "askk"));
    }
}
