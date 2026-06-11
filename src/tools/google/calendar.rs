//! `gcal_events` — fetch upcoming Google Calendar events.

use crate::state::AppSnapshot;
use crate::tools::{ToolDescriptor, ToolFuture, ToolSpec};
use serde_json::{Value, json};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "gcal_events".into(),
            description: "Fetch upcoming Google Calendar events (summary, start/end, location). \
                           Requires a Google OAuth token (connect on the Tools page). Read-only."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "days_ahead":  { "type": "integer", "description": "1-7, default 1" },
                    "max_results": { "type": "integer", "description": "1-20, default 10" }
                },
                "required": []
            }),
        },
        handler: handle,
    }
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) struct CalendarEvent {
    pub summary: String,
    pub start: String,
    pub end: String,
    pub location: String,
}

/// Parse calendar events from the Google Calendar API response.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn parse_events(json: &Value) -> Vec<CalendarEvent> {
    json.get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let time = |key: &str| -> String {
                        item.get(key)
                            .and_then(|t| {
                                t.get("dateTime")
                                    .or_else(|| t.get("date"))
                                    .and_then(Value::as_str)
                            })
                            .unwrap_or("")
                            .to_string()
                    };
                    CalendarEvent {
                        summary: item
                            .get("summary")
                            .and_then(Value::as_str)
                            .unwrap_or("(no title)")
                            .to_string(),
                        start: time("start"),
                        end: time("end"),
                        location: item
                            .get("location")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn handle<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let token = snapshot.tool_config.google.access_token.clone();
        if token.is_empty() {
            return Err("No Google access token. Connect Google on the Tools page.".into());
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (snapshot, args);
            Err("gcal_events requires the browser (WASM).".into())
        }
        #[cfg(target_arch = "wasm32")]
        {
            use super::auth::{current_time_ms, is_token_valid};
            let expiry = snapshot.tool_config.google.token_expiry_ms;
            if !is_token_valid(&token, expiry, current_time_ms()) {
                return Err("Google token expired. Reconnect on the Tools page.".into());
            }
            let days = args
                .get("days_ahead")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 7);
            let max = args
                .get("max_results")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 20);
            fetch_events(&token, days, max).await
        }
    })
}

#[cfg(target_arch = "wasm32")]
async fn fetch_events(token: &str, days: u64, max: u64) -> Result<String, String> {
    use gloo_net::http::Request;
    let now_ms = js_sys::Date::now() as u64;
    let end_ms = now_ms + days * 86_400_000;
    let iso = |ms: u64| {
        js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms as f64))
            .to_iso_string()
            .as_string()
            .unwrap_or_default()
    };
    let t_min = iso(now_ms).replace('+', "%2B");
    let t_max = iso(end_ms).replace('+', "%2B");
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?\
         timeMin={t_min}&timeMax={t_max}&maxResults={max}&singleEvents=true&orderBy=startTime"
    );
    let resp = Request::get(&url)
        .header("Authorization", &format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Calendar request: {e}"))?;
    if !resp.ok() {
        return Err(format!("Calendar {} — check scopes", resp.status()));
    }
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Calendar parse: {e}"))?;
    let events = parse_events(&json);
    if events.is_empty() {
        return Ok(format!("No events in the next {days} day(s)."));
    }
    Ok(events
        .iter()
        .map(|e| {
            if e.location.is_empty() {
                format!("• {} ({}–{})", e.summary, e.start, e.end)
            } else {
                format!("• {} ({}–{}) @ {}", e.summary, e.start, e.end, e.location)
            }
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{"items":[
        {"summary":"Team standup","start":{"dateTime":"2026-06-10T09:00:00+00:00"},"end":{"dateTime":"2026-06-10T09:30:00+00:00"},"location":"Meet"},
        {"summary":"Lunch","start":{"date":"2026-06-10"},"end":{"date":"2026-06-10"}}
    ]}"#;

    #[test]
    fn parse_events_extracts_summary_and_times() {
        let json: Value = serde_json::from_str(FIXTURE).unwrap();
        let events = parse_events(&json);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].summary, "Team standup");
        assert_eq!(events[0].start, "2026-06-10T09:00:00+00:00");
        assert_eq!(events[1].summary, "Lunch");
        assert_eq!(events[1].start, "2026-06-10");
    }
}
