use crate::state::{AppResult, AppSnapshot, ToolResult, ToolSpec, WebSearchToolConfig};
use crate::vfs::ProjectVfs;
use gloo_net::http::Request;
use serde_json::{Value, json};

#[derive(Clone, Debug, Default)]
pub struct ToolRegistry {
    specs: Vec<ToolSpec>,
    vfs: ProjectVfs,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            specs: vec![
                web_search_spec(),
                file_read_spec(),
                file_write_spec(),
                file_list_spec(),
            ],
            vfs: ProjectVfs::new(),
        }
    }

    pub fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
        self.specs
            .iter()
            .filter(|spec| enabled_tools.iter().any(|enabled| enabled == &spec.name))
            .cloned()
            .collect()
    }

    pub async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: Value,
    ) -> ToolResult {
        let result = match tool_name {
            "web_search" => web_search_with_config(&args, &snapshot.tool_config.web_search).await,
            "file_read" => match string_arg(&args, "path") {
                Ok(path) => self
                    .vfs
                    .read_file(&path)
                    .await
                    .map(|c| c.unwrap_or_default())
                    .map_err(|e| format!("VFS read error: {e}")),
                Err(e) => Err(format!("Tool argument error (file_read): {e}")),
            },
            "file_write" => match (string_arg(&args, "path"), string_arg(&args, "content")) {
                (Ok(path), Ok(content)) => self
                    .vfs
                    .write_file(&path, &content)
                    .await
                    .map(|_| "Success".to_string())
                    .map_err(|e| format!("VFS write error: {e}")),
                (Err(e), _) | (_, Err(e)) => Err(format!("Tool argument error (file_write): {e}")),
            },
            "file_list" => self
                .vfs
                .list_files()
                .await
                .map(|f| f.join(", "))
                .map_err(|e| format!("VFS list error: {e}")),
            _ => Err(format!("Unknown compiled tool: {tool_name}")),
        };

        match result {
            Ok(content) => ToolResult {
                call_id,
                ok: true,
                content,
            },
            Err(content) => ToolResult {
                call_id,
                ok: false,
                content,
            },
        }
    }
}

fn web_search_spec() -> ToolSpec {
    ToolSpec {
        name: "web_search".to_string(),
        description: "Search the web through the ASKK local bridge. The bridge provider is configured in Tools. Returns Hermes/OpenClaw-style results with titles, URLs, descriptions, and positions.".to_string(),
        input_schema: json!({
            "type":"object",
            "properties":{
                "query":{"type":"string"},
                "count":{"type":"integer","minimum":1,"maximum":10},
                "country":{"type":"string"},
                "language":{"type":"string"},
                "freshness":{"type":"string"},
                "date_after":{"type":"string"},
                "date_before":{"type":"string"}
            },
            "required":["query"]
        }),
    }
}

pub async fn web_search_with_config(
    args: &Value,
    config: &WebSearchToolConfig,
) -> AppResult<String> {
    let (endpoint, body) = build_web_search_request(args, config)?;
    bridge_tool_request("web_search", &endpoint, body).await
}

fn build_web_search_request(
    args: &Value,
    config: &WebSearchToolConfig,
) -> AppResult<(String, Value)> {
    let query = string_arg(args, "query")?;
    let count = integer_arg(args, "count")
        .unwrap_or(i64::from(config.default_count))
        .clamp(1, 10);

    let mut body = json!({
        "query": query,
        "count": count,
        "provider": config.provider.as_form_value(),
    });

    merge_optional_string(args, &mut body, "country", Some(&config.country));
    merge_optional_string(args, &mut body, "language", Some(&config.language));
    merge_optional_string(args, &mut body, "freshness", Some(&config.freshness));
    merge_optional_string(args, &mut body, "date_after", None);
    merge_optional_string(args, &mut body, "date_before", None);
    merge_config_string(&mut body, "searxng_url", &config.searxng_url);
    merge_config_string(&mut body, "brave_api_key", &config.brave_api_key);
    merge_config_string(&mut body, "tavily_api_key", &config.tavily_api_key);

    let base = config.bridge_tools_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Web search bridge URL is empty. Set it on the Tools page.".to_string());
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err(format!(
            "Web search bridge URL must start with http:// or https://: {base}"
        ));
    }
    Ok((format!("{base}/web_search"), body))
}

async fn bridge_tool_request(tool_name: &str, endpoint: &str, body: Value) -> AppResult<String> {
    let response = Request::post(endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|err| format!("Unable to create {tool_name} bridge request: {err:?}"))?
        .send()
        .await
        .map_err(|err| {
            format!(
                "{tool_name} bridge request failed. Run `node scripts/askk-local-bridge.mjs` from the project root so the hosted app can read and update soul.md, agents/, and skills/. Browser fetch details: {err:?}"
            )
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read {tool_name} bridge response: {err:?}"))?;

    if !(200..300).contains(&status) {
        return Err(format!("{tool_name} bridge returned HTTP {status}: {text}"));
    }

    Ok(truncate(&text, 8_000))
}

fn merge_optional_string(args: &Value, body: &mut Value, key: &str, fallback: Option<&str>) {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .or_else(|| fallback.map(str::trim));
    if let Some(value) = value {
        body[key] = Value::String(value.to_string());
    }
}

fn merge_config_string(body: &mut Value, key: &str, value: &str) {
    let value = value.trim();
    if !value.is_empty() {
        body[key] = Value::String(value.to_string());
    }
}

fn string_arg(args: &Value, key: &str) -> AppResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required string argument `{key}`"))
}

fn integer_arg(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
    })
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("...");
    output
}

fn file_read_spec() -> ToolSpec {
    ToolSpec {
        name: "file_read".to_string(),
        description: "Read the content of a file from the project's virtual filesystem."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"]
        }),
    }
}

fn file_write_spec() -> ToolSpec {
    ToolSpec {
        name: "file_write".to_string(),
        description:
            "Write or overwrite the content of a file in the project's virtual filesystem."
                .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        }),
    }
}

fn file_list_spec() -> ToolSpec {
    ToolSpec {
        name: "file_list".to_string(),
        description: "List all files in the project's virtual filesystem.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}
