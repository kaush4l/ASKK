//! `web_search` — discover sources on the web. Two interchangeable backends sit
//! behind the same `web_search` envelope (`{ success, data: { web: [...] } }`):
//!
//! - **Browser** (default, key-free): merge DuckDuckGo Instant Answer with Wikipedia
//!   full-text search. Both are CORS `*` and key-free, so it works on the hosted
//!   HTTPS site with no bridge.
//! - **Bridge**: forward to a full provider (Brave/Tavily/SearXNG) via the local
//!   bridge.
//!
//! Adding another provider is a new arm here behind `SearchBackend`; the agent loop
//! never changes.

use crate::state::{AppResult, AppSnapshot, SearchBackend, ToolSpec, WebSearchToolConfig};
use serde_json::{Value, json};
use std::collections::HashSet;

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{integer_arg, merge_optional_string, string_arg};
use super::http::{encode_component, http_get_json, strip_html};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
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

fn handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { web_search_with_config(args, &snapshot.tool_config.web_search).await })
}

/// Run a search with an explicit config. Public so the Tools page can probe the
/// configured backend without going through the agent loop.
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

/// Browser backend: merge DuckDuckGo Instant Answer (instant abstracts) with
/// Wikipedia full-text search (real multi-result hits), dedupe by URL, cap to
/// `count`, and number the positions.
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

    let mut seen = HashSet::new();
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

fn merge_config_string(body: &mut Value, key: &str, value: &str) {
    let value = value.trim();
    if !value.is_empty() {
        body[key] = Value::String(value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
