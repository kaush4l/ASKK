//! `web_fetch` — fetch one page or document by URL and return cleaned readable text.
//! The browser backend reads any page through a resilient, key-free fallback chain:
//!
//! 1. **Jina reader** (`https://r.jina.ai/<url>`) — fetches the target server-side
//!    (so it bypasses CORS on *any* page) and returns clean main-content markdown.
//!    This is the primary path; it is key-free but rate-limited (~20 req/min).
//! 2. **Direct fetch** — a straight browser `GET` of the URL, used when Jina is
//!    rate-limited or down. Works only for pages that send permissive CORS headers;
//!    the raw HTML is reduced to readable text locally.
//! 3. **CORS proxy** (allorigins) — a best-effort last resort that re-serves the page
//!    with CORS headers. Public, flaky, and routes through a third party, so it is
//!    only used when both above fail.
//!
//! The bridge backend forwards to the local bridge instead.

use crate::state::{AppResult, AppSnapshot, SearchBackend, ToolSpec};
use serde_json::{Value, json};

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{string_arg, truncate};
use super::http::{encode_component, html_to_readable_text, http_get_text};
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
        description: "Fetch one web page or document by URL and return its cleaned readable text. By default it runs in the browser via a key-free reader (Jina r.jina.ai) that reads almost any page — including ones that block direct cross-origin access — and falls back to a direct fetch or a CORS proxy if the reader is busy; the bridge backend can be selected on the Tools page. Use it after web_search to read a promising source in full before you cite it — never answer a research question from search snippets alone.".to_string(),
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

/// Maximum characters of page text returned to the model.
const MAX_FETCH_CHARS: usize = 24_000;

/// Browser backend: read any page as clean text through a resilient key-free fallback
/// chain and shape it into the tool envelope. The fetch itself lives in
/// [`fetch_page_text`] so `web_search` can reuse the same chain for its parallel scrape.
async fn browser_web_fetch(url: &str) -> AppResult<String> {
    let (text, backend) = fetch_page_text(url).await?;
    Ok(fetch_response(url, &text, backend))
}

/// Read one page to clean text through the resilient key-free fallback chain — Jina
/// reader (bypasses CORS, clean markdown), then a direct fetch (for CORS-open pages
/// when Jina is busy), then a public CORS proxy as a last resort — returning the
/// untruncated text and the `&'static` name of the path that served it. Shared with
/// `web_search`'s result scrape so both tools read pages identically; each caller
/// truncates to its own budget.
pub(crate) async fn fetch_page_text(url: &str) -> AppResult<(String, &'static str)> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("web_fetch needs an absolute http(s) URL: {url}"));
    }

    // 1. Jina reader — fetches the target server-side (bypasses CORS) and returns
    //    clean main-content markdown. Primary path; key-free but rate-limited.
    if let Ok(text) = http_get_text(&format!("https://r.jina.ai/{url}")).await
        && !text.trim().is_empty()
    {
        return Ok((text, "jina_reader"));
    }

    // 2. Direct fetch — works only for CORS-open pages, but needs no third party and
    //    no rate limit. Reduce the raw HTML to readable text locally.
    if let Ok(html) = http_get_text(url).await {
        let text = html_to_readable_text(&html);
        if !text.trim().is_empty() {
            return Ok((text, "direct"));
        }
    }

    // 3. CORS proxy (allorigins) — best-effort last resort; re-serves the page with
    //    CORS headers. Public + flaky, so it is only reached when both above fail.
    let proxied = format!(
        "https://api.allorigins.win/raw?url={}",
        encode_component(url)
    );
    if let Ok(html) = http_get_text(&proxied).await {
        let text = html_to_readable_text(&html);
        if !text.trim().is_empty() {
            return Ok((text, "cors_proxy"));
        }
    }

    Err(format!(
        "web_fetch could not read {url}: the key-free reader is rate-limited or unavailable, and the page does not allow direct cross-origin access. Try again shortly, or switch to the Bridge backend on the Tools page."
    ))
}

/// Shape one successful fetch into the shared tool envelope, truncating to
/// [`MAX_FETCH_CHARS`] and recording which backend served it.
fn fetch_response(url: &str, text: &str, backend: &str) -> String {
    json!({
        "success": true,
        "data": {
            "url": url,
            "text": truncate(text, MAX_FETCH_CHARS),
            "backend": backend,
        }
    })
    .to_string()
}
