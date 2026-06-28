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

/// A bounded-concurrency admission model: the pure decision core the spawner
/// (`scheduler::spawner`) drives. Enqueue any number of items; at most `cap` are
/// ever "active" at once, the rest wait in FIFO order. A completion frees one
/// slot, which the next pending item may then claim. No I/O, no platform calls —
/// it is just the bookkeeping, so the cap/order/free-a-slot invariants are
/// host-testable without a live run.
///
/// `T` is the unit of work (the spawner uses `(agent_id, goal)`). The model owns
/// only counts and the pending queue; the spawner owns the actual run futures and
/// calls [`Self::take_next`] / [`Self::complete`] as runs start and finish.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BoundedQueue<T> {
    /// Max concurrently-active items. `0` is treated as `1` (always admit one) so
    /// a misconfigured cap can never wedge the queue with nothing ever running.
    cap: usize,
    /// Items waiting for a free slot, in enqueue (FIFO) order.
    pending: std::collections::VecDeque<T>,
    /// How many items are currently active (started, not yet completed).
    active: usize,
}

impl<T> BoundedQueue<T> {
    /// A queue that admits at most `cap` active items at once (a `cap` of 0 is
    /// clamped to 1).
    pub fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            pending: std::collections::VecDeque::new(),
            active: 0,
        }
    }

    /// The effective concurrency cap (always ≥ 1).
    #[allow(dead_code)]
    pub fn cap(&self) -> usize {
        self.cap
    }

    /// Update the concurrency cap (a `cap` of 0 is clamped to 1). Lowering the cap
    /// below the active count does not preempt running items — it only stops new
    /// admissions until completions bring `active` back under the new cap. The
    /// spawner re-syncs this from `max_parallelism` on every enqueue.
    pub fn set_cap(&mut self, cap: usize) {
        self.cap = cap.max(1);
    }

    /// How many items are currently active. Status/test surface — the spawner
    /// drives the queue via `take_next`/`complete` and does not read it directly.
    #[allow(dead_code)]
    pub fn active(&self) -> usize {
        self.active
    }

    /// How many items are waiting for a slot. Status/test surface — see
    /// [`Self::active`].
    #[allow(dead_code)]
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    /// Whether a new item could start right now (a slot is free).
    fn has_free_slot(&self) -> bool {
        self.active < self.cap
    }

    /// Enqueue `item` at the back of the FIFO. It does not start here — the caller
    /// pumps the queue via [`Self::take_next`] to start as many items as the cap
    /// allows. Returning the enqueue position is a convenience for status text.
    pub fn enqueue(&mut self, item: T) {
        self.pending.push_back(item);
    }

    /// If a slot is free and an item is waiting, mark a slot used and return that
    /// item (FIFO) so the caller can start its run. `None` when the cap is reached
    /// or nothing is pending. The caller MUST eventually call [`Self::complete`]
    /// for every item this returns, or the slot leaks.
    pub fn take_next(&mut self) -> Option<T> {
        if !self.has_free_slot() {
            return None;
        }
        let item = self.pending.pop_front()?;
        self.active += 1;
        Some(item)
    }

    /// Free one active slot when a run finishes. Saturating, so an over-call (a
    /// double completion) can never underflow the count.
    pub fn complete(&mut self) {
        self.active = self.active.saturating_sub(1);
    }
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

    // === BoundedQueue (bounded-concurrency admission core) ===

    /// Drain everything the queue will admit right now, returning the items in
    /// the order they were started.
    fn drain_admitted(queue: &mut BoundedQueue<u32>) -> Vec<u32> {
        let mut started = Vec::new();
        while let Some(item) = queue.take_next() {
            started.push(item);
        }
        started
    }

    #[test]
    fn cap_of_zero_is_clamped_to_one() {
        let mut queue = BoundedQueue::<u32>::new(0);
        assert_eq!(queue.cap(), 1, "a zero cap must admit one, never wedge");
        queue.enqueue(1);
        queue.enqueue(2);
        assert_eq!(drain_admitted(&mut queue), vec![1]);
        assert_eq!(queue.active(), 1);
        assert_eq!(queue.pending_len(), 1);
    }

    #[test]
    fn at_most_cap_items_are_active_at_once() {
        let mut queue = BoundedQueue::<u32>::new(2);
        for n in 1..=5 {
            queue.enqueue(n);
        }
        // Only the cap (2) start; the remaining three wait.
        assert_eq!(drain_admitted(&mut queue), vec![1, 2]);
        assert_eq!(queue.active(), 2);
        assert_eq!(queue.pending_len(), 3);
        // No further admission while the slots are full.
        assert_eq!(queue.take_next(), None);
    }

    #[test]
    fn completion_frees_a_slot_and_preserves_fifo_order() {
        let mut queue = BoundedQueue::<u32>::new(2);
        for n in 1..=4 {
            queue.enqueue(n);
        }
        assert_eq!(drain_admitted(&mut queue), vec![1, 2]);

        // One run finishes → exactly one waiting item starts, in FIFO order.
        queue.complete();
        assert_eq!(queue.active(), 1);
        assert_eq!(drain_admitted(&mut queue), vec![3]);
        assert_eq!(queue.active(), 2);
        assert_eq!(queue.pending_len(), 1);

        // Drain the rest by completing one run at a time.
        queue.complete();
        assert_eq!(drain_admitted(&mut queue), vec![4]);
        queue.complete();
        queue.complete();
        assert_eq!(queue.active(), 0);
        assert_eq!(queue.pending_len(), 0);
    }

    #[test]
    fn single_run_still_runs_immediately_under_a_unit_cap() {
        // The single-run preservation property: enqueue one with any cap → it
        // starts at once, nothing pending.
        let mut queue = BoundedQueue::<u32>::new(3);
        queue.enqueue(42);
        assert_eq!(queue.take_next(), Some(42));
        assert_eq!(queue.active(), 1);
        assert_eq!(queue.pending_len(), 0);
    }

    #[test]
    fn complete_saturates_and_never_underflows() {
        let mut queue = BoundedQueue::<u32>::new(1);
        // A stray completion with nothing active must not underflow.
        queue.complete();
        assert_eq!(queue.active(), 0);
        // And the queue still admits normally afterward.
        queue.enqueue(7);
        assert_eq!(queue.take_next(), Some(7));
        assert_eq!(queue.active(), 1);
    }

    #[test]
    fn raising_the_cap_admits_more_pending_items_immediately() {
        let mut queue = BoundedQueue::<u32>::new(1);
        for n in 1..=3 {
            queue.enqueue(n);
        }
        assert_eq!(drain_admitted(&mut queue), vec![1]);
        // Raise the cap → the next two pending items can start without any
        // completion.
        queue.set_cap(3);
        assert_eq!(drain_admitted(&mut queue), vec![2, 3]);
        assert_eq!(queue.active(), 3);
    }

    #[test]
    fn lowering_the_cap_stops_new_admissions_without_preempting() {
        let mut queue = BoundedQueue::<u32>::new(3);
        for n in 1..=4 {
            queue.enqueue(n);
        }
        assert_eq!(drain_admitted(&mut queue), vec![1, 2, 3]);
        // Lower the cap below the active count: nothing is preempted, but no new
        // item starts until completions bring active under the new cap.
        queue.set_cap(1);
        assert_eq!(queue.active(), 3);
        assert_eq!(queue.take_next(), None);
        queue.complete();
        queue.complete();
        assert_eq!(queue.take_next(), None, "active (1) still at the new cap");
        queue.complete();
        assert_eq!(drain_admitted(&mut queue), vec![4]);
    }

    #[test]
    fn set_cap_of_zero_is_clamped_to_one() {
        let mut queue = BoundedQueue::<u32>::new(5);
        queue.set_cap(0);
        assert_eq!(queue.cap(), 1);
    }

    #[test]
    fn enqueue_after_draining_admits_when_a_slot_reopens() {
        let mut queue = BoundedQueue::<u32>::new(1);
        queue.enqueue(1);
        assert_eq!(queue.take_next(), Some(1));
        // Slot full: a later enqueue waits.
        queue.enqueue(2);
        assert_eq!(queue.take_next(), None);
        assert_eq!(queue.pending_len(), 1);
        // Freeing the slot admits the queued item.
        queue.complete();
        assert_eq!(queue.take_next(), Some(2));
    }
}
