//! Pure scheduler logic — no I/O, no web-sys, fully host-testable.
//!
//! Functions here are consumed by the PWA scheduler runtime that lands in a later
//! milestone; silence dead_code until then (same pattern as `state::schedule`).
#![allow(dead_code)]

use crate::state::{ScheduleEntry, ScheduleKind};

/// Whether `entry` is due at `now_ms`, using the platform's local timezone offset.
/// On host (non-WASM) this always uses offset 0; use [`is_due_with_offset`] in tests.
#[cfg(target_arch = "wasm32")]
pub fn is_due(entry: &ScheduleEntry, now_ms: u64) -> bool {
    is_due_with_offset(entry, now_ms, local_tz_offset_min())
}

/// Testable variant: `tz_offset_min` is minutes ahead of UTC
/// (UTC-5 = -300, UTC+5 = +300).
pub fn is_due_with_offset(entry: &ScheduleEntry, now_ms: u64, tz_offset_min: i32) -> bool {
    if !entry.enabled {
        return false;
    }
    match &entry.kind {
        ScheduleKind::OneShot { fire_at_ms } => {
            let unfired = entry.last_fired_ms.is_none_or(|f| f < *fire_at_ms);
            now_ms >= *fire_at_ms && unfired
        }
        ScheduleKind::DailyAt { hour, minute } => {
            let fire_ms = today_fire_ms(*hour, *minute, now_ms, tz_offset_min);
            let last = entry.last_fired_ms.unwrap_or(0);
            now_ms >= fire_ms && last < fire_ms
        }
    }
}

/// Returns the indices of all entries due at `now_ms`.
pub fn catch_up_entries(entries: &[ScheduleEntry], now_ms: u64, tz_offset_min: i32) -> Vec<usize> {
    entries
        .iter()
        .enumerate()
        .filter(|(_, e)| is_due_with_offset(e, now_ms, tz_offset_min))
        .map(|(i, _)| i)
        .collect()
}

/// Set the fired watermark on an entry.
pub fn mark_fired(entry: &mut ScheduleEntry, now_ms: u64) {
    entry.last_fired_ms = Some(now_ms);
}

/// UTC ms for today's fire time at `hour:minute` local, given `now_ms` and `tz_offset_min`.
fn today_fire_ms(hour: u8, minute: u8, now_ms: u64, tz_offset_min: i32) -> u64 {
    let offset_ms = tz_offset_min as i64 * 60 * 1000;
    let local_now = now_ms as i64 + offset_ms;
    let ms_per_day: i64 = 86_400_000;
    let today_local_midnight = (local_now / ms_per_day) * ms_per_day;
    let today_utc_midnight = today_local_midnight - offset_ms;
    let fire_offset = (hour as i64 * 3600 + minute as i64 * 60) * 1000;
    (today_utc_midnight + fire_offset) as u64
}

/// Local timezone offset in minutes (positive = ahead of UTC).
/// Returns 0 on non-WASM builds; host tests pass `tz_offset_min` explicitly via
/// [`is_due_with_offset`] and [`catch_up_entries`].
#[cfg(target_arch = "wasm32")]
pub fn local_tz_offset_min() -> i32 {
    // `getTimezoneOffset()` returns minutes *behind* UTC, so negate it.
    -(js_sys::Date::new_0().get_timezone_offset() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{ScheduleEntry, SchedulePayload};

    fn notif() -> SchedulePayload {
        SchedulePayload::Notification {
            text: "test".into(),
        }
    }

    #[test]
    fn one_shot_not_due_before_fire_time() {
        let entry = ScheduleEntry::new_one_shot("t", 1000, notif());
        assert!(!is_due_with_offset(&entry, 999, 0));
    }

    #[test]
    fn one_shot_due_at_and_after_fire_time() {
        let entry = ScheduleEntry::new_one_shot("t", 1000, notif());
        assert!(is_due_with_offset(&entry, 1000, 0));
        assert!(is_due_with_offset(&entry, 9999, 0));
    }

    #[test]
    fn one_shot_not_due_if_already_fired() {
        let mut entry = ScheduleEntry::new_one_shot("t", 1000, notif());
        entry.last_fired_ms = Some(1000);
        assert!(!is_due_with_offset(&entry, 9999, 0));
    }

    #[test]
    fn disabled_entry_never_due() {
        let mut entry = ScheduleEntry::new_one_shot("t", 1000, notif());
        entry.enabled = false;
        assert!(!is_due_with_offset(&entry, 9999, 0));
    }

    #[test]
    fn daily_due_when_fire_time_passed_today() {
        // UTC+0. Entry fires at 07:30. now = 07:31.
        let ms_07_30: u64 = (7 * 3600 + 30 * 60) * 1000;
        let now_ms = ms_07_30 + 60_000;
        let entry = ScheduleEntry::new_daily("briefing", 7, 30, notif()).unwrap();
        assert!(is_due_with_offset(&entry, now_ms, 0));
    }

    #[test]
    fn daily_not_due_before_fire_time_today() {
        let ms_07_30: u64 = (7 * 3600 + 30 * 60) * 1000;
        let now_ms = ms_07_30 - 1000;
        let entry = ScheduleEntry::new_daily("briefing", 7, 30, notif()).unwrap();
        assert!(!is_due_with_offset(&entry, now_ms, 0));
    }

    #[test]
    fn daily_not_due_if_fired_today() {
        let ms_07_30: u64 = (7 * 3600 + 30 * 60) * 1000;
        let now_ms = ms_07_30 + 60_000;
        let mut entry = ScheduleEntry::new_daily("briefing", 7, 30, notif()).unwrap();
        entry.last_fired_ms = Some(ms_07_30 + 1000);
        assert!(!is_due_with_offset(&entry, now_ms, 0));
    }

    #[test]
    fn catch_up_returns_only_due_entries() {
        let a = ScheduleEntry::new_one_shot("a", 500, notif());
        let b = ScheduleEntry::new_one_shot("b", 2000, notif());
        let entries = vec![a, b];
        assert_eq!(catch_up_entries(&entries, 1000, 0), vec![0usize]);
    }

    #[test]
    fn mark_fired_sets_watermark() {
        let mut entry = ScheduleEntry::new_one_shot("t", 1000, notif());
        mark_fired(&mut entry, 1234);
        assert_eq!(entry.last_fired_ms, Some(1234));
    }
}
