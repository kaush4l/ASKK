//! MANY AGENT FILES AT ONCE: which one wins when two share a name, what
//! happens to one that will not parse, and who holds a declared job. The
//! parent module parses a single file; nothing here reads one.

use crate::error::AgentError;
use crate::spec::{parse_agent_file, AgentSpec, ROLES};

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
    settle_roles(&mut found, &mut problems);
    (found, problems)
}

/// TWO FILES CLAIMING ONE JOB (increment 30). Copying `main/agent.md` is how a
/// person writes a new agent, and that file carries `role: entry` — so the copy
/// held the role too, `problems` came back EMPTY, and the page started talking
/// to whichever name sorted first. Determinism was never the defect; silence
/// was, and the two are different properties: [`role_holder`] still resolves
/// the same way on every boot, and now the boot SAYS a job was contested.
///
/// THE RULING: the loser is reported AND stripped, rather than merely reported.
/// Stripping is what makes the state match the resolution. `spec.role` is read
/// in more places than the lookup below — the agent's card prints it, and
/// `paper::adopt` reads it — so a loser that keeps the word is a file saying it
/// holds a job it does not hold, which is the "setting that looks applied"
/// failure `spec::mod` refuses everywhere else. It costs that one agent its
/// ROLE and nothing else: it still loads, still answers, still has its tools,
/// which is the same bargain a malformed file gets above.
fn settle_roles(found: &mut [AgentSpec], problems: &mut Vec<String>) {
    for role in ROLES {
        let claimants: Vec<String> =
            found.iter().filter(|s| s.role == role).map(|s| s.name.clone()).collect();
        let Some((winner, losers)) = claimants.split_first() else {
            continue;
        };
        if losers.is_empty() {
            continue;
        }
        problems.push(format!(
            "{} agents declare `role: {role}` ({}); {winner} holds it because it sorts first,              and the rest hold no role. Delete the line from all but one.",
            claimants.len(),
            claimants.join(", ")
        ));
        for spec in found.iter_mut().filter(|s| losers.contains(&s.name)) {
            spec.role.clear();
        }
    }
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
