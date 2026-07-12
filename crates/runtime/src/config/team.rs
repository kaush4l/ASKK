//! team.md → `TeamConfig` (wave-16). A subfolder of `agents/` that contains
//! a `team.md` is a first-class TEAM: one delegation boundary with its own
//! toolset (the micro-service analogy — a module carries its own complete
//! requirements), a designated lead, and a BODY of shared principles injected
//! into every member driven inside the team. Members are simply the other
//! agent files in the same folder. Parsing mirrors `AgentConfig`: unknown
//! keys and bad values fail loud, all problems in one error (ADR-007).

use crate::config::agent::AgentConfig;
use crate::config::env as env_presets;
use crate::config::frontmatter;
use crate::config::ConfigError;

/// The file name that turns a folder into a team.
pub const TEAM_FILE: &str = "team.md";

#[derive(Debug, Clone, PartialEq)]
pub struct TeamConfig {
    pub id: String,
    pub name: String,
    /// Doubles as the team tool card when delegated to.
    pub description: String,
    pub enabled: bool,
    /// Agent id of the member that receives delegations to the team.
    pub lead: String,
    /// The team's OWN toolset — the boundary resets authority to this set
    /// (ADR-032), it is not intersected with the caller's tools.
    pub tools: Vec<String>,
    /// Markdown body = shared principles, injected into member prompts.
    pub body: String,
    /// e.g. `agents/coding/team.md`.
    pub source_path: String,
}

impl TeamConfig {
    pub fn from_markdown(path_label: &str, text: &str) -> Result<Self, ConfigError> {
        let fm = frontmatter::parse(path_label, text)?;
        let mut problems: Vec<String> = Vec::new();
        let mut cfg = TeamConfig {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            enabled: true,
            lead: String::new(),
            tools: Vec::new(),
            body: fm.body.trim().to_string(),
            source_path: path_label.to_string(),
        };
        let mut env: Option<(Vec<String>, String)> = None;
        for entry in &fm.entries {
            let at = format!("{path_label}:{}", entry.line);
            match entry.key.as_str() {
                "id" => cfg.id = entry.value.clone(),
                "name" => cfg.name = entry.value.clone(),
                "description" => cfg.description = entry.value.clone(),
                "enabled" => match entry.value.as_str() {
                    "true" => cfg.enabled = true,
                    "false" => cfg.enabled = false,
                    other => {
                        problems.push(format!("{at}: `enabled` must be true|false, got '{other}'"))
                    }
                },
                "lead" => cfg.lead = entry.value.clone(),
                "tools" => cfg.tools = frontmatter::split_list(&entry.value),
                "env" => env = Some((frontmatter::split_list(&entry.value), at.clone())),
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
        if cfg.lead.is_empty() {
            problems.push(format!("{path_label}: missing required key `lead`"));
        }
        if cfg.name.is_empty() {
            cfg.name = cfg.id.clone();
        }
        if problems.is_empty() {
            Ok(cfg)
        } else {
            Err(ConfigError::new(problems))
        }
    }

    /// The folder this team owns: `agents/coding/team.md` → `agents/coding/`.
    pub fn folder(&self) -> &str {
        self.source_path
            .rfind('/')
            .map(|i| &self.source_path[..i + 1])
            .unwrap_or("")
    }

    /// The team's members: every agent declared in the team's folder.
    pub fn members<'a>(&self, agents: &'a [AgentConfig]) -> Vec<&'a AgentConfig> {
        agents
            .iter()
            .filter(|a| a.source_path.starts_with(self.folder()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODING: &str = "---\nid: coding\nname: Coding team\ndescription: Builds modules.\nlead: dev-lead\ntools: shell, write_file\n---\nKeep functions small. DRY.";

    #[test]
    fn parses_the_full_contract() {
        let team = TeamConfig::from_markdown("agents/coding/team.md", CODING).unwrap();
        assert_eq!(team.id, "coding");
        assert_eq!(team.lead, "dev-lead");
        assert_eq!(team.tools, vec!["shell", "write_file"]);
        assert_eq!(team.body, "Keep functions small. DRY.");
        assert_eq!(team.folder(), "agents/coding/");
    }

    #[test]
    fn env_presets_expand_into_team_tools() {
        let team = TeamConfig::from_markdown(
            "agents/ops/team.md",
            "---\nid: ops\nlead: chief\nenv: core\ntools: shell\n---\n",
        )
        .unwrap();
        assert!(team.tools.iter().any(|t| t == "calc"));
        assert!(team.tools.iter().any(|t| t == "shell"));
    }

    #[test]
    fn missing_id_lead_and_unknown_keys_fail_loud() {
        let err = TeamConfig::from_markdown("agents/x/team.md", "---\nname: X\ncolor: teal\n---\n")
            .unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("unknown key 'color'"));
        assert!(joined.contains("missing required key `id`"));
        assert!(joined.contains("missing required key `lead`"));
    }

    #[test]
    fn members_are_the_folder_mates() {
        let team = TeamConfig::from_markdown("agents/coding/team.md", CODING).unwrap();
        let a = AgentConfig::from_markdown("agents/coding/dev-lead.md", "---\nid: dev-lead\n---\n")
            .unwrap();
        let b =
            AgentConfig::from_markdown("agents/coding/programmer.md", "---\nid: programmer\n---\n")
                .unwrap();
        let outsider =
            AgentConfig::from_markdown("agents/assistant.md", "---\nid: assistant\n---\n").unwrap();
        let agents = vec![a, b, outsider];
        let ids: Vec<&str> = team
            .members(&agents)
            .iter()
            .map(|m| m.id.as_str())
            .collect();
        assert_eq!(ids, vec!["dev-lead", "programmer"]);
    }
}
