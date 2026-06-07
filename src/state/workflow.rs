//! Declarative workflow definitions: the allowed lifecycle transitions a run may
//! move through, and the live runtime state tracking the current step. The gate
//! that enforces these lives in `crate::workflow`; this module is just the data.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowTransition {
    pub from: String,
    pub to: String,
    pub label: String,
}

impl WorkflowTransition {
    pub fn new(from: impl Into<String>, to: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            label: label.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub initial_step: String,
    #[serde(default)]
    pub transitions: Vec<WorkflowTransition>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct WorkflowRuntimeState {
    #[serde(default)]
    pub workflow_id: String,
    #[serde(default)]
    pub current_step: String,
    #[serde(default)]
    pub history: Vec<String>,
    #[serde(default)]
    pub blocked_transition: String,
}

pub fn default_workflows() -> Vec<WorkflowDefinition> {
    vec![WorkflowDefinition {
        id: "parallel_batch".to_string(),
        name: "Parallel batch orchestration".to_string(),
        initial_step: "planned".to_string(),
        transitions: vec![
            WorkflowTransition::new("planned", "workers_running", "dispatch child workers"),
            WorkflowTransition::new("workers_running", "workers_running", "dispatch next wave"),
            WorkflowTransition::new("workers_running", "workers_joined", "join child worker"),
            WorkflowTransition::new(
                "workers_joined",
                "workers_joined",
                "join another child worker",
            ),
            WorkflowTransition::new("workers_joined", "workers_running", "dispatch next wave"),
            WorkflowTransition::new("workers_joined", "aggregated", "aggregate child results"),
            WorkflowTransition::new("workers_running", "failed", "child worker failed"),
            WorkflowTransition::new("workers_joined", "failed", "aggregation failed"),
            WorkflowTransition::new("failed", "failed", "remain failed"),
        ],
    }]
}
