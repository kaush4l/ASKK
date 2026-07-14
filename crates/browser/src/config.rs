//! Where the agent roster comes from: the baked fallback (build.rs embeds
//! every `assets/agents/*.md`) and the live path (fetch the served folder at
//! runtime so a dropped-in agent.md or tool.js is picked up with no rebuild).
//! Split out of `boot` to keep that file under the ADR-012 line cap.

use askk_engine::config::{load_soul, AgentConfig, SkillConfig, TeamConfig};

// The agents/ FOLDER is the config: build.rs embeds every `assets/agents/*.md`
// it finds (manifest.json fixes the order). `AGENT_FILES`, `TEAM_FILES`,
// `SKILL_FILES`, `SOUL_MD`:
include!(concat!(env!("OUT_DIR"), "/agents_gen.rs"));

pub type ConfigSet = (Vec<AgentConfig>, Vec<TeamConfig>, Vec<SkillConfig>, String);

/// Register the baked JS tools (host stubs / wasm evals) — the fallback path
/// when the live folder fetch misses, and the only path on host builds.
pub fn register_baked_tools(registry: &mut askk_engine::tools::ToolRegistry) {
    for (name, source) in TOOL_FILES {
        super::jstool::register_js_tool(registry, name, source);
    }
}

/// The baked fallback: parse the files embedded at build time.
pub fn baked_config() -> Result<ConfigSet, String> {
    let agents = AGENT_FILES
        .iter()
        .map(|(path, text)| AgentConfig::from_markdown(path, text).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let teams = TEAM_FILES
        .iter()
        .map(|(path, text)| TeamConfig::from_markdown(path, text).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let skills = SKILL_FILES
        .iter()
        .map(|(path, text)| SkillConfig::from_markdown(path, text).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((agents, teams, skills, load_soul(SOUL_MD)))
}

/// The served assets base ("/assets/" or "/ASKK/assets/"), derived from a
/// hashed asset URL — the agents folder is served verbatim beneath it
/// (`{base}agents/*`). ponytail: any asset!() const yields the base; reuse
/// an asset this crate already ships (asset! paths are crate-relative).
#[cfg(target_arch = "wasm32")]
fn assets_base() -> String {
    use dioxus::prelude::*;
    const ANY: Asset = asset!("/assets/llm/askk-llm.js");
    let url = ANY.to_string();
    match url.find("/assets/") {
        Some(i) => url[..i + "/assets/".len()].to_string(),
        None => "/assets/".to_string(),
    }
}

/// Runtime config: fetch `assets/agents/manifest.json` from the served site
/// and every agent / skill / JS-tool file it lists. On a real static host
/// the deployed folder IS the live config — drop in an agent.md (or a
/// tool.js), reload, no rebuild. Any fetch/parse miss falls back to the baked
/// set silently (dev servers serve the folder too, so this is the live path).
#[cfg(target_arch = "wasm32")]
pub async fn fetched_config(registry: &mut askk_engine::tools::ToolRegistry) -> Option<ConfigSet> {
    use super::fetch::fetch_text;
    use serde_json::Value;

    let base = assets_base();
    let at = |name: &str| format!("{base}agents/{name}");
    let manifest: Value = serde_json::from_str(&fetch_text(&at("manifest.json")).await.ok()?)
        .ok()
        .filter(Value::is_object)?;

    let mut agents = Vec::new();
    for name in manifest
        .get("agents")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
    {
        let text = fetch_text(&at(name)).await.ok()?;
        agents.push(AgentConfig::from_markdown(&format!("agents/{name}"), &text).ok()?);
    }
    if agents.is_empty() {
        return None;
    }

    // Teams (wave-16): the manifest lists `<folder>/team.md` paths.
    let mut teams = Vec::new();
    if let Some(list) = manifest.get("teams").and_then(Value::as_array) {
        for name in list.iter().filter_map(Value::as_str) {
            let text = fetch_text(&at(name)).await.ok()?;
            teams.push(TeamConfig::from_markdown(&format!("agents/{name}"), &text).ok()?);
        }
    }

    let (_, _, baked_skills, baked_soul) = baked_config().ok()?;
    let mut skills = baked_skills;
    if let Some(list) = manifest.get("skills").and_then(Value::as_array) {
        let mut fetched = Vec::new();
        for name in list.iter().filter_map(Value::as_str) {
            let text = fetch_text(&at(name)).await.ok()?;
            fetched.push(SkillConfig::from_markdown(&format!("agents/{name}"), &text).ok()?);
        }
        skills = fetched;
    }

    // Custom JS tools declared in the manifest, fetched from the same folder.
    for name in manifest
        .get("tools")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default()
    {
        if let Ok(source) = fetch_text(&at(name)).await {
            super::jstool::register_js_tool(registry, name, &source);
        }
    }

    let soul = match manifest.get("soul").and_then(Value::as_str) {
        Some(name) => load_soul(&fetch_text(&at(name)).await.ok()?),
        None => baked_soul,
    };
    Some((agents, teams, skills, soul))
}
