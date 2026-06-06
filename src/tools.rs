use crate::state::{AppResult, AppSnapshot, ToolResult, ToolSpec, WebSearchToolConfig};
use crate::vfs::ProjectVfs;
use gloo_net::http::Request;
use serde_json::{Value, json};
use std::future::Future;
use std::pin::Pin;

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = AppResult<String>> + 'a>>;
pub type ToolHandler = for<'a> fn(&'a mut AppSnapshot, &'a Value) -> ToolFuture<'a>;

#[derive(Clone)]
pub struct ToolDescriptor {
    pub spec: ToolSpec,
    pub handler: ToolHandler,
}

impl std::fmt::Debug for ToolDescriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolDescriptor")
            .field("spec", &self.spec)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Default)]
pub struct ToolRegistry {
    descriptors: Vec<ToolDescriptor>,
}

impl ToolRegistry {
    pub fn empty() -> Self {
        Self {
            descriptors: Vec::new(),
        }
    }

    pub fn new() -> Self {
        let mut registry = Self::empty();
        register_builtin_tools(&mut registry);
        registry
    }

    pub fn register(&mut self, descriptor: ToolDescriptor) {
        self.descriptors
            .retain(|existing| existing.spec.name != descriptor.spec.name);
        self.descriptors.push(descriptor);
    }

    pub fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
        self.descriptors
            .iter()
            .filter(|descriptor| {
                enabled_tools
                    .iter()
                    .any(|enabled| enabled == &descriptor.spec.name)
            })
            .map(|descriptor| descriptor.spec.clone())
            .collect()
    }

    pub async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: Value,
    ) -> ToolResult {
        let result = match self
            .descriptors
            .iter()
            .find(|descriptor| descriptor.spec.name == tool_name)
        {
            Some(descriptor) => (descriptor.handler)(snapshot, &args).await,
            None => Err(format!("Unknown compiled tool: {tool_name}")),
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

fn register_builtin_tools(registry: &mut ToolRegistry) {
    registry.register(web_search_descriptor());
    registry.register(web_fetch_descriptor());
    registry.register(run_command_descriptor());
    registry.register(fs_read_descriptor());
    registry.register(fs_write_descriptor());
    registry.register(fs_list_descriptor());
    registry.register(file_read_descriptor());
    registry.register(file_write_descriptor());
    registry.register(file_list_descriptor());
}

fn web_fetch_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: web_fetch_spec(),
        handler: web_fetch_handler,
    }
}

fn run_command_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: run_command_spec(),
        handler: run_command_handler,
    }
}

fn fs_read_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: fs_read_spec(),
        handler: fs_read_handler,
    }
}

fn fs_write_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: fs_write_spec(),
        handler: fs_write_handler,
    }
}

fn fs_list_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: fs_list_spec(),
        handler: fs_list_handler,
    }
}

fn web_search_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: web_search_spec(),
        handler: web_search_handler,
    }
}

fn file_read_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: file_read_spec(),
        handler: file_read_handler,
    }
}

fn file_write_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: file_write_spec(),
        handler: file_write_handler,
    }
}

fn file_list_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: file_list_spec(),
        handler: file_list_handler,
    }
}

fn web_search_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { web_search_with_config(args, &snapshot.tool_config.web_search).await })
}

fn web_fetch_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let url = string_arg(args, "url")?;
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "web_fetch")?;
        bridge_tool_request("web_fetch", &endpoint, json!({ "url": url })).await
    })
}

fn run_command_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let command = string_arg(args, "command")?;
        let mut body = json!({ "command": command });
        merge_optional_string(args, &mut body, "cwd", None);
        if let Some(timeout_ms) = integer_arg(args, "timeout_ms") {
            body["timeout_ms"] = json!(timeout_ms);
        }
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "run_command")?;
        bridge_tool_request("run_command", &endpoint, body).await
    })
}

fn fs_read_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_read")?;
        bridge_tool_request("fs_read", &endpoint, json!({ "path": path })).await
    })
}

fn fs_write_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let content = args
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_write")?;
        bridge_tool_request(
            "fs_write",
            &endpoint,
            json!({ "path": path, "content": content }),
        )
        .await
    })
}

fn fs_list_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let mut body = json!({});
        merge_optional_string(args, &mut body, "path", None);
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_list")?;
        bridge_tool_request("fs_list", &endpoint, body).await
    })
}

fn file_read_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        ProjectVfs::new()
            .read_file(&path)
            .await
            .map(|content| content.unwrap_or_default())
            .map_err(|err| format!("VFS read error: {err}"))
    })
}

fn file_write_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let content = string_arg(args, "content")?;
        ProjectVfs::new()
            .write_file(&path, &content)
            .await
            .map(|_| "Success".to_string())
            .map_err(|err| format!("VFS write error: {err}"))
    })
}

fn file_list_handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        ProjectVfs::new()
            .list_files()
            .await
            .map(|files| files.join(", "))
            .map_err(|err| format!("VFS list error: {err}"))
    })
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

fn web_fetch_spec() -> ToolSpec {
    ToolSpec {
        name: "web_fetch".to_string(),
        description: "Fetch one web page or document by URL through the ASKK local bridge and return its cleaned readable text and title. Use it after web_search to read a promising source in full before you cite it — never answer a research question from search snippets alone.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "Absolute http(s) URL to fetch." }
            },
            "required": ["url"]
        }),
    }
}

fn run_command_spec() -> ToolSpec {
    ToolSpec {
        name: "run_command".to_string(),
        description: "Run a shell command (bun, bunx, node, npm, npx, tsc, vitest, git, ls, cat, mkdir, …) inside the project run root on the bridge machine. Returns exit_code, ok, stdout, and stderr. Requires the bridge started with --allow-exec. This is how you install, build, run, and TEST a project: treat exit_code 0 (ok=true) as the only proof that a build or test step actually passed.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command line to run, e.g. 'bun install' or 'bun test'." },
                "cwd": { "type": "string", "description": "Optional subdirectory of the run root to run in." },
                "timeout_ms": { "type": "integer", "description": "Optional per-command timeout in milliseconds." }
            },
            "required": ["command"]
        }),
    }
}

fn fs_read_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_read".to_string(),
        description: "Read a file from the project run root — the real on-disk workspace that run_command and bun also see. Use this (not file_read) when working on a runnable project.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path relative to the run root, e.g. 'src/index.ts'." }
            },
            "required": ["path"]
        }),
    }
}

fn fs_write_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_write".to_string(),
        description: "Create or overwrite a file in the project run root so run_command and bun can see it on disk. Parent directories are created automatically. Use this to scaffold and edit a runnable project.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path relative to the run root, e.g. 'package.json'." },
                "content": { "type": "string", "description": "Full file contents to write." }
            },
            "required": ["path", "content"]
        }),
    }
}

fn fs_list_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_list".to_string(),
        description: "List files and directories in the project run root (the on-disk workspace). Optionally scope to a subdirectory.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Optional subdirectory of the run root to list." }
            }
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

/// Send a JSON request to a bridge tool endpoint and return the parsed `{ success,
/// data }` envelope. Unlike [`bridge_tool_request`], the body is not truncated, so
/// the Workspace page can read full file contents and command output.
pub async fn bridge_json_request(endpoint: &str, body: Value) -> AppResult<Value> {
    let response = Request::post(endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|err| format!("Unable to create bridge request: {err:?}"))?
        .send()
        .await
        .map_err(|err| {
            format!(
                "ASKK bridge request failed. Run `node scripts/askk-local-bridge.mjs --allow-exec` from the project root. Browser fetch details: {err:?}"
            )
        })?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read bridge response: {err:?}"))?;
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

    Ok((bridge_endpoint(config, "web_search")?, body))
}

/// Build the bridge endpoint for a named ASKK tool from the configured tools base
/// URL (default `http://127.0.0.1:8874/askk/tools`). Every bridge-backed tool —
/// `web_search`, `web_fetch`, `run_command`, and the `fs_*` family — routes here.
pub fn bridge_endpoint(config: &WebSearchToolConfig, tool: &str) -> AppResult<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_tool_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
        Box::pin(async move {
            Ok(format!(
                "demo:{}",
                args.get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("missing")
            ))
        })
    }

    #[test]
    fn registry_accepts_new_tool_descriptor_without_execute_match_edits() {
        let mut registry = ToolRegistry::empty();
        registry.register(ToolDescriptor {
            spec: ToolSpec {
                name: "demo_tool".to_string(),
                description: "A test-only descriptor-backed tool.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": { "value": { "type": "string" } },
                    "required": ["value"]
                }),
            },
            handler: demo_tool_handler,
        });

        let specs = registry.specs_for_agent(&["demo_tool".to_string()]);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "demo_tool");

        let mut snapshot = AppSnapshot::default();
        let result = pollster::block_on(registry.execute(
            &mut snapshot,
            "call-1".to_string(),
            "demo_tool",
            json!({ "value": "ok" }),
        ));

        assert!(result.ok);
        assert_eq!(result.content, "demo:ok");
    }

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

    #[test]
    fn default_registry_includes_disk_and_browser_tools() {
        let registry = ToolRegistry::new();
        let all = crate::state::default_tool_names();
        let specs = registry.specs_for_agent(&all);
        let names = specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect::<Vec<_>>();
        for expected in [
            "web_search",
            "web_fetch",
            "run_command",
            "fs_read",
            "fs_write",
            "fs_list",
        ] {
            assert!(names.contains(&expected), "missing tool: {expected}");
        }
    }
}
