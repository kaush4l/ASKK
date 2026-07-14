//! Load-time reference validation (ADR-007): every unknown tool/skill/
//! contract/provider/phase ref across the whole config set is reported in
//! ONE error. Also: duplicate ids, bad slugs, gate cardinality.

use std::collections::BTreeMap;

use askk_core::{FieldKind, Phase};

use crate::config::agent::AgentConfig;
use crate::config::team::TeamConfig;
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
    teams: &[TeamConfig],
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
            if let Some(filter) = &phase.skill_filter {
                for skill in filter {
                    if !agent.skills.contains(skill) {
                        problems.push(format!(
                            "{at}: phase '{}' skill '{skill}' is not in the agent's skills",
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
    for team in teams {
        check_team(team, agents, known_tools, &mut seen_ids, &mut problems);
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(ConfigError::new(problems))
    }
}

/// A team (ADR-032): id shares the agent namespace (both become delegate
/// tools), the lead must live in the team's folder, the folder must hold
/// members, tools must exist, and team.md nests at most one folder deep
/// (team-in-team deferred).
fn check_team<'a>(
    team: &'a TeamConfig,
    agents: &[AgentConfig],
    known_tools: &[String],
    seen_ids: &mut BTreeMap<&'a str, &'a str>,
    problems: &mut Vec<String>,
) {
    let at = team.source_path.as_str();
    if !is_slug(&team.id) {
        problems.push(format!(
            "{at}: id '{}' is not a slug (lowercase ascii, digits, `-`, `_`)",
            team.id
        ));
    }
    if let Some(first) = seen_ids.insert(team.id.as_str(), at) {
        problems.push(format!(
            "{at}: duplicate id '{}' (also declared in {first})",
            team.id
        ));
    }
    if at.matches('/').count() != 2 {
        problems.push(format!(
            "{at}: team.md must sit exactly one folder below agents/ \
             (team-in-team is not supported yet)"
        ));
    }
    for tool in &team.tools {
        if !known(known_tools, tool) {
            problems.push(format!("{at}: unknown tool '{tool}'"));
        }
    }
    let members = team.members(agents);
    if members.is_empty() {
        problems.push(format!("{at}: team folder holds no agents"));
    }
    if !members.iter().any(|m| m.id == team.lead) {
        problems.push(format!(
            "{at}: lead '{}' is not an agent in {}",
            team.lead,
            team.folder()
        ));
    }
    // TeamTool drives the lead directly (not via its delegate tool, which
    // only exists for enabled agents) — a disabled lead must fail at load.
    if team.enabled && members.iter().any(|m| m.id == team.lead && !m.enabled) {
        problems.push(format!("{at}: lead '{}' is disabled", team.lead));
    }
    // Member visibility hygiene (ADR-032): the team boundary is the only door.
    // Agents outside the folder must not hold member delegates directly;
    // members (the lead included) listing each other stays fine.
    let member_ids: Vec<&str> = members.iter().map(|m| m.id.as_str()).collect();
    for agent in agents {
        if agent.source_path.starts_with(team.folder()) {
            continue;
        }
        for tool in &agent.tools {
            if member_ids.contains(&tool.as_str()) {
                problems.push(format!(
                    "{}: tool '{tool}' is a member of team '{}' ({at}); \
                     delegate to the team id '{}' instead",
                    agent.source_path, team.id, team.id
                ));
            }
        }
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
        // `reply` is the current switch value; `answer` is the legacy alias
        // (react v2) that older custom contracts still declare.
        if !has_enum_with("action", &["tool", "reply"])
            && !has_enum_with("action", &["tool", "answer"])
        {
            problems.push(format!(
                "{at}: custom contract '{}' is used with tools but has no `action` \
                 enum field containing tool|reply",
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
