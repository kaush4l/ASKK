//! Local ASKK bridge transport. Every bridge-backed tool — `web_search`,
//! `web_fetch`, `run_command`, and the `fs_*` family — routes through here to the
//! optional dev bridge (default `http://127.0.0.1:8874/askk/tools`). The Workspace
//! page also calls the `bridge_fs_*` / `bridge_run_command` helpers directly to
//! drive its file tree, editor, and terminal.

use crate::state::{AppResult, WebSearchToolConfig};
use gloo_net::http::Request;
use serde_json::{Value, json};

use super::common::truncate;

/// Shared transport for both bridge call styles below: POST `body` to `endpoint` and
/// return the (HTTP status, response text). `context` names the caller for errors.
async fn bridge_post(context: &str, endpoint: &str, body: Value) -> AppResult<(u16, String)> {
    let response = Request::post(endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|err| format!("Unable to create {context} bridge request: {err:?}"))?
        .send()
        .await
        .map_err(|err| {
            format!(
                "{context} bridge request failed. Run `node scripts/askk-local-bridge.mjs` (add `--allow-exec` for run_command) from the project root. Browser fetch details: {err:?}"
            )
        })?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read {context} bridge response: {err:?}"))?;
    Ok((status, text))
}

/// Send a JSON request to a bridge tool endpoint and return the parsed `{ success,
/// data }` envelope. Unlike [`bridge_tool_request`], the body is not truncated, so
/// the Workspace page can read full file contents and command output.
pub(crate) async fn bridge_json_request(endpoint: &str, body: Value) -> AppResult<Value> {
    let (status, text) = bridge_post("bridge", endpoint, body).await?;
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        format!(
            "Bridge returned non-JSON (HTTP {status}): {}",
            truncate(&text, 400)
        )
    })?;
    if value.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Bridge reported an error.")
            .to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!(
            "Bridge returned HTTP {status}: {}",
            truncate(&text, 400)
        ));
    }
    Ok(value)
}

/// List the on-disk project tree under the run root. Returns the `files` array from
/// the bridge `fs_list` response. Used by the Workspace page file tree.
pub async fn bridge_fs_list(config: &WebSearchToolConfig, path: Option<&str>) -> AppResult<Value> {
    let endpoint = bridge_endpoint(config, "fs_list")?;
    let mut body = json!({});
    if let Some(path) = path.filter(|value| !value.trim().is_empty()) {
        body["path"] = Value::String(path.to_string());
    }
    let value = bridge_json_request(&endpoint, body).await?;
    Ok(value
        .get("data")
        .and_then(|data| data.get("files"))
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new())))
}

/// Read a file's full contents from the run root. Used by the Workspace editor.
pub async fn bridge_fs_read(config: &WebSearchToolConfig, path: &str) -> AppResult<String> {
    let endpoint = bridge_endpoint(config, "fs_read")?;
    let value = bridge_json_request(&endpoint, json!({ "path": path })).await?;
    Ok(value
        .get("data")
        .and_then(|data| data.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

/// Write a file to the run root. Used by the Workspace editor's Save action.
pub async fn bridge_fs_write(
    config: &WebSearchToolConfig,
    path: &str,
    content: &str,
) -> AppResult<()> {
    let endpoint = bridge_endpoint(config, "fs_write")?;
    bridge_json_request(&endpoint, json!({ "path": path, "content": content })).await?;
    Ok(())
}

/// Run a command in the run root and return the `data` object (exit_code, stdout,
/// stderr, …). Used by the Workspace terminal.
pub async fn bridge_run_command(
    config: &WebSearchToolConfig,
    command: &str,
    cwd: Option<&str>,
) -> AppResult<Value> {
    let endpoint = bridge_endpoint(config, "run_command")?;
    let mut body = json!({ "command": command });
    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        body["cwd"] = Value::String(cwd.to_string());
    }
    let value = bridge_json_request(&endpoint, body).await?;
    Ok(value.get("data").cloned().unwrap_or(Value::Null))
}

/// Build the bridge endpoint for a named ASKK tool from the configured tools base
/// URL (default `http://127.0.0.1:8874/askk/tools`).
pub(crate) fn bridge_endpoint(config: &WebSearchToolConfig, tool: &str) -> AppResult<String> {
    let base = config.bridge_tools_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("ASKK bridge tools URL is empty. Set it on the Tools page.".to_string());
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err(format!(
            "ASKK bridge tools URL must start with http:// or https://: {base}"
        ));
    }
    Ok(format!("{base}/{tool}"))
}

/// POST a tool call to the bridge and return its (truncated) text response. Used by
/// the bridge-backed paths of `web_search`, `web_fetch`, `run_command`, and `fs_*`.
pub(crate) async fn bridge_tool_request(
    tool_name: &str,
    endpoint: &str,
    body: Value,
) -> AppResult<String> {
    let (status, text) = bridge_post(tool_name, endpoint, body).await?;
    if !(200..300).contains(&status) {
        return Err(format!("{tool_name} bridge returned HTTP {status}: {text}"));
    }
    Ok(truncate(&text, 8_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_endpoint_appends_tool_name_to_configured_base() {
        let config = WebSearchToolConfig::default();
        assert_eq!(
            bridge_endpoint(&config, "run_command").unwrap(),
            "http://127.0.0.1:8874/askk/tools/run_command"
        );
        assert_eq!(
            bridge_endpoint(&config, "fs_write").unwrap(),
            "http://127.0.0.1:8874/askk/tools/fs_write"
        );
    }

    #[test]
    fn bridge_endpoint_rejects_non_http_base() {
        let bad_scheme = WebSearchToolConfig {
            bridge_tools_url: "ftp://localhost/tools".to_string(),
            ..WebSearchToolConfig::default()
        };
        assert!(bridge_endpoint(&bad_scheme, "web_fetch").is_err());

        let empty = WebSearchToolConfig {
            bridge_tools_url: String::new(),
            ..WebSearchToolConfig::default()
        };
        assert!(bridge_endpoint(&empty, "web_fetch").is_err());
    }
}
