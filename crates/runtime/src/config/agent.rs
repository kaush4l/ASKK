//! agent.md / skills / soul.md → typed configs. Flat `phase.N.key` entries
//! become `askk_core::Phase` (docs/MODELS.md §Agent configuration). Unknown
//! keys and bad values fail loud, all problems in one error (ADR-007).

use std::collections::BTreeMap;

use askk_core::{LoopMode, OutputMode, Phase, Skill};

use crate::config::frontmatter::{self, Entry};
use crate::config::ConfigError;

/// Turn budget for `loop` phases; mirrors `Budgets::default().max_turns`.
pub const DEFAULT_LOOP_MAX_TURNS: u32 = 16;

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
            body: fm.body.trim().to_string(),
            source_path: path_label.to_string(),
        };
        let mut drafts: BTreeMap<usize, PhaseDraft> = BTreeMap::new();
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
                key if key.starts_with("phase.") => {
                    phase_entry(entry, &at, &mut drafts, &mut problems)
                }
                other => problems.push(format!("{at}: unknown key '{other}'")),
            }
        }
        if cfg.id.is_empty() {
            problems.push(format!("{path_label}: missing required key `id`"));
        }
        if cfg.name.is_empty() {
            cfg.name = cfg.id.clone();
        }
        cfg.phases = build_phases(path_label, drafts, &mut problems);
        if problems.is_empty() {
            Ok(cfg)
        } else {
            Err(ConfigError::new(problems))
        }
    }
}

/// Accumulates `phase.N.*` keys until all lines are seen.
#[derive(Default)]
struct PhaseDraft {
    line: usize,
    name: Option<String>,
    contract: Option<String>,
    tools: Option<Vec<String>>,
    loop_mode: Option<LoopMode>,
    gate: Option<bool>,
    on_fail: Option<String>,
    header: Option<String>,
}

fn phase_entry(
    entry: &Entry,
    at: &str,
    drafts: &mut BTreeMap<usize, PhaseDraft>,
    problems: &mut Vec<String>,
) {
    let rest = &entry.key["phase.".len()..];
    let Some((number, field)) = rest.split_once('.') else {
        problems.push(format!(
            "{at}: phase keys are `phase.<n>.<field>`, got '{}'",
            entry.key
        ));
        return;
    };
    let n = match number.parse::<usize>() {
        Ok(n) if n >= 1 => n,
        _ => {
            problems.push(format!(
                "{at}: phase number must be an integer >= 1, got '{number}'"
            ));
            return;
        }
    };
    let draft = drafts.entry(n).or_default();
    if draft.line == 0 {
        draft.line = entry.line;
    }
    let value = entry.value.clone();
    match field {
        "name" => draft.name = Some(value),
        "contract" => draft.contract = Some(value),
        "tools" => draft.tools = Some(frontmatter::split_list(&value)),
        "loop" => match value.as_str() {
            "one_shot" => draft.loop_mode = Some(LoopMode::OneShot),
            "loop" => {
                draft.loop_mode = Some(LoopMode::Loop {
                    max_turns: DEFAULT_LOOP_MAX_TURNS,
                })
            }
            other => problems.push(format!("{at}: `loop` must be one_shot|loop, got '{other}'")),
        },
        "gate" => match parse_bool(&value) {
            Some(b) => draft.gate = Some(b),
            None => problems.push(format!("{at}: `gate` must be true|false, got '{value}'")),
        },
        "on_fail" => draft.on_fail = Some(value),
        "header" => draft.header = Some(value),
        other => problems.push(format!("{at}: unknown phase field '{other}'")),
    }
}

fn build_phases(
    path_label: &str,
    drafts: BTreeMap<usize, PhaseDraft>,
    problems: &mut Vec<String>,
) -> Vec<Phase> {
    let mut phases = Vec::new();
    for (position, (n, draft)) in drafts.into_iter().enumerate() {
        if n != position + 1 {
            problems.push(format!(
                "{path_label}: phase numbers must be contiguous from 1; missing phase.{}",
                position + 1
            ));
        }
        let name = draft.name.unwrap_or_else(|| {
            problems.push(format!(
                "{path_label}:{}: phase.{n} is missing `phase.{n}.name`",
                draft.line
            ));
            String::new()
        });
        phases.push(Phase {
            name,
            contract: draft.contract.unwrap_or_else(|| "react".into()),
            tool_filter: draft.tools,
            loop_mode: draft.loop_mode.unwrap_or(LoopMode::OneShot),
            gate: draft.gate.unwrap_or(false),
            on_fail: draft.on_fail,
            header: draft.header.unwrap_or_default(),
        });
    }
    phases
}

fn parse_bool(value: &str) -> Option<bool> {
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
    use super::*;

    /// docs/MODELS.md §Agent configuration, verbatim.
    const MODELS_MD_EXAMPLE: &str = "\
---
id: coder                # slug, unique, validated
name: Coder
description: ...         # doubles as the tool card when delegated to
enabled: true
tools: file_read, file_write, run_js        # names resolved at load; unknown = hard error
skills: concise                              # resolved at load; unknown = hard error
provider: default                            # provider profile id
contract: react                              # named contract (default: react)
format: toon                                 # initial output mode
phase.1.name: plan                           # optional phases → DeclaredStrategy
phase.1.contract: plan
phase.1.loop: one_shot
phase.2.name: execute
phase.2.contract: react
phase.2.loop: loop
phase.3.name: verify
phase.3.contract: critique
phase.3.gate: true
phase.3.on_fail: plan
---
(markdown body = the directive/role prompt)
";

    #[test]
    fn models_md_example_parses_verbatim() {
        let cfg = AgentConfig::from_markdown("agents/coder.md", MODELS_MD_EXAMPLE).unwrap();
        assert_eq!(cfg.id, "coder");
        assert_eq!(cfg.name, "Coder");
        assert!(cfg.enabled);
        assert_eq!(cfg.tools, vec!["file_read", "file_write", "run_js"]);
        assert_eq!(cfg.skills, vec!["concise"]);
        assert_eq!(cfg.provider, "default");
        assert_eq!(cfg.contract, "react");
        assert_eq!(cfg.format, OutputMode::Toon);
        assert_eq!(cfg.body, "(markdown body = the directive/role prompt)");
        assert_eq!(cfg.phases.len(), 3);
        assert_eq!(cfg.phases[0].name, "plan");
        assert_eq!(cfg.phases[0].contract, "plan");
        assert_eq!(cfg.phases[0].loop_mode, LoopMode::OneShot);
        assert!(!cfg.phases[0].gate);
        assert_eq!(
            cfg.phases[1].loop_mode,
            LoopMode::Loop {
                max_turns: DEFAULT_LOOP_MAX_TURNS
            }
        );
        assert_eq!(cfg.phases[2].name, "verify");
        assert!(cfg.phases[2].gate);
        assert_eq!(cfg.phases[2].on_fail.as_deref(), Some("plan"));
        assert_eq!(cfg.phases[2].loop_mode, LoopMode::OneShot); // default
    }

    #[test]
    fn minimal_agent_gets_defaults() {
        let cfg = AgentConfig::from_markdown("a.md", "---\nid: mini\n---\nBody.").unwrap();
        assert_eq!(cfg.name, "mini"); // name defaults to id
        assert!(cfg.enabled);
        assert!(cfg.tools.is_empty());
        assert_eq!(cfg.provider, "default");
        assert_eq!(cfg.contract, "react");
        assert_eq!(cfg.format, OutputMode::Toon);
        assert!(cfg.phases.is_empty());
        assert_eq!(cfg.body, "Body.");
    }

    #[test]
    fn unknown_keys_fail_loud_with_line_numbers() {
        let err = AgentConfig::from_markdown("a.md", "---\nid: a\ncolour: red\n---\n").unwrap_err();
        assert_eq!(err.problems.len(), 1);
        assert!(err.problems[0].contains("a.md:3"));
        assert!(err.problems[0].contains("unknown key 'colour'"));
    }

    #[test]
    fn bad_values_are_collected_into_one_error() {
        let text = "---\nenabled: yep\nformat: xml\nphase.1.name: p\nphase.1.loop: forever\nphase.1.gate: maybe\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("`enabled` must be true|false"));
        assert!(joined.contains("`format` must be json|toon|text"));
        assert!(joined.contains("`loop` must be one_shot|loop"));
        assert!(joined.contains("`gate` must be true|false"));
        assert!(joined.contains("missing required key `id`"));
        assert_eq!(err.problems.len(), 5);
    }

    #[test]
    fn phase_gaps_and_missing_names_are_errors() {
        let text = "---\nid: a\nphase.1.name: plan\nphase.3.contract: react\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("missing phase.2"));
        assert!(joined.contains("missing `phase.3.name`"));
    }

    #[test]
    fn malformed_phase_keys_are_errors() {
        let text = "---\nid: a\nphase.x.name: p\nphase.1.speed: fast\nphase.one: p\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("phase number must be an integer"));
        assert!(joined.contains("unknown phase field 'speed'"));
        assert!(joined.contains("phase.<n>.<field>"));
    }

    #[test]
    fn phase_tools_narrow_the_allowlist() {
        let text = "---\nid: a\ntools: x, y\nphase.1.name: p\nphase.1.tools: x\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        assert_eq!(cfg.phases[0].tool_filter, Some(vec!["x".to_string()]));
    }

    #[test]
    fn skill_config_parses_and_projects() {
        let skill = SkillConfig::from_markdown(
            "agents/skills/concise.md",
            "---\nid: concise\nname: Concise\n---\nBe brief.",
        )
        .unwrap();
        assert_eq!(skill.id, "concise");
        let projected = skill.to_skill();
        assert_eq!(projected.name, "Concise");
        assert_eq!(projected.body, "Be brief.");
        let err = SkillConfig::from_markdown("s.md", "---\nname: X\nfoo: y\n---\n").unwrap_err();
        assert_eq!(err.problems.len(), 2); // unknown key + missing id
    }

    #[test]
    fn load_soul_trims_plain_markdown() {
        assert_eq!(load_soul("\n# Soul\ntext\n\n"), "# Soul\ntext");
    }
}
