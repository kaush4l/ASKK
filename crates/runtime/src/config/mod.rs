//! Config loading: soul.md / agent.md / skills (ADR-007). Parse frontmatter,
//! build `AgentConfig`, then `validate` every reference at load — one error
//! listing ALL problems. Silent drops forbidden.

pub mod agent;
pub(crate) mod env;
pub(crate) mod fields;
pub mod frontmatter;
pub mod validate;

pub use agent::{load_soul, AgentConfig, SkillConfig};
pub use validate::validate;

use std::fmt;

/// Contract resolution: the agent's own custom contract (declared via
/// `field.N.*`, named by its id) wins over the built-in registry. Custom
/// contracts are agent-local — another agent's name never resolves here.
pub fn resolve_contract(
    agent: &AgentConfig,
    name: &str,
) -> Result<askk_core::Contract, askk_core::CoreError> {
    match &agent.custom_contract {
        Some(custom) if custom.name == name => Ok(custom.clone()),
        _ => askk_core::contracts::lookup(name),
    }
}

/// One error carrying EVERY problem found (ADR-007: fail loud, list all).
/// Each problem string is self-contained: `path:line: what went wrong`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub problems: Vec<String>,
}

impl ConfigError {
    pub fn new(problems: Vec<String>) -> Self {
        Self { problems }
    }

    pub fn one(problem: impl Into<String>) -> Self {
        Self {
            problems: vec![problem.into()],
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} config problem(s):", self.problems.len())?;
        for problem in &self.problems {
            write!(f, "\n  - {problem}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_lists_every_problem() {
        let err = ConfigError::new(vec!["a.md:1: bad".into(), "b.md:2: worse".into()]);
        let text = err.to_string();
        assert!(text.starts_with("2 config problem(s):"));
        assert!(text.contains("a.md:1: bad"));
        assert!(text.contains("b.md:2: worse"));
    }
}
