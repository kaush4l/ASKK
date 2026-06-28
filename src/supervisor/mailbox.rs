//! Per-agent message inbox. Each managed agent owns one [`Mailbox`]; the supervisor
//! routes a message to a specific agent by pushing into its inbox, and the agent
//! drains the inbox at the start of its next run so the messages enter its goal as
//! addressed context. This is the "a queue to message a particular agent" surface,
//! kept as a plain FIFO with no async/browser dependency so it is host-testable.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

/// One message addressed to an agent. `from` is the sender's id (another agent, or
/// `"orchestrator"`/`"user"` for top-level sends); `body` is the message text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub from: String,
    pub body: String,
}

impl Message {
    pub fn new(from: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            body: body.into(),
        }
    }
}

/// A bounded FIFO inbox for one agent. Bounded so a runaway sender cannot grow an
/// inbox without limit; the oldest message is dropped when the cap is exceeded
/// (the agent already missed it, and dropping the oldest keeps the freshest
/// context). The cap is generous — messaging is coarse-grained coordination, not a
/// high-throughput bus.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Mailbox {
    queue: VecDeque<Message>,
}

/// Inbox capacity. Past this, the oldest message is evicted on push.
const MAILBOX_CAP: usize = 64;

impl Mailbox {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
        }
    }

    /// Enqueue a message, evicting the oldest if the inbox is at capacity.
    pub fn push(&mut self, message: Message) {
        if self.queue.len() >= MAILBOX_CAP {
            self.queue.pop_front();
        }
        self.queue.push_back(message);
    }

    /// Remove and return every pending message in arrival order, leaving the inbox
    /// empty. Called when an agent starts a run to fold its inbox into the goal.
    pub fn drain(&mut self) -> Vec<Message> {
        self.queue.drain(..).collect()
    }

    /// Number of pending messages (for progress/UI without consuming them).
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_then_drain_is_fifo_and_empties() {
        let mut inbox = Mailbox::new();
        inbox.push(Message::new("orchestrator", "first"));
        inbox.push(Message::new("planner", "second"));
        assert_eq!(inbox.len(), 2);

        let drained = inbox.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].body, "first");
        assert_eq!(drained[1].body, "second");
        assert!(inbox.is_empty());
    }

    #[test]
    fn over_capacity_evicts_oldest() {
        let mut inbox = Mailbox::new();
        for i in 0..(MAILBOX_CAP + 5) {
            inbox.push(Message::new("sender", format!("msg{i}")));
        }
        assert_eq!(inbox.len(), MAILBOX_CAP);
        let drained = inbox.drain();
        // The first 5 were evicted; the oldest surviving is msg5.
        assert_eq!(drained.first().unwrap().body, "msg5");
    }
}
