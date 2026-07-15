//! agent.md / skills / soul.md → typed configs. Flat `phase.N.key` entries
//! become `askk_core::Phase` (docs/MODELS.md §Agent configuration). Unknown
//! keys and bad values fail loud, all problems in one error (ADR-007).

use std::collections::BTreeMap;

use askk_core::{Budgets, Contract, OutputMode, Phase, Skill};

use crate::config::env as env_presets;
use crate::config::fields::{self, FieldDraft};
use crate::config::frontmatter::{self, Entry};
use crate::config::phases::{build_phases, phase_entry, PhaseDraft};
use crate::config::ConfigError;

/// Turn budget for `loop` phases; mirrors `Budgets::default().max_turns`.
pub const DEFAULT_LOOP_MAX_TURNS: u32 = 16;

/// Runaway guard: the deepest delegation depth an agent may declare.
pub const MAX_DECLARED_DEPTH: u8 = 8;

/// Runaway guard: the largest turn budget `spawn_agent` may put on a
/// synthesized child (the MAX_DECLARED_DEPTH pattern, for turns).
pub const MAX_SPAWNED_MAX_TURNS: u32 = 64;

/// `budget.*` frontmatter — an agent DECLARES its own thread length instead
/// of inheriting the session's. Only the declared fields override; the rest
/// of the session `Budgets` pass through untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BudgetOverride {
    pub max_turns: Option<u32>,
    pub deadline_ms: Option<u64>,
    pub depth: Option<u8>,
}

impl BudgetOverride {
    /// Session budgets with this agent's declared overrides applied.
    pub fn apply(&self, mut base: Budgets) -> Budgets {
        if let Some(n) = self.max_turns {
            base.max_turns = n;
        }
        if let Some(ms) = self.deadline_ms {
            base.deadline_ms = ms;
        }
        if let Some(d) = self.depth {
            base.max_delegation_depth = d;
        }
        base
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    /// Doubles as the tool card when delegated to.
    pub description: String,
    pub enabled: bool,
    pub tools: Vec<String>,
    pub skills: Vec<String>,
    /// Provider profile id.
    pub provider: String,
    /// Named contract (default: react).
    pub contract: String,
    /// Initial output mode.
    pub format: OutputMode,
    /// Declared strategy; empty = single implicit phase.
    pub phases: Vec<Phase>,
    /// `field.N.*` frontmatter → an agent-local contract named by the agent
    /// id; `resolve_contract` prefers it over the built-in registry.
    pub custom_contract: Option<Contract>,
    /// `budget.*` frontmatter — declared overrides of the session budgets.
    pub budget: BudgetOverride,
    /// Markdown body = the directive/role prompt.
    pub body: String,
    pub source_path: String,
}

impl AgentConfig {
    pub fn from_markdown(path_label: &str, text: &str) -> Result<Self, ConfigError> {
        let fm = frontmatter::parse(path_label, text)?;
        let mut problems: Vec<String> = Vec::new();
        let mut cfg = AgentConfig {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            enabled: true,
            tools: Vec::new(),
            skills: Vec::new(),
            provider: "default".into(),
            contract: "react".into(),
            format: OutputMode::default(),
            phases: Vec::new(),
            custom_contract: None,
            budget: BudgetOverride::default(),
            body: fm.body.trim().to_string(),
            source_path: path_label.to_string(),
        };
        let mut drafts: BTreeMap<usize, PhaseDraft> = BTreeMap::new();
        let mut field_drafts: BTreeMap<usize, FieldDraft> = BTreeMap::new();
        // (preset names, location) — expanded after the loop, key-order agnostic.
        let mut env: Option<(Vec<String>, String)> = None;
        for entry in &fm.entries {
            let at = format!("{path_label}:{}", entry.line);
            match entry.key.as_str() {
                "id" => cfg.id = entry.value.clone(),
                "name" => cfg.name = entry.value.clone(),
                "description" => cfg.description = entry.value.clone(),
                "enabled" => match parse_bool(&entry.value) {
                    Some(b) => cfg.enabled = b,
                    None => problems.push(format!(
                        "{at}: `enabled` must be true|false, got '{}'",
                        entry.value
                    )),
                },
                "tools" => cfg.tools = frontmatter::split_list(&entry.value),
                // Environment presets (vm|web|core — see config::env):
                // expanded into `tools` at load, nothing stored on the config.
                "env" => env = Some((frontmatter::split_list(&entry.value), at.clone())),
                "skills" => cfg.skills = frontmatter::split_list(&entry.value),
                "provider" => cfg.provider = entry.value.clone(),
                "contract" => cfg.contract = entry.value.clone(),
                "format" => match entry.value.as_str() {
                    "json" => cfg.format = OutputMode::Json,
                    "toon" => cfg.format = OutputMode::Toon,
                    "text" => cfg.format = OutputMode::Text,
                    other => problems.push(format!(
                        "{at}: `format` must be json|toon|text, got '{other}'"
                    )),
                },
                key if key.starts_with("budget.") => {
                    budget_entry(entry, &at, &mut cfg.budget, &mut problems)
                }
                key if key.starts_with("phase.") => {
                    phase_entry(entry, &at, &mut drafts, &mut problems)
                }
                key if key.starts_with("field.") => {
                    fields::field_entry(entry, &at, &mut field_drafts, &mut problems)
                }
                other => problems.push(format!("{at}: unknown key '{other}'")),
            }
        }
        if let Some((names, at)) = env {
            let explicit = std::mem::take(&mut cfg.tools);
            cfg.tools = env_presets::expand(&names, explicit, &at, &mut problems);
        }
        if cfg.id.is_empty() {
            problems.push(format!("{path_label}: missing required key `id`"));
        }
        if cfg.name.is_empty() {
            cfg.name = cfg.id.clone();
        }
        cfg.phases = build_phases(path_label, drafts, &mut problems);
        let field_specs = fields::build_fields(path_label, field_drafts, &mut problems);
        if !field_specs.is_empty() {
            cfg.custom_contract = Some(Contract {
                name: cfg.id.clone(),
                version: 0,
                fields: field_specs,
            });
        }
        if problems.is_empty() {
            Ok(cfg)
        } else {
            Err(ConfigError::new(problems))
        }
    }

    /// Runtime specialization (`spawn_agent`): a run-scoped child config
    /// derived from this base — same phases/contract/format/provider.
    /// Authority only narrows: replacement `tools` must be a subset of the
    /// base's, replacement `skills` must all be loaded, and `max_turns` is
    /// clamped to 1..=MAX_SPAWNED_MAX_TURNS. Errors are plain strings the
    /// tool turns into observations.
    pub fn specialize(
        &self,
        id: String,
        directive: Option<&str>,
        tools: Option<Vec<String>>,
        skills: Option<Vec<String>>,
        max_turns: Option<u32>,
        known_skills: &[String],
    ) -> Result<AgentConfig, String> {
        let mut cfg = self.clone();
        cfg.id = id;
        if let Some(tools) = tools {
            if let Some(bad) = tools.iter().find(|t| !self.tools.contains(t)) {
                return Err(format!(
                    "tool '{bad}' is not in base agent '{}' tools [{}]",
                    self.id,
                    self.tools.join(", ")
                ));
            }
            cfg.tools = tools;
        }
        if let Some(skills) = skills {
            if let Some(bad) = skills.iter().find(|s| !known_skills.contains(s)) {
                return Err(format!("unknown skill '{bad}'"));
            }
            cfg.skills = skills;
        }
        if let Some(directive) = directive {
            cfg.body = if cfg.body.is_empty() {
                directive.to_string()
            } else {
                format!("{}\n\n{directive}", cfg.body)
            };
        }
        if let Some(n) = max_turns {
            cfg.budget.max_turns = Some(n.clamp(1, MAX_SPAWNED_MAX_TURNS));
        }
        Ok(cfg)
    }
}

/// One `budget.<field>` entry → the typed override. Value validation lives
/// here beside the parse (the `phase.N.max_turns` precedent), so every bad
/// budget value joins the file's single ConfigError (ADR-007).
fn budget_entry(entry: &Entry, at: &str, budget: &mut BudgetOverride, problems: &mut Vec<String>) {
    let field = &entry.key["budget.".len()..];
    let value = entry.value.as_str();
    match field {
        "max_turns" => match value.parse::<u32>() {
            Ok(n) if n >= 1 => budget.max_turns = Some(n),
            _ => problems.push(format!(
                "{at}: `budget.max_turns` must be a positive integer, got '{value}'"
            )),
        },
        "deadline_s" => match value.parse::<u64>() {
            Ok(n) if n >= 1 => budget.deadline_ms = Some(n.saturating_mul(1000)),
            _ => problems.push(format!(
                "{at}: `budget.deadline_s` must be a positive integer of seconds, got '{value}'"
            )),
        },
        "depth" => match value.parse::<u8>() {
            Ok(n) if (1..=MAX_DECLARED_DEPTH).contains(&n) => budget.depth = Some(n),
            _ => problems.push(format!(
                "{at}: `budget.depth` must be an integer 1..={MAX_DECLARED_DEPTH}, got '{value}'"
            )),
        },
        other => problems.push(format!("{at}: unknown budget field '{other}'")),
    }
}

pub(crate) fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// A named markdown fragment from `agents/skills/*.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillConfig {
    pub id: String,
    pub name: String,
    pub body: String,
    pub source_path: String,
}

impl SkillConfig {
    pub fn from_markdown(path_label: &str, text: &str) -> Result<Self, ConfigError> {
        let fm = frontmatter::parse(path_label, text)?;
        let mut problems: Vec<String> = Vec::new();
        let mut id = String::new();
        let mut name = String::new();
        for entry in &fm.entries {
            match entry.key.as_str() {
                "id" => id = entry.value.clone(),
                "name" => name = entry.value.clone(),
                other => problems.push(format!(
                    "{path_label}:{}: unknown key '{other}'",
                    entry.line
                )),
            }
        }
        if id.is_empty() {
            problems.push(format!("{path_label}: missing required key `id`"));
        }
        if !problems.is_empty() {
            return Err(ConfigError::new(problems));
        }
        if name.is_empty() {
            name = id.clone();
        }
        Ok(SkillConfig {
            id,
            name,
            body: fm.body.trim().to_string(),
            source_path: path_label.to_string(),
        })
    }

    /// Projection onto the sheet element payload.
    pub fn to_skill(&self) -> Skill {
        Skill {
            name: self.name.clone(),
            body: self.body.clone(),
        }
    }
}

/// soul.md is plain markdown — no frontmatter, no refs to validate.
pub fn load_soul(text: &str) -> String {
    text.trim().to_string()
}

#[cfg(test)]
mod tests {
    use askk_core::PhaseStep;

    use super::*;

    fn base() -> AgentConfig {
        AgentConfig::from_markdown(
            "agents/base.md",
            "---\nid: base\ndescription: Base.\ntools: echo, calc\n---\nDo work.",
        )
        .unwrap()
    }

    #[test]
    fn specialize_appends_directive_and_clamps_turns() {
        let child = base()
            .specialize(
                "spawned-base-1".into(),
                Some("Be terse."),
                None,
                None,
                Some(9999),
                &[],
            )
            .unwrap();
        assert_eq!(child.id, "spawned-base-1");
        assert_eq!(child.body, "Do work.\n\nBe terse.");
        assert_eq!(child.budget.max_turns, Some(MAX_SPAWNED_MAX_TURNS));
        // Untouched knobs pass through from the base.
        assert_eq!(child.tools, vec!["echo", "calc"]);
        assert_eq!(child.provider, "default");
    }

    #[test]
    fn scripted_phase_step_parses_tool_and_args() {
        let cfg = AgentConfig::from_markdown(
            "agents/flow.md",
            "---\nid: flow\ntools: web_search\n\
             phase.1.name: search\nphase.1.tool: web_search\nphase.1.args: {\"query\": \"{goal}\"}\n\
             phase.2.name: answer\nphase.2.gate: true\n---\nSummarize.",
        )
        .unwrap();
        assert_eq!(cfg.phases.len(), 2);
        match &cfg.phases[0].step {
            PhaseStep::Tool { tool, args } => {
                assert_eq!(tool, "web_search");
                // The `{goal}` template is stored verbatim; substitution is a
                // run-time concern (turn.rs::substitute_goal).
                assert_eq!(args["query"], "{goal}");
            }
            other => panic!("expected a scripted Tool step, got {other:?}"),
        }
        // A bare LLM phase is the default.
        assert_eq!(cfg.phases[1].step, PhaseStep::Llm);
    }

    #[test]
    fn scripted_tool_only_defaults_args_to_empty_object() {
        let cfg = AgentConfig::from_markdown(
            "agents/f.md",
            "---\nid: f\ntools: calc\nphase.1.name: run\nphase.1.tool: calc\n---\n",
        )
        .unwrap();
        assert_eq!(
            cfg.phases[0].step,
            PhaseStep::Tool {
                tool: "calc".into(),
                args: serde_json::json!({}),
            }
        );
    }

    #[test]
    fn scripted_step_cannot_be_a_gate() {
        let err = AgentConfig::from_markdown(
            "agents/bad.md",
            "---\nid: bad\ntools: calc\nphase.1.name: s\nphase.1.tool: calc\nphase.1.gate: true\n---\n",
        )
        .unwrap_err();
        assert!(err.to_string().contains("cannot be both"), "{err}");
    }

    #[test]
    fn scripted_step_rejects_non_object_args() {
        let err = AgentConfig::from_markdown(
            "agents/bad.md",
            "---\nid: bad\ntools: calc\nphase.1.name: s\nphase.1.tool: calc\nphase.1.args: 42\n---\n",
        )
        .unwrap_err();
        assert!(err.to_string().contains("must be a JSON object"), "{err}");
    }

    #[test]
    fn specialize_rejects_widening_and_unknown_skills() {
        let widened = base().specialize(
            "s".into(),
            None,
            Some(vec!["shell".into()]),
            None,
            None,
            &[],
        );
        assert!(widened.unwrap_err().contains("'shell'"));
        let ghost = base().specialize(
            "s".into(),
            None,
            None,
            Some(vec!["ghost".into()]),
            None,
            &[],
        );
        assert_eq!(ghost.unwrap_err(), "unknown skill 'ghost'");
    }
}
