//! Pure shared core — std-only plus serde for the API types.
//!
//! No UI, no I/O, no clock. Same state + same event = same result,
//! on native and on WASM. The web shell, the Actix server and the
//! terminal shell all depend on this crate and nothing else shared.

use serde::{Deserialize, Serialize};

/// One fact that happened. Immutable, ordered, the source of truth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub seq: u64,
    pub kind: String,
    pub detail: String,
}

/// The whole state of the core. Rebuilt by replaying the event log.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub count: i32,
    pub events: Vec<Event>,
    pub intentions: Vec<String>,
}

impl State {
    pub fn reduce(&mut self, event: Event) {
        match event.kind.as_str() {
            "count.inc" => self.count += 1,
            "count.dec" => self.count -= 1,
            "intention.expressed" => self.intentions.push(event.detail.clone()),
            _ => {}
        }
        self.events.push(event);
    }

    pub fn next_seq(&self) -> u64 {
        (self.events.len() + 1) as u64
    }
}

/// What the Actix API returns for `/api/server-data`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerData {
    pub message: String,
    pub count: i32,
    pub events: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_flows_through_reduce() {
        let mut state = State::default();
        state.reduce(Event {
            seq: 1,
            kind: "count.inc".to_string(),
            detail: String::new(),
        });
        assert_eq!(state.count, 1);
        assert_eq!(state.events.len(), 1);
    }

    #[test]
    fn replay_rebuilds_state() {
        let mut a = State::default();
        let mut b = State::default();
        for seq in 1..=3u64 {
            let e = Event {
                seq,
                kind: "count.inc".to_string(),
                detail: String::new(),
            };
            a.reduce(e.clone());
            b.reduce(e);
        }
        assert_eq!(a, b);
    }
}
