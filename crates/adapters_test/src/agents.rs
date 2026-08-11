//! The `AgentPort` fake — sub-agents that answer from a script. Split from
//! lib.rs to hold the 200-line rule.

use std::cell::RefCell;

use kernel::{AgentPort, BoxFuture, DelegateError};

use crate::ready;

/// Sub-agents that answer from a script, by name (the `AgentPort` fake). A
/// name with an `Err` answer is an agent whose turn RAISED — the case that
/// must reach the board as `Failed` carrying its own message; a name that is
/// not here at all is not loaded.
#[derive(Debug, Default)]
pub struct ScriptedAgents {
    answers: Vec<(String, Result<String, String>)>,
    /// The order goals actually arrived in — what a test asserts when it cares
    /// that one line of calls ran together and the next line ran after.
    pub seen: RefCell<Vec<String>>,
}

impl ScriptedAgents {
    /// `(agent, Ok(answer) | Err(message))`, one entry per loaded agent.
    pub fn with(answers: Vec<(&str, Result<&str, &str>)>) -> ScriptedAgents {
        ScriptedAgents {
            answers: answers
                .into_iter()
                .map(|(n, a)| {
                    (
                        n.to_string(),
                        a.map(str::to_string).map_err(str::to_string),
                    )
                })
                .collect(),
            seen: RefCell::new(Vec::new()),
        }
    }

    /// No sub-agents at all — every delegation is to an unknown agent.
    pub fn none() -> ScriptedAgents {
        ScriptedAgents::default()
    }
}

impl AgentPort for ScriptedAgents {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>> {
        self.seen.borrow_mut().push(format!("{agent}: {goal}"));
        let result = match self.answers.iter().find(|(n, _)| n == agent) {
            None => Err(DelegateError::Unknown {
                agent: agent.to_string(),
            }),
            Some((_, Ok(answer))) => Ok(answer.clone()),
            Some((_, Err(message))) => Err(DelegateError::Failed {
                agent: agent.to_string(),
                message: message.clone(),
            }),
        };
        ready(result)
    }
}
