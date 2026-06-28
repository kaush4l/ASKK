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
        id: "orchestrate_phases".to_string(),
        name: "Orchestrate phase gating".to_string(),
        initial_step: "decompose".to_string(),
        transitions: vec![
            WorkflowTransition::new("decompose", "delegate", "delegate sub-tasks"),
            WorkflowTransition::new("delegate", "delegate", "continue delegation"),
            WorkflowTransition::new("delegate", "synthesize", "synthesize results"),
            WorkflowTransition::new("synthesize", "synthesize", "finalize"),
        ],
    }]
}
