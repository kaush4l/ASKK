//! Scheduled entries persisted in `AppSnapshot`. The scheduler fires entries
//! whose due time has passed; logic lives in `crate::scheduler::logic`.

// Types are consumed by the PWA scheduler (src/scheduler/) which lands in a later
// milestone; silence dead_code until then.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ScheduleEntry {
    pub id: String,
    pub label: String,
    pub kind: ScheduleKind,
    pub payload: SchedulePayload,
    pub enabled: bool,
    /// UTC ms watermark of the last fire. `None` = never fired.
    pub last_fired_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ScheduleKind {
    /// Fires once at the given UTC timestamp (ms since epoch).
    OneShot { fire_at_ms: u64 },
    /// Fires every day when local time reaches the given hour:minute.
    DailyAt { hour: u8, minute: u8 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum SchedulePayload {
    /// Display a Web Notification with this text.
    Notification { text: String },
    /// Enqueue a run for the named agent with this goal.
    AgentRun { agent_id: String, goal: String },
}

impl ScheduleEntry {
    pub fn new_one_shot(
        label: impl Into<String>,
        fire_at_ms: u64,
        payload: SchedulePayload,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            label: label.into(),
            kind: ScheduleKind::OneShot { fire_at_ms },
            payload,
            enabled: true,
            last_fired_ms: None,
        }
    }

    pub fn new_daily(
        label: impl Into<String>,
        hour: u8,
        minute: u8,
        payload: SchedulePayload,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            label: label.into(),
            kind: ScheduleKind::DailyAt { hour, minute },
            payload,
            enabled: true,
            last_fired_ms: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_entry_roundtrip() {
        let entry = ScheduleEntry::new_one_shot(
            "standup reminder",
            1_700_000_000_000,
            SchedulePayload::Notification {
                text: "Time for standup".into(),
            },
        );
        let json = serde_json::to_value(&entry).unwrap();
        let back: ScheduleEntry = serde_json::from_value(json).unwrap();
        assert_eq!(back.label, "standup reminder");
        assert!(back.enabled);
        assert_eq!(back.last_fired_ms, None);
        match back.kind {
            ScheduleKind::OneShot { fire_at_ms } => assert_eq!(fire_at_ms, 1_700_000_000_000),
            _ => panic!("expected OneShot"),
        }
    }

    #[test]
    fn daily_schedule_entry_roundtrip() {
        let entry = ScheduleEntry::new_daily(
            "morning briefing",
            7,
            30,
            SchedulePayload::AgentRun {
                agent_id: "assistant".into(),
                goal: "Run morning briefing".into(),
            },
        );
        let json = serde_json::to_value(&entry).unwrap();
        let back: ScheduleEntry = serde_json::from_value(json).unwrap();
        match back.kind {
            ScheduleKind::DailyAt { hour, minute } => {
                assert_eq!(hour, 7);
                assert_eq!(minute, 30);
            }
            _ => panic!("expected DailyAt"),
        }
        match back.payload {
            SchedulePayload::AgentRun { agent_id, goal } => {
                assert_eq!(agent_id, "assistant");
                assert_eq!(goal, "Run morning briefing");
            }
            _ => panic!("expected AgentRun payload"),
        }
    }
}
