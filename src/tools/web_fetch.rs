//! `web_fetch` — fetch one page or document by URL and return cleaned readable
//! text. The browser backend uses the key-free, CORS-open Jina reader
//! (`https://r.jina.ai/<url>`); the bridge backend forwards to the local bridge.

use crate::state::{AppResult, AppSnapshot, SearchBackend, ToolSpec};
use serde_json::{Value, json};

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{string_arg, truncate};
use super::http::http_get_text;
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
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

fn handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
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

/// Browser backend: read any page as clean text via the key-free, CORS-open Jina
/// reader.
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
