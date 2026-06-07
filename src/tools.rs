//! Tool pillar (one of the four core types: Engine, **Tool**, Provider, Capability).
//!
//! A tool is an MCP-shaped object: [`ToolSpec`] is `{ name, description,
//! input_schema }` (the same fields an MCP tool advertises) and every call returns
//! a [`ToolResult`] `{ ok, content }`. Tools are pre-compiled into the WASM harness
//! and registered in [`ToolRegistry`]; adding one is a single `register(...)` call,
//! never an edit to the agent loop. Tools run either fully in the browser (`run_js`,
//! the browser web_search/web_fetch backend, the IndexedDB `file_*` VFS) or, when a
//! local bridge is available, through it (`run_command`, disk `fs_*`).

use crate::state::{
    AppResult, AppSnapshot, SearchBackend, ToolResult, ToolSpec, WebSearchToolConfig,
};
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
    registry.register(run_js_descriptor());
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

fn run_js_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: run_js_spec(),
        handler: run_js_handler,
    }
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

fn run_js_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let code = string_arg(args, "code")?;
        let timeout_ms = integer_arg(args, "timeout_ms")
            .unwrap_or(10_000)
            .clamp(100, 60_000) as u32;
        let value = crate::browser_exec::run_js_in_browser(&code, timeout_ms).await?;
        let (ok, text) = crate::browser_exec::format_run_js(&value);
        if ok { Ok(text) } else { Err(text) }
    })
}

fn web_fetch_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let url = string_arg(args, "url")?;
        match snapshot.tool_config.web_search.backend {
            SearchBackend::Browser => browser_web_fetch(&url).await,
            SearchBackend::Bridge => {
                let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "web_fetch")?;
                bridge_tool_request("web_fetch", &endpoint, json!({ "url": url })).await
            }
        }
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
        description: "Search the web and get back titles, URLs, and descriptions. By default this runs directly in the browser (key-free, works on the hosted site); it can be switched to the local bridge for richer providers on the Tools page. Use it to discover sources, then web_fetch the best ones to read them in full.".to_string(),
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

fn run_js_spec() -> ToolSpec {
    ToolSpec {
        name: "run_js".to_string(),
        description: "Run JavaScript natively in the browser, in a sandboxed Web Worker with no bridge or network setup required. The snippet is the body of an async function, so top-level `await` and `return` work; `console.log(...)` output is captured. Returns ok, stdout, stderr, result, and error. Use this to execute and TEST code in-browser: treat ok:true with the expected output as your verification that the code works.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "code": { "type": "string", "description": "JavaScript to run. Log with console.log; `return value` becomes the result." },
                "timeout_ms": { "type": "integer", "description": "Hard timeout in milliseconds (100-60000, default 10000)." }
            },
            "required": ["code"]
        }),
    }
}

fn web_fetch_spec() -> ToolSpec {
    ToolSpec {
        name: "web_fetch".to_string(),
        description: "Fetch one web page or document by URL and return its cleaned readable text. By default it runs in the browser via a key-free reader (works on the hosted site); the bridge backend can be selected on the Tools page. Use it after web_search to read a promising source in full before you cite it — never answer a research question from search snippets alone.".to_string(),
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
    match config.backend {
        SearchBackend::Browser => browser_web_search(args, config).await,
        SearchBackend::Bridge => {
            let (endpoint, body) = build_web_search_request(args, config)?;
            bridge_tool_request("web_search", &endpoint, body).await
        }
    }
}

// ---------------------------------------------------------------------------
// Browser-direct search/fetch backend.
//
// Calls CORS-open, key-free public endpoints straight from the page, so research
// works on the hosted HTTPS site with no bridge. It is intentionally an abstract
// seam: additional providers (Brave/Tavily/Jina-with-key) can be added behind the
// same `SearchBackend` / `web_search` envelope without touching the agent loop.
// ---------------------------------------------------------------------------

/// Browser web_search: merge DuckDuckGo Instant Answer (instant abstracts) with
/// Wikipedia full-text search (real multi-result hits). Both are CORS `*` and
/// key-free. Returns the shared `{ success, data: { web: [...] } }` envelope.
async fn browser_web_search(args: &Value, config: &WebSearchToolConfig) -> AppResult<String> {
    let query = string_arg(args, "query")?;
    let count = integer_arg(args, "count")
        .unwrap_or(i64::from(config.default_count))
        .clamp(1, 10) as usize;

    let mut results: Vec<(String, String, String)> = Vec::new();
    if let Ok(mut ddg) = duckduckgo_instant_answer(&query).await {
        results.append(&mut ddg);
    }
    if let Ok(mut wiki) = wikipedia_search(&query, count).await {
        results.append(&mut wiki);
    }

    // Deduplicate by URL, keep order, cap to `count`, then number the positions.
    let mut seen = std::collections::HashSet::new();
    let web: Vec<Value> = results
        .into_iter()
        .filter(|(_, url, _)| !url.is_empty() && seen.insert(url.clone()))
        .take(count)
        .enumerate()
        .map(|(index, (title, url, description))| {
            json!({
                "title": title,
                "url": url,
                "description": description,
                "position": index + 1,
            })
        })
        .collect();

    if web.is_empty() {
        return Err(format!(
            "No browser web_search results for `{query}`. The key-free browser backend (DuckDuckGo Instant Answer + Wikipedia) has limited coverage; switch the Tools page backend to Bridge for a full search provider."
        ));
    }

    Ok(json!({ "success": true, "data": { "web": web }, "backend": "browser" }).to_string())
}

/// Browser web_fetch: read any page as clean text via the key-free, CORS-open
/// Jina reader (`https://r.jina.ai/<url>`).
async fn browser_web_fetch(url: &str) -> AppResult<String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("web_fetch needs an absolute http(s) URL: {url}"));
    }
    let endpoint = format!("https://r.jina.ai/{url}");
    let text = http_get_text(&endpoint).await?;
    let body = json!({
        "success": true,
        "data": {
            "url": url,
            "text": truncate(&text, 24_000),
            "backend": "jina_reader",
        }
    });
    Ok(body.to_string())
}

async fn duckduckgo_instant_answer(query: &str) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        encode_component(query)
    );
    let value = http_get_json(&url).await?;
    let mut out = Vec::new();

    let abstract_text = value
        .get("AbstractText")
        .and_then(Value::as_str)
        .unwrap_or("");
    let abstract_url = value
        .get("AbstractURL")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !abstract_text.is_empty() && !abstract_url.is_empty() {
        let heading = value
            .get("Heading")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(query);
        out.push((
            heading.to_string(),
            abstract_url.to_string(),
            abstract_text.to_string(),
        ));
    }

    if let Some(topics) = value.get("RelatedTopics").and_then(Value::as_array) {
        collect_ddg_topics(topics, &mut out);
    }
    Ok(out)
}

fn collect_ddg_topics(topics: &[Value], out: &mut Vec<(String, String, String)>) {
    for topic in topics {
        if let Some(nested) = topic.get("Topics").and_then(Value::as_array) {
            collect_ddg_topics(nested, out);
            continue;
        }
        let text = topic.get("Text").and_then(Value::as_str).unwrap_or("");
        let url = topic.get("FirstURL").and_then(Value::as_str).unwrap_or("");
        if text.is_empty() || url.is_empty() {
            continue;
        }
        let title = text.split(" - ").next().unwrap_or(text);
        out.push((title.to_string(), url.to_string(), text.to_string()));
    }
}

async fn wikipedia_search(query: &str, count: usize) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={}&format=json&origin=*&srlimit={}",
        encode_component(query),
        count.clamp(1, 10)
    );
    let value = http_get_json(&url).await?;
    let mut out = Vec::new();
    if let Some(hits) = value
        .get("query")
        .and_then(|query| query.get("search"))
        .and_then(Value::as_array)
    {
        for hit in hits {
            let title = hit.get("title").and_then(Value::as_str).unwrap_or("");
            if title.is_empty() {
                continue;
            }
            let snippet = strip_html(hit.get("snippet").and_then(Value::as_str).unwrap_or(""));
            let page_url = format!(
                "https://en.wikipedia.org/wiki/{}",
                encode_component(&title.replace(' ', "_"))
            );
            out.push((title.to_string(), page_url, snippet));
        }
    }
    Ok(out)
}

async fn http_get_text(url: &str) -> AppResult<String> {
    let response = Request::get(url)
        .send()
        .await
        .map_err(|err| format!("Browser request to {url} failed (network or CORS): {err:?}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read response from {url}: {err:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("{url} returned HTTP {status}"));
    }
    Ok(text)
}

async fn http_get_json(url: &str) -> AppResult<Value> {
    let text = http_get_text(url).await?;
    serde_json::from_str::<Value>(&text).map_err(|err| format!("{url} returned non-JSON: {err}"))
}

/// Percent-encode a string for use as a URL query component (RFC 3986 unreserved
/// set kept). Pure and host-testable so it does not depend on `js_sys`.
fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn strip_html(value: &str) -> String {
    let without_tags = regex::Regex::new("<[^>]+>")
        .map(|re| re.replace_all(value, "").into_owned())
        .unwrap_or_else(|_| value.to_string());
    without_tags
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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
    fn encode_component_escapes_reserved_characters() {
        assert_eq!(encode_component("a b&c"), "a%20b%26c");
        assert_eq!(encode_component("rust-lang_2.0~x"), "rust-lang_2.0~x");
    }

    #[test]
    fn strip_html_removes_tags_and_decodes_entities() {
        assert_eq!(
            strip_html("<span class=\"x\">Bun</span> &amp; Node"),
            "Bun & Node"
        );
    }

    #[test]
    fn collect_ddg_topics_flattens_nested_topics() {
        let topics = serde_json::json!([
            { "Text": "Bun - a JS runtime", "FirstURL": "https://bun.sh" },
            { "Topics": [ { "Text": "Deno - a runtime", "FirstURL": "https://deno.com" } ] },
            { "Text": "no url here" }
        ]);
        let mut out = Vec::new();
        collect_ddg_topics(topics.as_array().unwrap(), &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].0, "Bun");
        assert_eq!(out[0].1, "https://bun.sh");
        assert_eq!(out[1].1, "https://deno.com");
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
            "run_js",
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
