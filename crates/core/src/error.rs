//! One workspace error enum for core.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// Contract name not in the registry — load-time hard error (ADR-007).
    UnknownContract(String),
    /// Tool name outside the run's allowlist.
    UnknownTool(String),
    /// A reply that could not be parsed against its contract.
    Parse(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::UnknownContract(name) => write!(f, "unknown contract '{name}'"),
            CoreError::UnknownTool(name) => write!(f, "unknown tool '{name}'"),
            CoreError::Parse(msg) => write!(f, "parse error: {msg}"),
        }
    }
}

impl std::error::Error for CoreError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_names_the_problem() {
        assert_eq!(
            CoreError::UnknownContract("bogus".into()).to_string(),
            "unknown contract 'bogus'"
        );
        assert_eq!(
            CoreError::UnknownTool("rm".into()).to_string(),
            "unknown tool 'rm'"
        );
        assert!(CoreError::Parse("bad".into()).to_string().contains("bad"));
    }
}
