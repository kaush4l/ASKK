#![allow(dead_code)]

use crate::state::{Agent, AgentRun, AppSnapshot};
use serde::{Deserialize, Serialize};

// These message enums intentionally carry a full `AppSnapshot` in one variant so a
// run can be dispatched to / returned from a Web Worker in a single post. The size
// asymmetry is by design, not a mistake.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WorkerCommand {
    Dispatch(WorkerDispatch),
    Cancel(WorkerCancel),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerDispatch {
    pub run_id: String,
    pub worker_id: String,
    pub goal: String,
    pub agent: Agent,
    pub snapshot: AppSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkerCancel {
    pub run_id: String,
    pub worker_id: String,
    pub reason: String,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WorkerEvent {
    Ready { worker_id: String },
    Progress(WorkerProgress),
    Result(WorkerResult),
    Cancelled(WorkerCancel),
    Error(WorkerError),
}

impl WorkerEvent {
    pub fn run_id(&self) -> Option<&str> {
        match self {
            Self::Ready { .. } => None,
            Self::Progress(progress) => Some(&progress.run_id),
            Self::Result(result) => Some(&result.run_id),
            Self::Cancelled(cancel) => Some(&cancel.run_id),
            Self::Error(error) => Some(&error.run_id),
        }
    }

    pub fn worker_id(&self) -> Option<&str> {
        match self {
            Self::Ready { worker_id } => Some(worker_id),
            Self::Progress(progress) => Some(&progress.worker_id),
            Self::Result(result) => Some(&result.worker_id),
            Self::Cancelled(cancel) => Some(&cancel.worker_id),
            Self::Error(error) => Some(&error.worker_id),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerProgress {
    pub run_id: String,
    pub worker_id: String,
    pub message: String,
    pub run: AgentRun,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerResult {
    pub run_id: String,
    pub worker_id: String,
    pub status: WorkerStatus,
    pub answer: String,
    pub trace: Vec<String>,
    pub snapshot: AppSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkerError {
    pub run_id: String,
    pub worker_id: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Agent, AppSnapshot, default_tool_names};

    #[test]
    fn worker_dispatch_message_round_trips_through_json() {
        let message = WorkerCommand::Dispatch(WorkerDispatch {
            run_id: "run-1".to_string(),
            worker_id: "worker-a".to_string(),
            goal: "Compare two sources".to_string(),
            agent: Agent::new(
                "Researcher",
                "Use tools for evidence.",
                default_tool_names(),
            ),
            snapshot: AppSnapshot::default(),
        });

        let encoded = serde_json::to_string(&message).unwrap();
        let decoded: WorkerCommand = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded, message);
    }

    #[test]
    fn worker_result_message_carries_structured_status_trace_and_snapshot() {
        let result = WorkerResult {
            run_id: "run-1".to_string(),
            worker_id: "worker-a".to_string(),
            status: WorkerStatus::Succeeded,
            answer: "Done".to_string(),
            trace: vec!["started".to_string(), "finished".to_string()],
            snapshot: AppSnapshot::default(),
        };
        let message = WorkerEvent::Result(result.clone());

        assert_eq!(message.run_id(), Some("run-1"));
        assert_eq!(message.worker_id(), Some("worker-a"));
        assert_eq!(result.trace.len(), 2);
        assert_eq!(result.snapshot.status, "Ready");
    }

    #[test]
    fn worker_progress_carries_live_agent_run() {
        let mut live_run = crate::state::AgentRun {
            id: "agent-run-1".to_string(),
            goal: "subtask".to_string(),
            status: "running".to_string(),
            lane: crate::state::RunLane::BoundedTask,
            scratchpad: crate::state::RunScratchpad::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        };
        live_run.final_answer = "partial".to_string();
        let progress = WorkerProgress {
            run_id: "run-1".to_string(),
            worker_id: "worker-a".to_string(),
            message: "running bounded task".to_string(),
            run: live_run.clone(),
        };

        let encoded = serde_json::to_string(&WorkerEvent::Progress(progress)).unwrap();
        let decoded: WorkerEvent = serde_json::from_str(&encoded).unwrap();

        match decoded {
            WorkerEvent::Progress(progress) => assert_eq!(progress.run, live_run),
            other => panic!("expected progress event, got {other:?}"),
        }
    }
}
