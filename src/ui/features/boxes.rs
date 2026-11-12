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
// The page and the terminal come to draw these next (docs/concept.md, step 2).
#![allow(dead_code)]
use crate::core::boxes::{SessionBox, State};
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

impl Mark {
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
}
