//! # The queue: messages written while a box is at work
//!
//! A message sent to a box that is working is not lost and not sent at once: it waits in
//! this window, in sight, and goes when the box is done. Until then it can be taken back.
//!
//! | question | answer |
//! | --- | --- |
//! | when does the next one go? | when the box is not working and has read everything sent before ([`ready`]) |
//! | in which order? | the order they were written |
//! | where is the queue kept? | in the window, and in the browser beside it ([`Queue::text`]): a reload brings it back; another browser has its own |
//! | can one go before the work is done? | yes, an engine's: sent now, it is in the engine's message box at its next step (the run in hand reads it), so it steers that run |
#![cfg_attr(feature = "local", allow(dead_code))]
use crate::core::boxes::State;
use std::collections::BTreeMap;

/// One message that waits.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Queued {
    /// A number of its own in this window, so it can be taken back.
    pub key: u64,
    pub text: String,
}

/// Every message that waits, by the id of the box it is for.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Queue {
    next: u64,
    by: BTreeMap<String, Vec<Queued>>,
}

impl Queue {
    /// Put a message at the end of a box's queue.
    pub fn push(&mut self, to: &str, text: &str) -> u64 {
        self.next += 1;
        self.by.entry(to.to_string()).or_default().push(Queued { key: self.next, text: text.to_string() });
        self.next
    }

    /// Take a message back; gives its text, so it can be written on.
    pub fn remove(&mut self, to: &str, key: u64) -> Option<String> {
        let list = self.by.get_mut(to)?;
        let at = list.iter().position(|q| q.key == key)?;
        let text = list.remove(at).text;
        if list.is_empty() {
            self.by.remove(to);
        }
        Some(text)
    }

    /// The messages that wait for a box, first to go first.
    pub fn of(&self, to: &str) -> Vec<Queued> {
        self.by.get(to).cloned().unwrap_or_default()
    }

    /// The boxes something waits for.
    pub fn waiting(&self) -> Vec<String> {
        self.by.keys().cloned().collect()
    }

    /// The queue as the text the browser keeps.
    pub fn text(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// The queue the browser kept; nothing, when what it kept cannot be read.
    pub fn from_text(text: &str) -> Queue {
        serde_json::from_str(text).unwrap_or_default()
    }

    /// The next message for a box, taken off its queue.
    pub fn take(&mut self, to: &str) -> Option<Queued> {
        let key = self.by.get(to)?.first()?.key;
        let text = self.remove(to, key)?;
        Some(Queued { key, text })
    }
}

/// Whether the next message may go: the box is not at work, and nothing sent before is still
/// unread by it (`unread`: how many messages it has not taken up yet).
pub fn ready(state: State, unread: usize) -> bool {
    state != State::Working && unread == 0
}

/// Whether a message written now waits instead of going at once.
pub fn waits(state: State, queued: usize) -> bool {
    state == State::Working || queued > 0
}

/// What the queue's heading says: `1 message waits`, `3 messages wait`.
pub fn heading(n: usize) -> String {
    if n == 1 { "1 message waits until it is done".into() } else { format!("{n} messages wait until it is done") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_go_in_the_order_written_and_one_can_be_taken_back() {
        let mut q = Queue::default();
        let a = q.push("engine:askk", "first");
        let b = q.push("engine:askk", "second");
        q.push("session:2", "other");
        assert_eq!(q.waiting(), ["engine:askk", "session:2"]);
        assert_eq!(q.of("engine:askk").iter().map(|m| m.text.as_str()).collect::<Vec<_>>(), ["first", "second"]);
        assert_eq!(q.remove("engine:askk", a), Some("first".into()));
        assert_eq!(q.remove("engine:askk", a), None, "it is gone");
        assert_eq!(q.take("engine:askk"), Some(Queued { key: b, text: "second".into() }));
        assert_eq!(q.take("engine:askk"), None);
        assert_eq!(q.waiting(), ["session:2"], "an empty queue is not waiting");
        assert!(q.of("engine:askk").is_empty());
        let back = Queue::from_text(&q.text());
        assert_eq!(back, q, "what the browser keeps is the queue");
        assert_eq!(Queue::from_text("not a queue"), Queue::default());
    }

    #[test]
    fn the_next_goes_only_when_the_box_is_done_and_has_read_the_last() {
        assert!(ready(State::Idle, 0) && ready(State::Blocked, 0) && ready(State::Failed, 0));
        assert!(!ready(State::Working, 0), "it is at work");
        assert!(!ready(State::Idle, 1), "the message before is not taken up yet");
        assert!(waits(State::Working, 0) && waits(State::Idle, 2) && !waits(State::Idle, 0), "behind a queue, a message queues too");
        assert_eq!((heading(1), heading(3)), ("1 message waits until it is done".to_string(), "3 messages wait until it is done".to_string()));
    }
}
