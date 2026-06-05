use crate::state::{now_iso, AppResult, AppSnapshot, MemoryItem, TaskItem, ToolResult, ToolSpec};
use gloo_net::http::Request;
use serde_json::{json, Value};
use uuid::Uuid;

const BRIDGE_TOOL_BASE_URL: &str = "http://127.0.0.1:8874/askk/tools";

#[derive(Clone, Debug, Default)]
pub struct ToolRegistry {
    specs: Vec<ToolSpec>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            specs: vec![
                ToolSpec {
                    name: "memory_write".to_string(),
                    description: "Store a durable browser memory for later agents.".to_string(),
                    input_schema: json!({"type":"object","properties":{"content":{"type":"string"}},"required":["content"]}),
                },
                ToolSpec {
                    name: "memory_search".to_string(),
                    description: "Search browser memories by a case-insensitive query.".to_string(),
                    input_schema: json!({"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}),
                },
                ToolSpec {
                    name: "summarize_notes".to_string(),
                    description:
                        "Create a compact summary from provided notes or current memories."
                            .to_string(),
                    input_schema: json!({"type":"object","properties":{"notes":{"type":"string"}}}),
                },
                ToolSpec {
                    name: "create_task".to_string(),
                    description: "Create a browser-local task.".to_string(),
                    input_schema: json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}),
                },
                ToolSpec {
                    name: "update_task".to_string(),
                    description: "Update a browser-local task status by id.".to_string(),
                    input_schema: json!({"type":"object","properties":{"id":{"type":"string"},"status":{"type":"string"}},"required":["id","status"]}),
                },
                ToolSpec {
                    name: "web_fetch_text".to_string(),
                    description: "Fetch text from a URL when browser CORS policy allows it."
                        .to_string(),
                    input_schema: json!({"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}),
                },
                ToolSpec {
                    name: "web_search".to_string(),
                    description: "Search the web through the ASKK local bridge. Returns Hermes/OpenClaw-style results with titles, URLs, descriptions, and positions.".to_string(),
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
                },
                ToolSpec {
                    name: "web_extract".to_string(),
                    description: "Extract content from up to 5 web page URLs through the ASKK local bridge. Returns Hermes-style document results.".to_string(),
                    input_schema: json!({
                        "type":"object",
                        "properties":{
                            "urls":{"type":"array","items":{"type":"string"},"maxItems":5}
                        },
                        "required":["urls"]
                    }),
                },
            ],
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
            "memory_write" => memory_write(snapshot, &args).await,
            "memory_search" => memory_search(snapshot, &args).await,
            "summarize_notes" => summarize_notes(snapshot, &args).await,
            "create_task" => create_task(snapshot, &args).await,
            "update_task" => update_task(snapshot, &args).await,
            "web_fetch_text" => web_fetch_text(&args).await,
            "web_search" => web_search(&args).await,
            "web_extract" => web_extract(&args).await,
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

async fn memory_write(snapshot: &mut AppSnapshot, args: &Value) -> AppResult<String> {
    let content = string_arg(args, "content")?;
    let item = MemoryItem {
        id: Uuid::new_v4().to_string(),
        content,
        created_at: now_iso(),
    };
    snapshot.memories.push(item.clone());
    Ok(format!("Stored memory {}: {}", item.id, item.content))
}

async fn memory_search(snapshot: &AppSnapshot, args: &Value) -> AppResult<String> {
    let query = string_arg(args, "query")?.to_lowercase();
    let matches = snapshot
        .memories
        .iter()
        .filter(|item| item.content.to_lowercase().contains(&query))
        .map(|item| format!("- {}: {}", item.id, item.content))
        .collect::<Vec<_>>();

    if matches.is_empty() {
        Ok("No matching memories.".to_string())
    } else {
        Ok(matches.join("\n"))
    }
}

async fn summarize_notes(snapshot: &AppSnapshot, args: &Value) -> AppResult<String> {
    let notes = args
        .get("notes")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            snapshot
                .memories
                .iter()
                .map(|item| item.content.clone())
                .collect::<Vec<_>>()
                .join("\n")
        });

    if notes.trim().is_empty() {
        return Ok("No notes or memories available to summarize.".to_string());
    }

    let first_lines = notes
        .lines()
        .take(6)
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!("Local summary: {}", truncate(&first_lines, 600)))
}

async fn create_task(snapshot: &mut AppSnapshot, args: &Value) -> AppResult<String> {
    let task = TaskItem {
        id: Uuid::new_v4().to_string(),
        title: string_arg(args, "title")?,
        status: "open".to_string(),
    };
    snapshot.tasks.push(task.clone());
    Ok(format!("Created task {}: {}", task.id, task.title))
}

async fn update_task(snapshot: &mut AppSnapshot, args: &Value) -> AppResult<String> {
    let id = string_arg(args, "id")?;
    let status = string_arg(args, "status")?;
    let Some(task) = snapshot.tasks.iter_mut().find(|task| task.id == id) else {
        return Err(format!("No task found with id {id}"));
    };
    task.status = status;
    Ok(format!("Updated task {} to {}", task.id, task.status))
}

async fn web_fetch_text(args: &Value) -> AppResult<String> {
    let url = string_arg(args, "url")?;
    let response = Request::get(&url).send().await.map_err(|err| {
        format!("Browser fetch failed, likely due to CORS or network policy: {err:?}")
    })?;

    if !response.ok() {
        return Err(format!("Fetch returned HTTP {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read fetched text: {err:?}"))?;
    Ok(truncate(&text, 4_000))
}

async fn web_search(args: &Value) -> AppResult<String> {
    let query = string_arg(args, "query")?;
    let count = integer_arg(args, "count").unwrap_or(5).clamp(1, 10);
    let mut body = json!({
        "query": query,
        "count": count,
    });

    for key in [
        "country",
        "language",
        "ui_lang",
        "freshness",
        "date_after",
        "date_before",
    ] {
        if let Some(value) = args.get(key).and_then(Value::as_str).map(str::trim) {
            if !value.is_empty() {
                body[key] = Value::String(value.to_string());
            }
        }
    }

    bridge_tool_request("web_search", body).await
}

async fn web_extract(args: &Value) -> AppResult<String> {
    let urls = string_array_arg(args, "urls")?;
    if urls.is_empty() {
        return Err("Missing required non-empty URL list argument `urls`".to_string());
    }
    bridge_tool_request(
        "web_extract",
        json!({
            "urls": urls.into_iter().take(5).collect::<Vec<_>>()
        }),
    )
    .await
}

async fn bridge_tool_request(tool_name: &str, body: Value) -> AppResult<String> {
    let endpoint = format!("{BRIDGE_TOOL_BASE_URL}/{tool_name}");
    let response = Request::post(&endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|err| format!("Unable to create {tool_name} bridge request: {err:?}"))?
        .send()
        .await
        .map_err(|err| {
            format!(
                "{tool_name} bridge request failed. Run `node scripts/askk-local-bridge.mjs` on this browser machine. Optional web search providers are configured on the bridge with Brave, Tavily, or SearXNG env vars; without them the bridge uses key-free DuckDuckGo HTML search. Browser fetch details: {err:?}"
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

fn string_array_arg(args: &Value, key: &str) -> AppResult<Vec<String>> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .ok_or_else(|| format!("Missing required array argument `{key}`"))
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("...");
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::default_tool_names;

    #[test]
    fn default_tool_specs_include_web_search_and_extract() {
        let registry = ToolRegistry::new();
        let specs = registry.specs_for_agent(&default_tool_names());
        let names = specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"web_search"));
        assert!(names.contains(&"web_extract"));
    }

    #[test]
    fn string_array_arg_filters_empty_values() {
        let args = json!({"urls": ["https://example.com", "", "  https://docs.rs  "]});
        assert_eq!(
            string_array_arg(&args, "urls").unwrap(),
            vec!["https://example.com", "https://docs.rs"]
        );
    }
}
