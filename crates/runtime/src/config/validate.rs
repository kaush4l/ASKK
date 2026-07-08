//! Load-time reference validation (ADR-007): every unknown tool/skill/
//! contract/provider/phase ref across the whole config set is reported in
//! ONE error. Also: duplicate ids, bad slugs, gate cardinality.

use std::collections::{BTreeMap, BTreeSet};

use crate::config::agent::AgentConfig;
use crate::config::ConfigError;

/// A slug: lowercase ascii letters, digits, `-`, `_`. Non-empty.
fn is_slug(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

fn known(set: &[String], name: &str) -> bool {
    set.iter().any(|k| k == name)
}

pub fn validate(
    agents: &[AgentConfig],
    known_tools: &[String],
    known_skills: &[String],
    known_contracts: &[String],
    known_providers: &[String],
) -> Result<(), ConfigError> {
    let mut problems: Vec<String> = Vec::new();
    let mut seen_ids: BTreeMap<&str, &str> = BTreeMap::new();
    for agent in agents {
        let at = agent.source_path.as_str();
        if !is_slug(&agent.id) {
            problems.push(format!(
                "{at}: id '{}' is not a slug (lowercase ascii, digits, `-`, `_`)",
                agent.id
            ));
        }
        if let Some(first) = seen_ids.insert(agent.id.as_str(), at) {
            problems.push(format!(
                "{at}: duplicate agent id '{}' (also declared in {first})",
                agent.id
            ));
        }
        for tool in &agent.tools {
            if !known(known_tools, tool) {
                problems.push(format!("{at}: unknown tool '{tool}'"));
            }
        }
        for skill in &agent.skills {
            if !known(known_skills, skill) {
                problems.push(format!("{at}: unknown skill '{skill}'"));
            }
        }
        if !known(known_contracts, &agent.contract) {
            problems.push(format!("{at}: unknown contract '{}'", agent.contract));
        }
        if !known(known_providers, &agent.provider) {
            problems.push(format!("{at}: unknown provider '{}'", agent.provider));
        }

        let phase_names: BTreeSet<&str> = agent.phases.iter().map(|p| p.name.as_str()).collect();
        let gates: Vec<&str> = agent
            .phases
            .iter()
            .filter(|p| p.gate)
            .map(|p| p.name.as_str())
            .collect();
        if gates.len() > 1 {
            problems.push(format!(
                "{at}: at most one gate phase allowed, found {}: {}",
                gates.len(),
                gates.join(", ")
            ));
        }
        for phase in &agent.phases {
            if !known(known_contracts, &phase.contract) {
                problems.push(format!(
                    "{at}: phase '{}' uses unknown contract '{}'",
                    phase.name, phase.contract
                ));
            }
            if let Some(filter) = &phase.tool_filter {
                for tool in filter {
                    if !agent.tools.contains(tool) {
                        problems.push(format!(
                            "{at}: phase '{}' tool '{tool}' is not in the agent's tools",
                            phase.name
                        ));
                    }
                }
            }
            if let Some(target) = &phase.on_fail {
                if !phase_names.contains(target.as_str()) {
                    problems.push(format!(
                        "{at}: phase '{}' on_fail target '{target}' names no phase",
                        phase.name
                    ));
                }
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(ConfigError::new(problems))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn agent(id: &str, text: &str) -> AgentConfig {
        AgentConfig::from_markdown(&format!("agents/{id}.md"), text).unwrap()
    }

    #[test]
    fn valid_set_passes() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: read\nskills: concise\nphase.1.name: plan\nphase.1.contract: plan\nphase.2.name: verify\nphase.2.contract: critique\nphase.2.gate: true\nphase.2.on_fail: plan\nphase.2.tools: read\n---\n",
        );
        validate(
            &[a],
            &strs(&["read"]),
            &strs(&["concise"]),
            &strs(&["react", "plan", "critique"]),
            &strs(&["default"]),
        )
        .unwrap();
    }

    #[test]
    fn every_unknown_ref_lands_in_one_error() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: ghost_tool\nskills: ghost_skill\nphase.1.name: plan\nphase.2.name: verify\nphase.2.gate: true\nphase.2.on_fail: nowhere\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("unknown tool 'ghost_tool'"));
        assert!(joined.contains("unknown skill 'ghost_skill'"));
        assert!(joined.contains("on_fail target 'nowhere' names no phase"));
        assert_eq!(err.problems.len(), 3);
    }

    #[test]
    fn duplicate_ids_and_bad_slugs_are_errors() {
        let a = agent("coder", "---\nid: coder\n---\n");
        let mut b = agent("coder2", "---\nid: coder\n---\n");
        b.id = "coder".into();
        let mut c = agent("bad", "---\nid: bad\n---\n");
        c.id = "Bad Slug!".into();
        let err = validate(
            &[a, b, c],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("duplicate agent id 'coder'"));
        assert!(joined.contains("also declared in agents/coder.md"));
        assert!(joined.contains("'Bad Slug!' is not a slug"));
    }

    #[test]
    fn two_gate_phases_are_rejected() {
        let a = agent(
            "coder",
            "---\nid: coder\nphase.1.name: a\nphase.1.gate: true\nphase.2.name: b\nphase.2.gate: true\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("at most one gate phase"));
    }

    #[test]
    fn phase_tools_must_subset_agent_tools() {
        let a = agent(
            "coder",
            "---\nid: coder\ntools: read\nphase.1.name: p\nphase.1.tools: write\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&["read", "write"]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("'write' is not in the agent's tools"));
    }

    #[test]
    fn unknown_contract_and_provider_are_errors() {
        let a = agent(
            "a",
            "---\nid: a\ncontract: mystery\nprovider: nobody\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("unknown contract 'mystery'"));
        assert!(joined.contains("unknown provider 'nobody'"));
    }
}
