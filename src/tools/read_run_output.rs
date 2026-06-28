//! `read_run_output` — read the captured tail of the current run's execution
//! output (the `run_js` / `run_command` / `run_python` stdout the shell records
//! into a bounded per-run ring; see [`crate::engine::output_capture`]).
//!
//! This is the readable live-output surface a LATER phase uses to judge ground
//! truth: the coder's verify gate calls it to inspect the REAL output the
//! execute phase produced, rather than trusting the actor's claim. It reads a
//! bounded tail (a reference, not an unbounded log) keyed by the live run id,
//! which the shell seeds onto the snapshot before dispatch.

use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::common::integer_arg;
use super::{ToolDescriptor, ToolFuture};

/// Default number of trailing output lines returned when `max_lines` is omitted.
const DEFAULT_MAX_LINES: usize = 100;

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "read_run_output".to_string(),
        description: "Read the captured tail of THIS run's execution output — the \
                      stdout/result of every run_js, run_command, and run_python call \
                      made earlier in the run, including output produced in a previous \
                      phase you cannot otherwise see. Use this in a verification step to \
                      inspect the REAL output before judging whether the work passed. \
                      Returns the most recent output lines (a bounded tail, not a full \
                      log). Takes an optional max_lines (1-200, default 100)."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "max_lines": {
                    "type": "integer",
                    "description": "How many trailing output lines to return (1-200, default 100)."
                }
            }
        }),
    }
}

fn handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let max_lines = integer_arg(args, "max_lines")
            .unwrap_or(DEFAULT_MAX_LINES as i64)
            .clamp(1, crate::engine::output_capture::MAX_LINES_PER_RUN as i64)
            as usize;

        // The live run id is on the snapshot the shell seeds before dispatch.
        let Some(run_id) = snapshot.current_run().map(|run| run.id.clone()) else {
            return Err(
                "No active run to read output from (read_run_output is only meaningful \
                 inside a run)."
                    .to_string(),
            );
        };

        let count = crate::engine::output_capture::line_count(&run_id);
        if count == 0 {
            return Ok(
                "No execution output has been captured yet for this run. Run code with \
                 run_js / run_command / run_python first, then read it back here."
                    .to_string(),
            );
        }
        let tail = crate::engine::output_capture::tail(&run_id, max_lines);
        let shown = tail.lines().count();
        Ok(format!(
            "Captured run output (showing last {shown} of {count} line(s)):\n{tail}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::output_capture;
    use crate::state::AgentRun;

    fn snapshot_with_run(run_id: &str) -> AppSnapshot {
        let mut snapshot = AppSnapshot::default();
        let run = AgentRun {
            id: run_id.to_string(),
            goal: "g".into(),
            status: Default::default(),
            lane: Default::default(),
            scratchpad: Default::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: String::new(),
        };
        snapshot.set_current_run(Some(run));
        snapshot
    }

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "read_run_output");
        assert!(spec.input_schema["properties"]["max_lines"].is_object());
    }

    #[test]
    fn reads_the_captured_tail_for_the_active_run() {
        let run_id = "run-read-1";
        output_capture::clear(run_id);
        output_capture::capture(run_id, "PASS: add(2,3) == 5\nexit 0");
        let mut snapshot = snapshot_with_run(run_id);

        let out = pollster::block_on(handler(&mut snapshot, &json!({"max_lines": 50})))
            .expect("read must succeed when output is present");
        assert!(out.contains("PASS: add(2,3) == 5"));
        assert!(out.contains("exit 0"));
        assert!(out.contains("2 of 2 line(s)") || out.contains("last 2"));
        output_capture::clear(run_id);
    }

    #[test]
    fn empty_capture_reports_nothing_yet_not_an_error() {
        let run_id = "run-read-empty";
        output_capture::clear(run_id);
        let mut snapshot = snapshot_with_run(run_id);
        let out = pollster::block_on(handler(&mut snapshot, &json!({})))
            .expect("empty capture is informational, not an error");
        assert!(out.contains("No execution output"));
    }

    #[test]
    fn errors_when_there_is_no_active_run() {
        let mut snapshot = AppSnapshot::default();
        let err =
            pollster::block_on(handler(&mut snapshot, &json!({}))).expect_err("no run ⇒ error");
        assert!(err.contains("No active run"));
    }
}
