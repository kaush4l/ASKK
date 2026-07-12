//! Load-time reference validation (ADR-007): every unknown tool/skill/
//! contract/provider/phase ref across the whole config set is reported in
//! ONE error. Also: duplicate ids, bad slugs, gate cardinality.

use std::collections::BTreeMap;

use askk_core::{FieldKind, Phase};

use crate::config::agent::AgentConfig;
use crate::config::{resolve_contract, ConfigError};

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
        // A contract name resolves from the built-in registry OR the agent's
        // OWN custom contract (agent-local: another agent's custom name is
        // unknown here — resolve_contract could never honor it at runtime).
        let contract_known = |name: &str| {
            known(known_contracts, name)
                || agent
                    .custom_contract
                    .as_ref()
                    .is_some_and(|c| c.name == name)
        };
        if !contract_known(&agent.contract) {
            problems.push(format!("{at}: unknown contract '{}'", agent.contract));
        }
        if !known(known_providers, &agent.provider) {
            problems.push(format!("{at}: unknown provider '{}'", agent.provider));
        }

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
        check_custom_contract(agent, &mut problems);
        for (idx, phase) in agent.phases.iter().enumerate() {
            if !contract_known(&phase.contract) {
                problems.push(format!(
                    "{at}: phase '{}' uses unknown contract '{}'",
                    phase.name, phase.contract
                ));
            }
            check_fan_out(agent, idx, phase, &mut problems);
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
                // A rewind edge must point strictly backwards: answer routing
                // only searches phases before the failing one (ADR-008).
                match agent.phases.iter().position(|p| &p.name == target) {
                    None => problems.push(format!(
                        "{at}: phase '{}' on_fail target '{target}' names no phase",
                        phase.name
                    )),
                    Some(t) if t >= idx => problems.push(format!(
                        "{at}: phase '{}' on_fail target '{target}' must name an earlier phase",
                        phase.name
                    )),
                    Some(_) => {}
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

/// A custom contract must carry the fields the runtime reads wherever it is
/// ACTIVE: `action`/`answer` for tool dispatch (core toolcall::derive_action)
/// when tools are in reach, `verdict` for gate routing (run/answer.rs).
/// Misconfig fails at load, never as runtime misbehavior.
fn check_custom_contract(agent: &AgentConfig, problems: &mut Vec<String>) {
    let Some(custom) = &agent.custom_contract else {
        return;
    };
    let at = agent.source_path.as_str();
    let field = |name: &str| custom.fields.iter().find(|f| f.name == name);
    let has_enum_with = |name: &str, needed: &[&str]| {
        field(name).is_some_and(|f| match &f.kind {
            FieldKind::Enum(variants) => needed.iter().all(|n| variants.iter().any(|v| v == n)),
            _ => false,
        })
    };
    let phase_has_tools = |p: &Phase| match &p.tool_filter {
        Some(filter) => filter.iter().any(|t| agent.tools.contains(t)),
        None => !agent.tools.is_empty(),
    };
    let custom_with_tools = if agent.phases.is_empty() {
        agent.contract == custom.name && !agent.tools.is_empty()
    } else {
        agent
            .phases
            .iter()
            .any(|p| p.contract == custom.name && phase_has_tools(p))
    };
    if custom_with_tools {
        if !has_enum_with("action", &["tool", "answer"]) {
            problems.push(format!(
                "{at}: custom contract '{}' is used with tools but has no `action` \
                 enum field containing tool|answer",
                custom.name
            ));
        }
        if field("answer").is_none() {
            problems.push(format!(
                "{at}: custom contract '{}' is used with tools but has no `answer` field",
                custom.name
            ));
        }
    }
    let on_gate = agent
        .phases
        .iter()
        .any(|p| p.gate && p.contract == custom.name);
    if on_gate && !has_enum_with("verdict", &["pass", "revise"]) {
        problems.push(format!(
            "{at}: custom contract '{}' is used on a gate phase but has no `verdict` \
             enum field containing pass|revise",
            custom.name
        ));
    }
}

/// `fan_out`/`parts` come as a pair: the tool must be in the agent's tools
/// and `parts` must name a List field of the PREVIOUS phase's contract.
fn check_fan_out(agent: &AgentConfig, idx: usize, phase: &Phase, problems: &mut Vec<String>) {
    let at = agent.source_path.as_str();
    let (tool, parts) = match (&phase.fan_out, &phase.parts) {
        (None, None) => return,
        (Some(tool), Some(parts)) => (tool, parts),
        _ => {
            problems.push(format!(
                "{at}: phase '{}' needs both `fan_out` and `parts` (or neither)",
                phase.name
            ));
            return;
        }
    };
    if !agent.tools.contains(tool) {
        problems.push(format!(
            "{at}: phase '{}' fan_out tool '{tool}' is not in the agent's tools",
            phase.name
        ));
    }
    let Some(prev) = idx.checked_sub(1).map(|i| &agent.phases[i]) else {
        problems.push(format!(
            "{at}: phase '{}' declares fan_out but has no previous phase to take `parts` from",
            phase.name
        ));
        return;
    };
    // Only checkable when the previous contract resolves; an unknown
    // contract is already its own problem above.
    if let Ok(contract) = resolve_contract(agent, &prev.contract) {
        let is_list = contract
            .fields
            .iter()
            .any(|f| &f.name == parts && f.kind == FieldKind::List);
        if !is_list {
            problems.push(format!(
                "{at}: phase '{}' parts '{parts}' is not a List field of the previous \
                 phase's contract '{}'",
                phase.name, contract.name
            ));
        }
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
    fn on_fail_must_target_an_earlier_phase() {
        // Gate naming itself, and a phase naming a LATER phase: both are
        // misrouted rewinds answer routing could never take — reject loud.
        let a = agent(
            "selfref",
            "---\nid: selfref\nphase.1.name: plan\nphase.2.name: verify\n\
             phase.2.gate: true\nphase.2.on_fail: verify\n---\n",
        );
        let b = agent(
            "late",
            "---\nid: late\nphase.1.name: check\nphase.1.on_fail: fix\n\
             phase.2.name: fix\n---\n",
        );
        let err = validate(
            &[a, b],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(
            joined.contains("phase 'verify' on_fail target 'verify' must name an earlier phase")
        );
        assert!(joined.contains("phase 'check' on_fail target 'fix' must name an earlier phase"));
        assert_eq!(err.problems.len(), 2);
    }

    /// A complete custom contract (action/answer/verdict) is accepted at
    /// agent level, on phases, and on a gate.
    #[test]
    fn valid_custom_contract_passes() {
        let a = agent(
            "own",
            "---\nid: own\ntools: read\ncontract: own\n\
             field.1.name: action\nfield.1.kind: enum: tool|answer\n\
             field.2.name: answer\nfield.2.required: false\n\
             field.3.name: verdict\nfield.3.kind: enum: pass|revise\nfield.3.required: false\n\
             phase.1.name: work\nphase.1.contract: own\n\
             phase.2.name: check\nphase.2.contract: own\nphase.2.gate: true\n---\n",
        );
        validate(
            &[a],
            &strs(&["read"]),
            &strs(&[]),
            &strs(&["react", "plan", "critique"]),
            &strs(&["default"]),
        )
        .unwrap();
    }

    #[test]
    fn custom_contract_with_tools_needs_action_and_answer() {
        // Active custom contract, tools present, but only a `notes` field.
        let a = agent(
            "own",
            "---\nid: own\ntools: read\ncontract: own\nfield.1.name: notes\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&["read"]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("no `action` enum field containing tool|answer"));
        assert!(joined.contains("no `answer` field"));
        assert_eq!(err.problems.len(), 2);
    }

    #[test]
    fn custom_contract_on_gate_needs_verdict() {
        let a = agent(
            "own",
            "---\nid: own\ncontract: react\nfield.1.name: score\n\
             phase.1.name: work\nphase.2.name: check\nphase.2.contract: own\n\
             phase.2.gate: true\n---\n",
        );
        let err = validate(
            &[a],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("no `verdict` enum field containing pass|revise"));
    }

    /// Custom contracts are agent-local: another agent referencing one is an
    /// unknown contract (resolve_contract could never honor it at runtime).
    #[test]
    fn custom_contracts_do_not_leak_across_agents() {
        let a = agent("owner", "---\nid: owner\nfield.1.name: notes\n---\n");
        let b = agent("thief", "---\nid: thief\ncontract: owner\n---\n");
        let err = validate(
            &[a, b],
            &strs(&[]),
            &strs(&[]),
            &strs(&["react"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        assert!(err.problems[0].contains("unknown contract 'owner'"));
        assert_eq!(err.problems.len(), 1);
    }

    #[test]
    fn fan_out_refs_are_checked() {
        // ghost tool + parts naming a non-List field of the previous contract.
        let a = agent(
            "fan",
            "---\nid: fan\ntools: worker\nphase.1.name: plan\nphase.1.contract: plan\n\
             phase.2.name: out\nphase.2.fan_out: ghost\nphase.2.parts: rationale\n---\n",
        );
        // fan_out on the first phase + fan_out without parts.
        let b = agent(
            "first",
            "---\nid: first\ntools: worker\nphase.1.name: out\nphase.1.fan_out: worker\n\
             phase.1.parts: steps\nphase.2.name: half\nphase.2.fan_out: worker\n---\n",
        );
        let err = validate(
            &[a, b],
            &strs(&["worker", "ghost"]),
            &strs(&[]),
            &strs(&["react", "plan"]),
            &strs(&["default"]),
        )
        .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("fan_out tool 'ghost' is not in the agent's tools"));
        assert!(joined.contains("parts 'rationale' is not a List field"));
        assert!(joined.contains("has no previous phase"));
        assert!(joined.contains("needs both `fan_out` and `parts`"));
        assert_eq!(err.problems.len(), 4);
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
