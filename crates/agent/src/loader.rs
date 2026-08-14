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

/// WHO HOLDS A JOB (20). `main` and `summarizer` were string literals in the
/// core, so the manifest could not move either one: renaming the entry agent's
/// folder changed nothing and deleting the summarizer's stopped compaction with
/// no word anywhere. The file declares the role and this is the lookup.
///
/// FIRST DECLARATION WINS, and the list is sorted by name, so two files
/// claiming one job resolve the same way on every boot rather than by fetch
/// order. `None` is a real answer: the caller falls back to the name it has
/// always used, which is what keeps a manifest with no `role:` line working.
pub fn role_holder<'a>(specs: &'a [AgentSpec], role: &str) -> Option<&'a AgentSpec> {
    specs.iter().find(|s| s.role == role)
}
