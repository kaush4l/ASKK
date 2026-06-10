use crate::state::{WorkflowDefinition, WorkflowRuntimeState};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkflowGate {
    definition: WorkflowDefinition,
    state: WorkflowRuntimeState,
}

impl WorkflowGate {
    pub fn new(definition: WorkflowDefinition) -> Self {
        let state = WorkflowRuntimeState {
            workflow_id: definition.id.clone(),
            current_step: definition.initial_step.clone(),
            history: vec![definition.initial_step.clone()],
            blocked_transition: String::new(),
        };
        Self { definition, state }
    }

    pub fn state(&self) -> WorkflowRuntimeState {
        self.state.clone()
    }

    pub fn transition_to(&mut self, next_step: &str) -> Result<WorkflowRuntimeState, String> {
        if self.definition.transitions.iter().any(|transition| {
            transition.from == self.state.current_step && transition.to == next_step
        }) {
            self.state.current_step = next_step.to_string();
            self.state.history.push(next_step.to_string());
            self.state.blocked_transition.clear();
            return Ok(self.state());
        }

        let feedback = format!(
            "Workflow `{}` blocks transition `{}` -> `{}`.",
            self.definition.id, self.state.current_step, next_step
        );
        self.state.blocked_transition = feedback.clone();
        Err(feedback)
    }
}

pub fn find_workflow<'a>(
    workflows: &'a [WorkflowDefinition],
    id: &str,
) -> Option<&'a WorkflowDefinition> {
    workflows.iter().find(|workflow| workflow.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{WorkflowDefinition, WorkflowTransition};

    fn workflow() -> WorkflowDefinition {
        WorkflowDefinition {
            id: "test_workflow".to_string(),
            name: "Test workflow".to_string(),
            initial_step: "decompose".to_string(),
            transitions: vec![
                WorkflowTransition::new("decompose", "delegate", "delegate sub-tasks"),
                WorkflowTransition::new("delegate", "synthesize", "synthesize results"),
            ],
        }
    }

    #[test]
    fn allows_declared_transition() {
        let mut gate = WorkflowGate::new(workflow());

        let state = gate.transition_to("delegate").unwrap();

        assert_eq!(state.current_step, "delegate");
        assert_eq!(state.history, vec!["decompose", "delegate"]);
    }

    #[test]
    fn blocks_undeclared_transition_and_records_feedback() {
        let mut gate = WorkflowGate::new(workflow());

        let err = gate.transition_to("synthesize").unwrap_err();

        assert!(err.contains("blocks transition `decompose` -> `synthesize`"));
        assert_eq!(gate.state().current_step, "decompose");
        assert!(gate.state().blocked_transition.contains("decompose"));
    }
}
