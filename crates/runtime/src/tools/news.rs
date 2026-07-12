//! `news_search` — latest news over CORS-open sources: Wikinews full-text
//! search first (key-free, origin=*, reliable), GDELT DOC 2.0 as best-effort
//! fallback for topics Wikinews misses (GDELT is broad + fresh but
//! rate-limits/bans hard, so it is never primary). Same shape as
//! `web_search`: pure URL builders/parsers, injected Transport (ADR-009).

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use askk_inference::{HttpRequest, Transport};
use serde_json::Value;

use crate::state::LocalBoxFuture;

use super::registry::{RegistryError, ToolRegistry};
use super::search::encode;

const MAX_RESULTS: usize = 5;

/// Registers `news_search` with the given transport.
pub fn register_news(
    reg: &mut ToolRegistry,
    transport: Rc<dyn Transport>,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(NewsSearch::new(transport)))
}

pub struct NewsSearch {
    spec: ToolSpec,
    transport: Rc<dyn Transport>,
}

impl NewsSearch {
    pub fn new(transport: Rc<dyn Transport>) -> Self {
        Self {
            spec: ToolSpec {
                name: "news_search".into(),
                description: "Searches recent news (Wikinews, GDELT worldwide \
                              article index as fallback) and returns the top \
                              headlines with dates and links. Use for current \
                              events; use web_search for general facts."
                    .into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "News topic or keywords." }
                    },
                    "required": ["query"]
                }),
                effect: Effect::Pure,
            },
            transport,
        }
    }

    async fn fetch_json(&self, url: String) -> Result<Value, String> {
        let resp = self
            .transport
            .send(HttpRequest {
                method: "GET".into(),
                url,
                headers: Vec::new(),
                body: String::new(),
            })
            .await
            .map_err(|e| format!("{e:?}"))?;
        if !(200..300).contains(&resp.status) {
            return Err(format!("HTTP {}", resp.status));
        }
        // GDELT serves error text with a 200 — a parse failure is a miss,
        // not a malformed run.
        serde_json::from_str(&resp.body).map_err(|e| e.to_string())
    }

    async fn search(&self, query: &str) -> Result<String, String> {
        let wikinews = match self.fetch_json(wikinews_url(query)).await {
            Ok(value) => {
                let lines = parse_wikinews(&value);
                if lines.is_empty() {
                    Err("no hits".to_string())
                } else {
                    Ok(lines)
                }
            }
            Err(e) => Err(e),
        };
        let lines = match wikinews {
            Ok(lines) => lines,
            Err(wn_err) => {
                let value = self
                    .fetch_json(gdelt_url(query))
                    .await
                    .map_err(|gd_err| format!("wikinews: {wn_err}; gdelt: {gd_err}"))?;
                let lines = parse_gdelt(&value);
                if lines.is_empty() {
                    return Err(format!("no news for '{query}'"));
                }
                lines
            }
        };
        Ok(lines.join("\n"))
    }
}

impl Tool for NewsSearch {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|q| !q.is_empty());
            let Some(query) = query else {
                return ToolResult::err("news_search: missing string field 'query'");
            };
            match self.search(query).await {
                Ok(text) => ToolResult::ok(text),
                Err(e) => ToolResult::err(format!("news_search: {e}")),
            }
        })
    }
}

fn gdelt_url(query: &str) -> String {
    format!(
        "https://api.gdeltproject.org/api/v2/doc/doc?query={}&mode=artlist\
         &format=json&maxrecords={MAX_RESULTS}&sort=datedesc",
        encode(query)
    )
}

fn wikinews_url(query: &str) -> String {
    format!(
        "https://en.wikinews.org/w/api.php?action=query&list=search&srsearch={}\
         &srsort=create_timestamp_desc&format=json&origin=*&srlimit={MAX_RESULTS}",
        encode(query)
    )
}

/// GDELT artlist: `articles[].{title, url, seendate, domain}`.
fn parse_gdelt(value: &Value) -> Vec<String> {
    let Some(articles) = value.get("articles").and_then(Value::as_array) else {
        return Vec::new();
    };
    articles
        .iter()
        .take(MAX_RESULTS)
        .filter_map(|a| {
            let title = a.get("title").and_then(Value::as_str)?;
            let url = a.get("url").and_then(Value::as_str).unwrap_or("");
            let date = a.get("seendate").and_then(Value::as_str).unwrap_or("");
            let domain = a.get("domain").and_then(Value::as_str).unwrap_or("");
            Some(format!("- [{date}] {title} — {domain} ({url})"))
        })
        .collect()
}

/// Wikinews search hits, newest first (srsort): `query.search[].{title, snippet, timestamp}`.
fn parse_wikinews(value: &Value) -> Vec<String> {
    let Some(hits) = value["query"]["search"].as_array() else {
        return Vec::new();
    };
    hits.iter()
        .take(MAX_RESULTS)
        .filter_map(|hit| {
            let title = hit.get("title").and_then(Value::as_str)?;
            let date = hit
                .get("timestamp")
                .and_then(Value::as_str)
                .map(|t| t.split('T').next().unwrap_or(t))
                .unwrap_or("");
            let snippet =
                super::search::strip_tags(hit.get("snippet").and_then(Value::as_str).unwrap_or(""));
            Some(format!(
                "- [{date}] {title}: {snippet} (https://en.wikinews.org/wiki/{})",
                encode(&title.replace(' ', "_"))
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use askk_inference::MockTransport;
    use serde_json::json;

    fn call(transport: Rc<MockTransport>, args: Value) -> ToolResult {
        let tool = NewsSearch::new(transport);
        block_on(tool.call(args, &mut ToolCtx::default()))
    }

    #[test]
    fn urls_encode_and_sort_newest_first() {
        assert!(gdelt_url("ai news").contains("query=ai%20news"));
        assert!(gdelt_url("x").contains("sort=datedesc"));
        assert!(wikinews_url("x").contains("srsort=create_timestamp_desc"));
        assert!(wikinews_url("x").contains("origin=*"));
    }

    #[test]
    fn wikinews_hits_win_and_skip_gdelt() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(
            200,
            r#"{"query": {"search": [{"title": "Storm hits coast",
                 "snippet": "a <b>storm</b>", "timestamp": "2026-07-10T08:00:00Z"}]}}"#,
        );
        let out = call(transport.clone(), json!({"query": "storm"}));
        assert!(out.ok, "{}", out.content);
        assert!(out.content.contains("[2026-07-10] Storm hits coast"));
        assert!(out
            .content
            .contains("en.wikinews.org/wiki/Storm_hits_coast"));
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].url.contains("wikinews"));
    }

    #[test]
    fn wikinews_miss_falls_back_to_gdelt() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(200, r#"{"query": {"search": []}}"#);
        transport.push_ok(
            200,
            r#"{"articles": [{"title": "Big story", "url": "https://n.example/a",
                 "seendate": "20260711T120000Z", "domain": "n.example"}]}"#,
        );
        let out = call(transport.clone(), json!({"query": "big"}));
        assert!(out.ok, "{}", out.content);
        assert!(out.content.contains("Big story"));
        assert!(out.content.contains("n.example"));
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].url.contains("wikinews"));
        assert!(requests[1].url.contains("gdeltproject"));
    }

    #[test]
    fn gdelt_rate_limit_text_is_a_readable_miss() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(429, "slow down");
        // GDELT's habit: HTTP 200 with a plain-text scold, not JSON.
        transport.push_ok(200, "Please slow down your queries.");
        let out = call(transport, json!({"query": "q"}));
        assert!(!out.ok);
        assert!(out.content.contains("wikinews"));
        assert!(out.content.contains("gdelt"));
    }

    #[test]
    fn missing_query_is_a_readable_error() {
        let out = call(Rc::new(MockTransport::new()), json!({}));
        assert!(!out.ok);
        assert!(out.content.contains("query"));
    }
}
