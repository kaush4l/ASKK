//! `web_search` — discover sources on the web, including current news. Two
//! interchangeable backends sit behind the same envelope
//! (`{ success, data: { web: [...] } }`):
//!
//! - **Browser** (default): if a Tavily API key is configured, call Tavily directly
//!   from the page (Tavily allows cross-origin requests) for full general-web + news
//!   search with no bridge. With no key, merge several CORS-open, key-free public APIs
//!   concurrently — DuckDuckGo Instant Answer (entity answers), Wikinews (real news,
//!   reliable, no rate limit), GDELT (fresher/broader news but rate-limited), Hacker
//!   News (tech discussion), Stack Overflow (coding Q&A), and Wikipedia (reference).
//!   Works on the hosted HTTPS site with no bridge; a source that errors or
//!   rate-limits is simply dropped from the merge.
//! - **Bridge**: forward to a full provider (Brave/Tavily/SearXNG) via the local
//!   bridge.
//!
//! Adding another source/provider is a new arm here; the agent loop never changes.

use crate::state::{AppResult, AppSnapshot, SearchBackend, ToolSpec, WebSearchToolConfig};
use serde_json::{Value, json};
use std::collections::HashSet;

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{integer_arg, merge_optional_string, string_arg};
use super::http::{encode_component, http_get_json, http_post_json, strip_html};
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
        description: "Search the web for current information and news, returning titles, URLs, and descriptions. By default it runs directly in the browser key-free (Wikinews and GDELT for news, DuckDuckGo, Hacker News, Stack Overflow, Wikipedia); adding a Tavily API key on the Tools page upgrades it to full general-web search from the page, and the local bridge can be used for Brave/Tavily/SearXNG. Use it to discover sources for recent events and news, then web_fetch the best ones to read them in full.".to_string(),
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

/// Browser backend: use a configured Tavily key (full general-web search) if present,
/// otherwise merge the CORS-open, key-free sources (news + tech + reference), dedupe by
/// URL, cap to `count`, and number the positions.
async fn browser_web_search(args: &Value, config: &WebSearchToolConfig) -> AppResult<String> {
    let query = string_arg(args, "query")?;
    let count = integer_arg(args, "count")
        .unwrap_or(i64::from(config.default_count))
        .clamp(1, 10) as usize;

    // Best path: a configured Tavily key calls Tavily directly from the page (Tavily
    // allows cross-origin requests) — a real general-web + news provider with no
    // bridge. Fall through to the key-free sources if it errors or returns nothing, so
    // a bad key or outage degrades to the key-free backend rather than failing.
    let tavily_key = config.tavily_api_key.trim();
    if !tavily_key.is_empty()
        && let Ok(web) = tavily_browser_search(&query, count, tavily_key).await
        && !web.is_empty()
    {
        return Ok(
            json!({ "success": true, "data": { "web": web }, "backend": "browser+tavily" })
                .to_string(),
        );
    }

    // No single key-free API does general web search, so query several CORS-open,
    // key-free sources CONCURRENTLY and merge: DuckDuckGo Instant Answer (entity /
    // definition answers), Wikinews (real news, Wikipedia-grade CORS + no rate limit),
    // GDELT (fresher/broader news but rate-limited, best-effort), Hacker News (tech
    // discussion), Stack Overflow (coding Q&A), and Wikipedia (reference). For a full
    // general-web provider without a key, switch the Tools page backend to Bridge.
    let (ddg, wikinews, gdelt, hn, stack, wiki) = futures_util::join!(
        duckduckgo_instant_answer(&query),
        wikinews_search(&query, count),
        gdelt_news_search(&query, count),
        hackernews_search(&query, count),
        stackoverflow_search(&query, count),
        wikipedia_search(&query, count),
    );
    let sources: Vec<Vec<(String, String, String)>> = [ddg, wikinews, gdelt, hn, stack, wiki]
        .into_iter()
        .flatten()
        .collect();
    let web = merge_search_results(&sources, count);

    if web.is_empty() {
        return Err(format!(
            "No browser web_search results for `{query}`. The key-free browser backend (Wikinews, GDELT, DuckDuckGo, Hacker News, Stack Overflow, Wikipedia) has limited coverage. For full general-web search from the hosted site, add a free Tavily API key on the Tools page; or switch the backend to Bridge for Brave / Tavily / SearXNG."
        ));
    }

    Ok(json!({ "success": true, "data": { "web": web }, "backend": "browser" }).to_string())
}

/// Browser-direct Tavily search (BYOK). Tavily allows cross-origin requests, so a
/// configured key lets us call it straight from the page — a real general-web + news
/// provider, no bridge required. Returns the shared `web` hit array.
async fn tavily_browser_search(query: &str, count: usize, api_key: &str) -> AppResult<Vec<Value>> {
    // Send the key both as the bearer header (current Tavily) and as the legacy
    // `api_key` body field, so either auth mode the key was issued for works.
    let body = json!({
        "api_key": api_key,
        "query": query,
        "topic": "general",
        "max_results": count.clamp(1, 10),
        "search_depth": "basic",
    });
    let value = http_post_json("https://api.tavily.com/search", &body, Some(api_key)).await?;
    Ok(parse_tavily_results(&value, count))
}

fn parse_tavily_results(value: &Value, count: usize) -> Vec<Value> {
    let Some(results) = value.get("results").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut web = Vec::new();
    for item in results {
        let title = item.get("title").and_then(Value::as_str).unwrap_or("");
        let url = item.get("url").and_then(Value::as_str).unwrap_or("");
        if title.trim().is_empty() || url.trim().is_empty() {
            continue;
        }
        let description = item
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
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
    web
}

/// Real-news search via Wikinews, using the same key-free, CORS-open MediaWiki API as
/// Wikipedia — so it is reliable with no rate limit (unlike GDELT). Coverage is thinner
/// (volunteer-written) but it returns real news articles for major topics, and the
/// agent can `web_fetch` any hit to read the full story.
async fn wikinews_search(query: &str, count: usize) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://en.wikinews.org/w/api.php?action=query&list=search&srsearch={}&format=json&origin=*&srlimit={}&srsort=create_timestamp_desc",
        encode_component(query),
        count.clamp(1, 10),
    );
    let value = http_get_json(&url).await?;
    Ok(parse_wikinews_hits(&value))
}

fn parse_wikinews_hits(value: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Some(hits) = value
        .get("query")
        .and_then(|query| query.get("search"))
        .and_then(Value::as_array)
    else {
        return out;
    };
    for hit in hits {
        let title = hit.get("title").and_then(Value::as_str).unwrap_or("");
        if title.is_empty() {
            continue;
        }
        let timestamp = hit.get("timestamp").and_then(Value::as_str).unwrap_or("");
        let page_url = format!(
            "https://en.wikinews.org/wiki/{}",
            encode_component(&title.replace(' ', "_"))
        );
        let snippet = strip_html(hit.get("snippet").and_then(Value::as_str).unwrap_or(""));
        let description = if snippet.is_empty() {
            format!("Wikinews · {timestamp}")
        } else {
            format!("Wikinews · {timestamp} · {snippet}")
        };
        out.push((title.to_string(), page_url, description));
    }
    out
}

/// Current-news search via GDELT's key-free, CORS-open global news index. Returns the
/// most recent matching articles, so the otherwise tech- and reference-heavy key-free
/// backend can answer "latest news" queries. GDELT rate-limits to roughly one request
/// every few seconds; when it throttles (or a query is too short), this source simply
/// errors and is dropped from the merge while the others still answer.
async fn gdelt_news_search(query: &str, count: usize) -> AppResult<Vec<(String, String, String)>> {
    let url = format!(
        "https://api.gdeltproject.org/api/v2/doc/doc?query={}&mode=artlist&format=json&sort=datedesc&maxrecords={}",
        encode_component(query),
        count.clamp(1, 10),
    );
    let value = http_get_json(&url).await?;
    Ok(parse_gdelt_articles(&value))
}

fn parse_gdelt_articles(value: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Some(articles) = value.get("articles").and_then(Value::as_array) else {
        return out;
    };
    for article in articles {
        let title = clean_gdelt_title(article.get("title").and_then(Value::as_str).unwrap_or(""));
        let url = article.get("url").and_then(Value::as_str).unwrap_or("");
        if title.is_empty() || url.is_empty() {
            continue;
        }
        let domain = article.get("domain").and_then(Value::as_str).unwrap_or("");
        let date = article
            .get("seendate")
            .and_then(Value::as_str)
            .unwrap_or("");
        out.push((title, url.to_string(), format!("News · {domain} · {date}")));
    }
    out
}

/// GDELT tokenizes titles with spaces around punctuation ("U . S . stocks , Asia");
/// collapse the common cases back to readable text.
fn clean_gdelt_title(raw: &str) -> String {
    strip_html(raw)
        .replace(" ,", ",")
        .replace(" .", ".")
        .replace(" ?", "?")
        .replace(" !", "!")
        .replace(" :", ":")
        .replace(" ;", ";")
        .trim()
        .to_string()
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
    fn parse_gdelt_articles_extracts_recent_news_and_cleans_titles() {
        let value = serde_json::json!({
            "articles": [
                {
                    "title": "U . S . stocks close mixed , Asian markets sink",
                    "url": "https://news.example/markets",
                    "domain": "news.example",
                    "seendate": "20260609T004500Z",
                    "language": "English"
                },
                { "title": "", "url": "https://news.example/empty" }
            ]
        });
        let out = parse_gdelt_articles(&value);
        assert_eq!(out.len(), 1); // empty-title article is skipped
        assert_eq!(out[0].0, "U. S. stocks close mixed, Asian markets sink");
        assert_eq!(out[0].1, "https://news.example/markets");
        assert!(out[0].2.contains("news.example"));
        assert!(out[0].2.contains("20260609"));
    }

    #[test]
    fn parse_wikinews_hits_builds_article_urls_and_dates() {
        let value = serde_json::json!({
            "query": { "search": [
                { "title": "Iran launches missiles at Israel", "timestamp": "2025-09-25T01:03:10Z", "snippet": "<span>Tensions</span> rise" },
                { "title": "", "timestamp": "2026-01-01T00:00:00Z" }
            ]}
        });
        let out = parse_wikinews_hits(&value);
        assert_eq!(out.len(), 1); // empty-title hit is skipped
        assert_eq!(out[0].0, "Iran launches missiles at Israel");
        assert_eq!(
            out[0].1,
            "https://en.wikinews.org/wiki/Iran_launches_missiles_at_Israel"
        );
        assert!(out[0].2.contains("Wikinews"));
        assert!(out[0].2.contains("2025-09-25"));
        assert!(out[0].2.contains("Tensions rise")); // HTML stripped
    }

    #[test]
    fn parse_tavily_results_maps_to_web_hits() {
        let value = serde_json::json!({
            "results": [
                { "title": "Tesla news", "url": "https://t.example/1", "content": "Latest on TSLA today.", "score": 0.9 },
                { "title": "", "url": "https://t.example/2", "content": "skip: empty title" }
            ]
        });
        let web = parse_tavily_results(&value, 5);
        assert_eq!(web.len(), 1); // empty-title result is skipped
        assert_eq!(web[0]["title"], "Tesla news");
        assert_eq!(web[0]["url"], "https://t.example/1");
        assert_eq!(web[0]["description"], "Latest on TSLA today.");
        assert_eq!(web[0]["position"], 1);
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
