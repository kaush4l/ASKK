//! Layer-4 config tests (docs/TESTING.md): every markdown file under
//! `agents/` — soul, skills, agents (incl. team subfolders) — parses and
//! validates in CI. The smoke test that constructs every agent: a config
//! nothing imports must still fail loudly here.

use std::fs;
use std::path::{Path, PathBuf};

use askk_core::contracts;
use askk_runtime::config::{load_soul, validate, AgentConfig, SkillConfig, TeamConfig};

fn agents_dir() -> PathBuf {
    // The agents folder lives under the web crate's served assets so the same
    // files are baked AND served verbatim at `/assets/agents/*`.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/assets/agents")
}

fn md_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("readable directory") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "md") {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn every_agent_file_parses_and_validates() {
    let root = agents_dir();
    assert!(root.is_dir(), "agents/ missing at {}", root.display());

    let mut agents: Vec<AgentConfig> = Vec::new();
    let mut teams: Vec<TeamConfig> = Vec::new();
    let mut skills: Vec<SkillConfig> = Vec::new();
    let mut soul: Option<String> = None;
    for path in md_files(&root) {
        let rel = path.strip_prefix(&root).expect("under agents/");
        let label = format!("agents/{}", rel.display());
        let text = fs::read_to_string(&path).expect("readable file");
        if rel == Path::new("soul.md") {
            soul = Some(load_soul(&text));
        } else if rel.file_name().is_some_and(|n| n == "team.md") {
            teams.push(TeamConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        } else if rel.starts_with("skills") {
            skills
                .push(SkillConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        } else {
            agents
                .push(AgentConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}")));
        }
    }
    assert!(!agents.is_empty(), "no agent.md files found — glob broken?");
    assert!(
        !soul.expect("agents/soul.md missing").is_empty(),
        "soul.md is empty"
    );

    // ponytail: the tool registry + provider profiles land in later waves;
    // until then the tool/provider universe is derived from the files
    // themselves, so shape checks (dupes, slugs, gates, on_fail, contracts,
    // skills, phase-tool subsetting) still bite in CI.
    let mut known_tools: Vec<String> = Vec::new();
    let mut known_providers: Vec<String> = Vec::new();
    for agent in &agents {
        known_tools.extend(agent.tools.iter().cloned());
        known_providers.push(agent.provider.clone());
    }
    for team in &teams {
        known_tools.extend(team.tools.iter().cloned());
    }
    let known_skills: Vec<String> = skills.iter().map(|s| s.id.clone()).collect();
    let known_contracts: Vec<String> = contracts::NAMES.iter().map(|n| n.to_string()).collect();

    if let Err(e) = validate(
        &agents,
        &teams,
        &known_tools,
        &known_skills,
        &known_contracts,
        &known_providers,
    ) {
        panic!("{e}");
    }
}
