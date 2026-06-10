//! `manage_schedule` — create, list, and cancel scheduled entries.

use crate::state::{AppSnapshot, ScheduleEntry, ScheduleKind, SchedulePayload};
use crate::tools::common::{integer_arg, optional_string_arg, string_arg};
use crate::tools::{ToolDescriptor, ToolFuture, ToolSpec};
use serde_json::{Value, json};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "manage_schedule".to_string(),
            description: "Create, list, or cancel scheduled reminders and daily triggers. \
                           action=create_reminder: one-shot notification at fire_at_ms (UTC ms). \
                           action=create_daily: recurring notification at local hour:minute. \
                           action=list: show all entries. \
                           action=cancel: remove entry by entry_id. \
                           Include agent_id+goal instead of text to trigger an agent run."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create_reminder", "create_daily", "list", "cancel"]
                    },
                    "label":      { "type": "string" },
                    "fire_at_ms": { "type": "integer", "description": "UTC ms for one-shot" },
                    "hour":       { "type": "integer", "description": "Local hour 0-23" },
                    "minute":     { "type": "integer", "description": "Local minute 0-59" },
                    "text":       { "type": "string",  "description": "Notification text" },
                    "agent_id":   { "type": "string",  "description": "Agent to run (optional)" },
                    "goal":       { "type": "string",  "description": "Agent goal (required with agent_id)" },
                    "entry_id":   { "type": "string",  "description": "Entry id to cancel" }
                },
                "required": ["action"]
            }),
        },
        handler: handle,
    }
}

fn handle<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        match string_arg(args, "action")?.as_str() {
            "list" => list(snapshot),
            "cancel" => cancel(snapshot, args),
            "create_reminder" => create_reminder(snapshot, args),
            "create_daily" => create_daily(snapshot, args),
            other => Err(format!(
                "Unknown action `{other}`. Use: create_reminder, create_daily, list, cancel"
            )),
        }
    })
}

fn list(snapshot: &AppSnapshot) -> Result<String, String> {
    if snapshot.schedules.is_empty() {
        return Ok("No scheduled entries.".into());
    }
    let lines: Vec<String> = snapshot
        .schedules
        .iter()
        .map(|e| {
            let when = match &e.kind {
                ScheduleKind::OneShot { fire_at_ms } => {
                    format!("one-shot at {fire_at_ms}ms")
                }
                ScheduleKind::DailyAt { hour, minute } => {
                    format!("daily {:02}:{:02}", hour, minute)
                }
            };
            let last = e
                .last_fired_ms
                .map_or("never".into(), |ms| format!("{ms}ms"));
            format!("[{}] {} — {} (last fired: {})", e.id, e.label, when, last)
        })
        .collect();
    Ok(lines.join("\n"))
}

fn cancel(snapshot: &mut AppSnapshot, args: &Value) -> Result<String, String> {
    let id = string_arg(args, "entry_id")?;
    let before = snapshot.schedules.len();
    snapshot.schedules.retain(|e| e.id != id);
    if snapshot.schedules.len() < before {
        Ok(format!("Cancelled entry {id}."))
    } else {
        Err(format!("No entry found with id `{id}`."))
    }
}

fn create_reminder(snapshot: &mut AppSnapshot, args: &Value) -> Result<String, String> {
    let label = string_arg(args, "label")?;
    let fire_at_ms = args
        .get("fire_at_ms")
        .and_then(Value::as_u64)
        .ok_or("fire_at_ms (integer UTC ms) is required for create_reminder")?;
    let payload = build_payload(args)?;
    let entry = ScheduleEntry::new_one_shot(&label, fire_at_ms, payload);
    let id = entry.id.clone();
    snapshot.schedules.push(entry);
    Ok(format!("Created one-shot reminder '{label}' (id: {id})."))
}

fn create_daily(snapshot: &mut AppSnapshot, args: &Value) -> Result<String, String> {
    let label = string_arg(args, "label")?;
    let hour = integer_arg(args, "hour").ok_or("hour (0-23) required for create_daily")? as u8;
    let minute =
        integer_arg(args, "minute").ok_or("minute (0-59) required for create_daily")? as u8;
    let payload = build_payload(args)?;
    let entry = ScheduleEntry::new_daily(&label, hour, minute, payload)?;
    let id = entry.id.clone();
    snapshot.schedules.push(entry);
    Ok(format!(
        "Created daily trigger '{label}' at {:02}:{:02} (id: {id}).",
        hour, minute
    ))
}

fn build_payload(args: &Value) -> Result<SchedulePayload, String> {
    if let Some(agent_id) = optional_string_arg(args, "agent_id") {
        let goal = string_arg(args, "goal")
            .map_err(|_| "goal is required when agent_id is given".to_string())?;
        Ok(SchedulePayload::AgentRun { agent_id, goal })
    } else {
        let text = string_arg(args, "text")
            .map_err(|_| "text is required for notification payloads".to_string())?;
        Ok(SchedulePayload::Notification { text })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppSnapshot;
    use serde_json::json;

    fn run(snapshot: &mut AppSnapshot, args: serde_json::Value) -> String {
        pollster::block_on(async {
            let desc = descriptor();
            (desc.handler)(snapshot, &args).await.unwrap_or_else(|e| e)
        })
    }

    #[test]
    fn list_when_empty() {
        let mut snap = AppSnapshot::default();
        assert_eq!(
            run(&mut snap, json!({ "action": "list" })),
            "No scheduled entries."
        );
    }

    #[test]
    fn create_reminder_adds_entry() {
        let mut snap = AppSnapshot::default();
        let out = run(
            &mut snap,
            json!({
                "action": "create_reminder",
                "label": "standup",
                "fire_at_ms": 1_700_000_000_000_u64,
                "text": "Time!"
            }),
        );
        assert!(out.contains("standup"), "got: {out}");
        assert_eq!(snap.schedules.len(), 1);
    }

    #[test]
    fn create_daily_adds_entry() {
        let mut snap = AppSnapshot::default();
        let out = run(
            &mut snap,
            json!({
                "action": "create_daily",
                "label": "briefing",
                "hour": 7,
                "minute": 30,
                "text": "Morning!"
            }),
        );
        assert!(out.contains("07:30"), "got: {out}");
        assert_eq!(snap.schedules.len(), 1);
    }

    #[test]
    fn cancel_removes_entry() {
        let mut snap = AppSnapshot::default();
        run(
            &mut snap,
            json!({
                "action": "create_reminder",
                "label": "cancel-me",
                "fire_at_ms": 1_700_000_000_000_u64,
                "text": "x"
            }),
        );
        let id = snap.schedules[0].id.clone();
        let out = run(&mut snap, json!({ "action": "cancel", "entry_id": id }));
        assert!(out.contains("Cancelled"), "got: {out}");
        assert!(snap.schedules.is_empty());
    }

    #[test]
    fn list_shows_created_entry() {
        let mut snap = AppSnapshot::default();
        run(
            &mut snap,
            json!({
                "action": "create_reminder",
                "label": "my-reminder",
                "fire_at_ms": 1_700_000_000_000_u64,
                "text": "remember"
            }),
        );
        let out = run(&mut snap, json!({ "action": "list" }));
        assert!(out.contains("my-reminder"), "got: {out}");
    }

    #[test]
    fn invalid_hour_returns_error() {
        let mut snap = AppSnapshot::default();
        let out = run(
            &mut snap,
            json!({
                "action": "create_daily",
                "label": "bad",
                "hour": 25,
                "minute": 0,
                "text": "oops"
            }),
        );
        assert!(out.contains("hour"), "got: {out}");
        assert!(snap.schedules.is_empty());
    }
}
