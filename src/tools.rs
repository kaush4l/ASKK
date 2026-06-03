use crate::state::{now_iso, AppResult, AppSnapshot, MemoryItem, TaskItem, ToolResult, ToolSpec};
use gloo_net::http::Request;
use serde_json::{json, Value};
use uuid::Uuid;

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

fn string_arg(args: &Value, key: &str) -> AppResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required string argument `{key}`"))
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("...");
    output
}
