//! Per-instance ring buffer of recent run output (terminal/process stdout tails).
//!
//! The actor phase runs code via `run_js` / `run_command` and only sees each
//! tool's own [`ToolResult`]. The verify phase needs to inspect the *real*
//! output the run produced — including output the actor never folded back into
//! its answer — to judge ground truth. This module is that surface: a bounded,
//! per-run ring buffer the shell appends captured output lines to, and the
//! `read_run_output` tool (and an artifact resolver) reads the tail from.
//!
//! WASM is single-threaded, so a thread-local store is sufficient (same idiom as
//! [`super::process_registry`]). Storage is **bounded** — only the most recent
//! [`MAX_LINES_PER_RUN`] lines per run survive, so this is a tail/reference, not
//! an unbounded transcript (projection-by-reference). The page and the dedicated
//! agent worker each get their own (empty) instance, which is fine: capture and
//! read happen on the same side as the run.

use std::cell::RefCell;
use std::collections::VecDeque;

/// Most recent output lines retained per run. A capture past this drops the
/// oldest line — the buffer is a tail the verifier reads, never a full log.
pub const MAX_LINES_PER_RUN: usize = 200;

/// Total runs tracked before the oldest run's buffer is evicted. Keeps a long
/// session (many runs) from growing the store without bound.
const MAX_RUNS: usize = 32;

/// One run's captured output: its id and a bounded line ring.
struct RunOutput {
    run_id: String,
    lines: VecDeque<String>,
}

thread_local! {
    /// Per-run output buffers in insertion order (oldest run first), behind a
    /// `RefCell` for the single-threaded wasm runtime.
    static OUTPUT: RefCell<VecDeque<RunOutput>> = const { RefCell::new(VecDeque::new()) };
}

/// Append `text` (split into lines) to `run_id`'s buffer, creating it on first
/// use and trimming to the most recent [`MAX_LINES_PER_RUN`] lines. Blank lines
/// are kept (output spacing is evidence); a wholly empty `text` is a no-op.
pub fn capture(run_id: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    OUTPUT.with(|store| {
        let mut store = store.borrow_mut();
        let idx = match store.iter().position(|run| run.run_id == run_id) {
            Some(idx) => idx,
            None => {
                // Evict the oldest run once we exceed the run cap.
                if store.len() >= MAX_RUNS {
                    store.pop_front();
                }
                store.push_back(RunOutput {
                    run_id: run_id.to_string(),
                    lines: VecDeque::new(),
                });
                store.len() - 1
            }
        };
        let run = &mut store[idx];
        for line in text.lines() {
            run.lines.push_back(line.to_string());
            while run.lines.len() > MAX_LINES_PER_RUN {
                run.lines.pop_front();
            }
        }
    });
}

/// The captured tail for `run_id`: the last `max_lines` lines (or all of them
/// when fewer), newline-joined. Empty string when nothing was captured.
pub fn tail(run_id: &str, max_lines: usize) -> String {
    OUTPUT.with(|store| {
        let store = store.borrow();
        let Some(run) = store.iter().find(|run| run.run_id == run_id) else {
            return String::new();
        };
        let take = max_lines.min(run.lines.len());
        let start = run.lines.len() - take;
        run.lines
            .iter()
            .skip(start)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    })
}

/// Number of lines currently buffered for `run_id` (0 when none/unknown). Used
/// by the resolver to decide whether to surface an artifact at all.
pub fn line_count(run_id: &str) -> usize {
    OUTPUT.with(|store| {
        store
            .borrow()
            .iter()
            .find(|run| run.run_id == run_id)
            .map(|run| run.lines.len())
            .unwrap_or(0)
    })
}

/// Drop a run's buffer (e.g. on run completion). A no-op for unknown ids.
pub fn clear(run_id: &str) {
    OUTPUT.with(|store| {
        store.borrow_mut().retain(|run| run.run_id != run_id);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset(run_id: &str) {
        clear(run_id);
    }

    #[test]
    fn capture_then_tail_returns_recent_lines_in_order() {
        let run = "run-cap-1";
        reset(run);
        capture(run, "first\nsecond");
        capture(run, "third");
        assert_eq!(tail(run, 10), "first\nsecond\nthird");
        assert_eq!(line_count(run), 3);
        // The tail is bounded by max_lines (most recent win).
        assert_eq!(tail(run, 2), "second\nthird");
        reset(run);
    }

    #[test]
    fn ring_buffer_drops_oldest_past_the_cap() {
        let run = "run-cap-2";
        reset(run);
        for i in 0..(MAX_LINES_PER_RUN + 50) {
            capture(run, &format!("line {i}"));
        }
        // Only the most recent MAX_LINES_PER_RUN survive.
        assert_eq!(line_count(run), MAX_LINES_PER_RUN);
        let tail = tail(run, MAX_LINES_PER_RUN);
        let first_kept = tail.lines().next().unwrap();
        // The first 50 lines were evicted, so line 50 is the oldest surviving.
        assert_eq!(first_kept, "line 50");
        assert!(tail.ends_with(&format!("line {}", MAX_LINES_PER_RUN + 49)));
        reset(run);
    }

    #[test]
    fn unknown_run_yields_empty_tail_and_zero_count() {
        assert_eq!(tail("never-captured", 10), "");
        assert_eq!(line_count("never-captured"), 0);
    }

    #[test]
    fn capture_is_per_run_and_clear_is_scoped() {
        let (a, b) = ("run-cap-a", "run-cap-b");
        reset(a);
        reset(b);
        capture(a, "alpha");
        capture(b, "beta");
        assert_eq!(tail(a, 10), "alpha");
        assert_eq!(tail(b, 10), "beta");
        clear(a);
        assert_eq!(tail(a, 10), "");
        assert_eq!(
            tail(b, 10),
            "beta",
            "clearing one run leaves the other intact"
        );
        reset(b);
    }

    #[test]
    fn empty_capture_is_a_noop() {
        let run = "run-cap-empty";
        reset(run);
        capture(run, "");
        assert_eq!(line_count(run), 0);
        reset(run);
    }
}
