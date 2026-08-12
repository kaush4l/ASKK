//! Loading MANY agent files: which one wins when two share a name, and what
//! happens to one that will not parse. Split from `spec.rs`, which parses a
//! single file, so both hold the 200-line rule (I12).

use crate::error::AgentError;
use crate::spec::{parse_agent_file, AgentSpec};

/// Every agent, from files given built-ins FIRST and the project's second — so
/// a project agent of the same name REPLACES the built-in (Python
/// `registry._agent_dirs`). A file that will not parse costs that one agent:
/// the rest still load. Result order is by name, so the UI is deterministic.
///
/// Skipping is correct; SILENCE is not (`ux-walker`, increment 03). The second
/// return is one sentence per unreadable file, for the UI to show.
pub fn load_agents<I>(files: I) -> (Vec<AgentSpec>, Vec<String>)
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut found: Vec<AgentSpec> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    for (dir, text) in files {
        let spec = match parse_agent_file(&dir, &text) {
            Ok(spec) => spec,
            Err(AgentError::MalformedAgentFile { message, .. }) => {
                problems.push(format!("{dir}/agent.md could not be read: {message}"));
                continue;
            }
            Err(other) => {
                problems.push(format!("{dir}/agent.md could not be read: {other:?}"));
                continue;
            }
        };
        match found.iter().position(|s| s.name == spec.name) {
            Some(i) => found[i] = spec,
            None => found.push(spec),
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    (found, problems)
}
