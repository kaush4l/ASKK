//! Authoring an agent: a spec rendered back out as the `agent.md` a
//! `public/agents/` folder holds, and a new spec from the handful of things an
//! author actually chooses.
//!
//! `render_agent_file` is the stated INVERSE of `parse_agent_file`. That is the
//! whole point of increment 11: an agent written in the browser exports to a
//! file that can be dropped into `public/agents/` unchanged, and a file from
//! there imports unchanged — one format, no second dialect for authored
//! agents (I9). Pure, so the round trip is pinned on the host (I3).

use crate::spec::AgentSpec;

/// One frontmatter value, on one line. A newline inside a value would close
/// the frontmatter early and produce a file that will not parse back — a
/// broken export is worse than a rejected character.
fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A name that can be a folder under `public/agents/`, which is what an
/// exported agent becomes. Same rule as a space's name, and for the same
/// reason: it is written into a path.
pub fn usable_agent_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The spec as `agent.md`. Every key is written even when empty, so the file
/// reads as a form somebody can edit rather than as a puzzle about which keys
/// are permitted.
pub fn render_agent_file(spec: &AgentSpec) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", one_line(&spec.name)));
    out.push_str(&format!("description: {}\n", one_line(&spec.description)));
    out.push_str(&format!("model: {}\n", one_line(&spec.model)));
    if let Some(temperature) = spec.temperature {
        out.push_str(&format!("temperature: {temperature}\n"));
    }
    out.push_str(&format!("engine: {}\n", one_line(&spec.engine)));
    out.push_str(&format!("space: {}\n", one_line(&spec.space)));
    out.push_str(&format!("tools: [{}]\n", spec.tools.join(", ")));
    out.push_str(&format!("compact_at: {}\n", spec.compact_at));
    out.push_str(&format!("keep_recent: {}\n", spec.keep_recent));
    out.push_str("---\n\n");
    out.push_str(spec.prompt.trim());
    out.push('\n');
    out
}

/// A new agent from the five things an author chooses. Everything else takes
/// the same default `parse_agent_file` gives a file that omits the key, so an
/// agent written through this constructor and one written as a file by hand
/// cannot end up with different compaction settings by accident.
///
/// `engine` is `react` because that is what every shipped agent declares; an
/// authored agent whose card read `engine: base` beside three that read
/// `react` would advertise a difference the system does not have (I9).
pub fn new_spec(
    name: &str,
    description: &str,
    prompt: &str,
    tools: &[String],
    space: &str,
) -> AgentSpec {
    AgentSpec {
        name: one_line(name),
        description: one_line(description),
        model: String::new(),
        temperature: None,
        engine: "react".into(),
        tools: tools.iter().map(|t| one_line(t)).filter(|t| !t.is_empty()).collect(),
        space: one_line(space),
        compact_at: crate::state::default_compact_at(),
        keep_recent: crate::state::default_keep_recent(),
        prompt: prompt.trim().to_string(),
    }
}
