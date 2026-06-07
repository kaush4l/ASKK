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

    // No single key-free API does general web search, so query several CORS-open,
    // key-free sources CONCURRENTLY and merge: DuckDuckGo Instant Answer (entity /
    // definition answers), Hacker News (current tech discussion), Stack Overflow
    // (coding Q&A), and Wikipedia (reference). For a full general-web provider
    // (Brave / Tavily / SearXNG), switch the Tools page backend to Bridge.
    let (ddg, hn, stack, wiki) = futures_util::join!(
        duckduckgo_instant_answer(&query),
        hackernews_search(&query, count),
        stackoverflow_search(&query, count),
        wikipedia_search(&query, count),
    );
    let sources: Vec<Vec<(String, String, String)>> =
        [ddg, hn, stack, wiki].into_iter().flatten().collect();
    let web = merge_search_results(&sources, count);

    if web.is_empty() {
        return Err(format!(
            "No browser web_search results for `{query}`. The key-free browser backend (DuckDuckGo, Hacker News, Stack Overflow, Wikipedia) has limited coverage; switch the Tools page backend to Bridge for a full general-web provider (Brave / Tavily / SearXNG)."
        ));
    }

    Ok(json!({ "success": true, "data": { "web": web }, "backend": "browser" }).to_string())
}

/// Merge per-source result lists into the shared `web` array by round-robin
/// interleaving (one hit from each source in turn), so the set is diverse rather
/// than dominated by whichever source returned the most. Dedupes by URL, caps to
/// `count`, and numbers the positions.
fn merge_search_results(sources: &[Vec<(String, String, String)>], count: usize) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut web: Vec<Value> = Vec::new();
    let mut depth = 0;
    loop {
        let mut advanced = false;
        for source in sources {
            let Some((title, url, description)) = source.get(depth) else {
                continue;
            };
            advanced = true;
            if url.is_empty() || !seen.insert(url.clone()) {
                continue;
            }
            web.push(json!({
                "title": title,
                "url": url,
                "description": description,
                "position": web.len() + 1,
            }));
            if web.len() >= count {
                break;
            }
        }
        if web.len() >= count || !advanced {
            break;
        }
        depth += 1;
    }
    web
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

/// Hacker News full-text story search via the key-free, CORS-open Algolia API.
/// Good for current tech news and discussion; returns the story URL (or the HN
/// item permalink for text posts like "Ask HN").
async fn hackernews_search(query: &str, count: usize) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://hn.algolia.com/api/v1/search?query={}&tags=story&hitsPerPage={}",
        encode_component(query),
        count.clamp(1, 10)
    );
    let value = http_get_json(&url).await?;
    Ok(parse_hackernews_hits(&value))
}

fn parse_hackernews_hits(value: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Some(hits) = value.get("hits").and_then(Value::as_array) else {
        return out;
    };
    for hit in hits {
        let title = hit.get("title").and_then(Value::as_str).unwrap_or("");
        if title.is_empty() {
            continue;
        }
        let object_id = hit.get("objectID").and_then(Value::as_str).unwrap_or("");
        let url = hit
            .get("url")
            .and_then(Value::as_str)
            .filter(|url| !url.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("https://news.ycombinator.com/item?id={object_id}"));
        let points = hit.get("points").and_then(Value::as_i64).unwrap_or(0);
        let comments = hit.get("num_comments").and_then(Value::as_i64).unwrap_or(0);
        out.push((
            title.to_string(),
            url,
            format!("Hacker News · {points} points · {comments} comments"),
        ));
    }
    out
}

/// Stack Overflow question search via the key-free, CORS-open Stack Exchange API.
/// Good for concrete coding questions; returns the question permalink.
async fn stackoverflow_search(
    query: &str,
    count: usize,
) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q={}&site=stackoverflow&pagesize={}",
        encode_component(query),
        count.clamp(1, 10)
    );
    let value = http_get_json(&url).await?;
    Ok(parse_stackoverflow_items(&value))
}

fn parse_stackoverflow_items(value: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return out;
    };
    for item in items {
        let title = strip_html(item.get("title").and_then(Value::as_str).unwrap_or(""));
        let link = item.get("link").and_then(Value::as_str).unwrap_or("");
        if title.is_empty() || link.is_empty() {
            continue;
        }
        let score = item.get("score").and_then(Value::as_i64).unwrap_or(0);
        let answered = item
            .get("is_answered")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let suffix = if answered { " · answered" } else { "" };
        out.push((
            title,
            link.to_string(),
            format!("Stack Overflow · score {score}{suffix}"),
        ));
    }
    out
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

    #[test]
    fn merge_search_results_interleaves_and_dedups() {
        let a = vec![
            ("A1".to_string(), "https://a/1".to_string(), String::new()),
            ("A2".to_string(), "https://a/2".to_string(), String::new()),
        ];
        let b = vec![
            ("B1".to_string(), "https://b/1".to_string(), String::new()),
            // duplicate URL of a[0] — must be dropped
            ("dup".to_string(), "https://a/1".to_string(), String::new()),
        ];
        let merged = merge_search_results(&[a, b], 4);
        let urls: Vec<&str> = merged
            .iter()
            .map(|hit| hit["url"].as_str().unwrap())
            .collect();
        // round-robin a[0], b[0], a[1]; b[1] is a dup of a[0] and is skipped.
        assert_eq!(urls, vec!["https://a/1", "https://b/1", "https://a/2"]);
        assert_eq!(merged[0]["position"], 1);
        assert_eq!(merged[2]["position"], 3);
    }

    #[test]
    fn parse_hackernews_hits_uses_url_or_item_permalink() {
        let value = serde_json::json!({
            "hits": [
                { "title": "Async Rust", "url": "https://example.com/async", "objectID": "1", "points": 120, "num_comments": 45 },
                { "title": "Ask HN: Rust?", "objectID": "2", "points": 10, "num_comments": 3 }
            ]
        });
        let out = parse_hackernews_hits(&value);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].1, "https://example.com/async");
        // No `url` field -> fall back to the HN item permalink.
        assert_eq!(out[1].1, "https://news.ycombinator.com/item?id=2");
        assert!(out[0].2.contains("120 points"));
    }

    #[test]
    fn parse_stackoverflow_items_decodes_titles() {
        let value = serde_json::json!({
            "items": [
                { "title": "Why &amp; how to use async", "link": "https://stackoverflow.com/q/1", "score": 7, "is_answered": true },
                { "title": "", "link": "https://stackoverflow.com/q/2" }
            ]
        });
        let out = parse_stackoverflow_items(&value);
        assert_eq!(out.len(), 1); // empty-title item is skipped
        assert_eq!(out[0].0, "Why & how to use async");
        assert_eq!(out[0].1, "https://stackoverflow.com/q/1");
        assert!(out[0].2.contains("answered"));
    }
}
