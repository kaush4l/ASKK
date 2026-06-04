use crate::state::{
    agent_from_markdown, agent_markdown_path, agent_to_markdown, skill_from_markdown, Agent,
    AppResult, AppSnapshot,
};
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};

const BRIDGE_FILES_URL: &str = "http://127.0.0.1:8874/askk/files";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceFile {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WorkspaceFiles {
    pub root: String,
    pub soul: Option<WorkspaceFile>,
    pub agents: Vec<WorkspaceFile>,
    pub skills: Vec<WorkspaceFile>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceFilesEnvelope {
    success: bool,
    data: Option<WorkspaceFiles>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct SaveSoulRequest {
    content: String,
}

#[derive(Debug, Serialize)]
struct SaveAgentsRequest {
    agents: Vec<WorkspaceFile>,
}

pub async fn load_workspace_files() -> AppResult<WorkspaceFiles> {
    let response = Request::get(BRIDGE_FILES_URL)
        .send()
        .await
        .map_err(|err| bridge_error("load workspace Markdown files", &format!("{err:?}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read workspace file response: {err:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "Workspace file bridge returned HTTP {status}: {text}"
        ));
    }

    let envelope = serde_json::from_str::<WorkspaceFilesEnvelope>(&text)
        .map_err(|err| format!("Unable to parse workspace file response: {err}"))?;
    if !envelope.success {
        return Err(envelope
            .error
            .unwrap_or_else(|| "Workspace file bridge returned an error.".to_string()));
    }
    envelope
        .data
        .ok_or_else(|| "Workspace file bridge did not return file data.".to_string())
}

pub async fn save_soul_file(content: String) -> AppResult<String> {
    let body = serde_json::to_string(&SaveSoulRequest { content })
        .map_err(|err| format!("Unable to serialize soul.md update: {err}"))?;
    post_workspace_file_request("soul", &body).await
}

pub async fn save_agent_files(agents: &[Agent]) -> AppResult<String> {
    let files = agents
        .iter()
        .map(|agent| WorkspaceFile {
            path: agent_markdown_path(agent),
            content: agent_to_markdown(agent),
        })
        .collect::<Vec<_>>();
    let body = serde_json::to_string(&SaveAgentsRequest { agents: files })
        .map_err(|err| format!("Unable to serialize agent Markdown files: {err}"))?;
    post_workspace_file_request("agents", &body).await
}

pub fn apply_workspace_files(snapshot: &mut AppSnapshot, files: WorkspaceFiles) -> String {
    let mut loaded_parts = Vec::new();

    if let Some(soul) = files.soul {
        if !soul.content.trim().is_empty() {
            snapshot.soul = soul.content.trim().to_string();
            loaded_parts.push("soul.md".to_string());
        }
    }

    let agents = files
        .agents
        .iter()
        .filter_map(|file| agent_from_markdown(&file.path, &file.content).ok())
        .collect::<Vec<_>>();
    if !agents.is_empty() {
        let count = agents.len();
        snapshot.agents = agents;
        loaded_parts.push(format!("{count} agent file(s)"));
    }

    let skills = files
        .skills
        .iter()
        .filter_map(|file| skill_from_markdown(&file.path, &file.content).ok())
        .collect::<Vec<_>>();
    if !skills.is_empty() {
        let count = skills.len();
        snapshot.skills = skills;
        loaded_parts.push(format!("{count} skill file(s)"));
    }

    snapshot.ensure_prompt_defaults();
    snapshot.normalize_agent_branding();

    if loaded_parts.is_empty() {
        "No usable Markdown files were found in soul.md, agents/, or skills/.".to_string()
    } else {
        format!(
            "Loaded {} from local Markdown files.",
            loaded_parts.join(", ")
        )
    }
}

async fn post_workspace_file_request(path: &str, body: &str) -> AppResult<String> {
    let endpoint = format!("{BRIDGE_FILES_URL}/{path}");
    let response = Request::post(&endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|err| format!("Unable to create workspace file request: {err:?}"))?
        .send()
        .await
        .map_err(|err| bridge_error("save workspace Markdown files", &format!("{err:?}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read workspace file save response: {err:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "Workspace file bridge returned HTTP {status}: {text}"
        ));
    }
    Ok(text)
}

fn bridge_error(action: &str, raw: &str) -> String {
    format!(
        "Unable to {action}. Run `node scripts/askk-local-bridge.mjs` from the project root so the hosted app can read and update soul.md, agents/, and skills/. Browser fetch details: {raw}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_workspace_files_to_snapshot() {
        let files = WorkspaceFiles {
            root: "/tmp/askk".to_string(),
            soul: Some(WorkspaceFile {
                path: "soul.md".to_string(),
                content: "Shared behavior".to_string(),
            }),
            agents: vec![WorkspaceFile {
                path: "agents/builder.md".to_string(),
                content:
                    "---\nid: builder\nname: Builder\nenabled: true\ntools: memory_search\n---\n\nBuild carefully."
                        .to_string(),
            }],
            skills: vec![WorkspaceFile {
                path: "skills/build/SKILL.md".to_string(),
                content: "---\nid: build\nname: Build\nenabled: true\n---\n\nPrefer small changes."
                    .to_string(),
            }],
        };
        let mut snapshot = AppSnapshot::default();
        let status = apply_workspace_files(&mut snapshot, files);

        assert!(status.contains("soul.md"));
        assert_eq!(snapshot.soul, "Shared behavior");
        assert_eq!(snapshot.agents.len(), 1);
        assert_eq!(snapshot.agents[0].name, "Builder");
        assert_eq!(snapshot.agents[0].enabled_tools, vec!["memory_search"]);
        assert_eq!(snapshot.skills.len(), 1);
        assert_eq!(snapshot.skills[0].name, "Build");
    }
}
