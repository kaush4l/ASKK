//! `web_search` — browser-direct search over CORS-open sources: DuckDuckGo
//! Instant Answers first, Wikipedia full-text search as fallback. URL
//! building and reply parsing are pure functions; the Transport is injected
//! (ADR-009), so tests script it with `MockTransport`.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use askk_inference::{HttpRequest, Transport};
use serde_json::Value;

use crate::state::LocalBoxFuture;

use super::registry::{RegistryError, ToolRegistry};

const MAX_RESULTS: usize = 5;

/// Registers `web_search` with the given transport (fetch in `web`, mock in
/// host runs and tests).
pub fn register_web_search(
    reg: &mut ToolRegistry,
    transport: Rc<dyn Transport>,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(WebSearch::new(transport)))
}

pub struct WebSearch {
    spec: ToolSpec,
    transport: Rc<dyn Transport>,
}

impl WebSearch {
    pub fn new(transport: Rc<dyn Transport>) -> Self {
        Self {
            spec: ToolSpec {
                name: "web_search".into(),
                description: "Searches the web (DuckDuckGo instant answers, \
                              Wikipedia fallback) and returns the top results."
                    .into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query." }
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
        serde_json::from_str(&resp.body).map_err(|e| e.to_string())
    }

    async fn search(&self, query: &str) -> Result<String, String> {
        let ddg = match self.fetch_json(ddg_url(query)).await {
            Ok(value) => {
                let lines = parse_ddg(&value);
                if lines.is_empty() {
                    Err("no instant answer".to_string())
                } else {
                    Ok(lines)
                }
            }
            Err(e) => Err(e),
        };
        let lines = match ddg {
            Ok(lines) => lines,
            Err(ddg_err) => {
                let value = self
                    .fetch_json(wiki_url(query))
                    .await
                    .map_err(|wiki_err| format!("duckduckgo: {ddg_err}; wikipedia: {wiki_err}"))?;
                let lines = parse_wiki(&value);
                if lines.is_empty() {
                    return Err(format!("no results for '{query}'"));
                }
                lines
            }
        };
        Ok(lines.join("\n"))
    }
}

impl Tool for WebSearch {
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
                return ToolResult::err("web_search: missing string field 'query'");
            };
            match self.search(query).await {
                Ok(text) => ToolResult::ok(text),
                Err(e) => ToolResult::err(format!("web_search: {e}")),
            }
        })
    }
}

/// RFC 3986 unreserved stay literal; everything else percent-encodes.
fn encode(query: &str) -> String {
    let mut out = String::new();
    for byte in query.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn ddg_url(query: &str) -> String {
    format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        encode(query)
    )
}

fn wiki_url(query: &str) -> String {
    format!(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={}\
         &format=json&origin=*&srlimit={MAX_RESULTS}",
        encode(query)
    )
}

/// Instant-answer fields in usefulness order: direct answer, abstract,
/// definition, then related topics (flat and one level of nesting).
fn parse_ddg(value: &Value) -> Vec<String> {
    let text = |key: &str| value.get(key).and_then(Value::as_str).unwrap_or("");
    let mut lines = Vec::new();
    if !text("Answer").is_empty() {
        lines.push(text("Answer").to_string());
    }
    if !text("AbstractText").is_empty() {
        let heading = if text("Heading").is_empty() {
            String::new()
        } else {
            format!("{}: ", text("Heading"))
        };
        lines.push(format!(
            "{heading}{} ({})",
            text("AbstractText"),
            text("AbstractURL")
        ));
    }
    if !text("Definition").is_empty() {
        lines.push(text("Definition").to_string());
    }
    let mut topics = Vec::new();
    flatten_topics(value.get("RelatedTopics"), &mut topics);
    for topic in topics {
        if lines.len() >= MAX_RESULTS {
            break;
        }
        lines.push(topic);
    }
    lines.truncate(MAX_RESULTS);
    lines
}

fn flatten_topics(value: Option<&Value>, out: &mut Vec<String>) {
    let Some(entries) = value.and_then(Value::as_array) else {
        return;
    };
    for entry in entries {
        if let Some(text) = entry.get("Text").and_then(Value::as_str) {
            let url = entry.get("FirstURL").and_then(Value::as_str).unwrap_or("");
            out.push(format!("- {text} ({url})"));
        } else {
            flatten_topics(entry.get("Topics"), out);
        }
    }
}

fn parse_wiki(value: &Value) -> Vec<String> {
    let Some(hits) = value["query"]["search"].as_array() else {
        return Vec::new();
    };
    hits.iter()
        .take(MAX_RESULTS)
        .filter_map(|hit| {
            let title = hit.get("title").and_then(Value::as_str)?;
            let snippet = strip_tags(hit.get("snippet").and_then(Value::as_str).unwrap_or(""));
            Some(format!(
                "- {title}: {snippet} (https://en.wikipedia.org/wiki/{})",
                encode(&title.replace(' ', "_"))
            ))
        })
        .collect()
}

/// Drops `<...>` markup and decodes the entities Wikipedia snippets carry.
fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use askk_inference::MockTransport;
    use serde_json::json;

    fn call(transport: Rc<MockTransport>, args: Value) -> ToolResult {
        let tool = WebSearch::new(transport);
        block_on(tool.call(args, &mut ToolCtx::default()))
    }

    #[test]
    fn urls_encode_the_query() {
        assert!(ddg_url("rust & wasm?").contains("q=rust%20%26%20wasm%3F"));
        assert!(wiki_url("caffè").contains("srsearch=caff%C3%A8"));
    }

    #[test]
    fn ddg_answer_and_abstract_win() {
        let value = json!({
            "Answer": "42",
            "Heading": "Rust",
            "AbstractText": "A systems language.",
            "AbstractURL": "https://rust-lang.org",
            "RelatedTopics": [
                {"Text": "Cargo", "FirstURL": "https://a"},
                {"Topics": [{"Text": "Nested", "FirstURL": "https://b"}]}
            ]
        });
        let lines = parse_ddg(&value);
        assert_eq!(lines[0], "42");
        assert_eq!(
            lines[1],
            "Rust: A systems language. (https://rust-lang.org)"
        );
        assert!(lines.contains(&"- Cargo (https://a)".to_string()));
        assert!(lines.contains(&"- Nested (https://b)".to_string()));
        assert!(lines.len() <= MAX_RESULTS);
    }

    #[test]
    fn wiki_hits_strip_markup_and_link() {
        let value = json!({"query": {"search": [
            {"title": "Rust (programming language)",
             "snippet": "<span class=\"searchmatch\">Rust</span> is &quot;fast&quot;"}
        ]}});
        let lines = parse_wiki(&value);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("- Rust (programming language): Rust is \"fast\""));
        assert!(lines[0].contains("en.wikipedia.org/wiki/Rust_%28programming_language%29"));
    }

    #[test]
    fn empty_instant_answer_falls_back_to_wikipedia() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(
            200,
            r#"{"Answer": "", "AbstractText": "", "RelatedTopics": []}"#,
        );
        transport.push_ok(
            200,
            r#"{"query": {"search": [{"title": "Rust", "snippet": "a language"}]}}"#,
        );
        let out = call(transport.clone(), json!({"query": "rust"}));
        assert!(out.ok, "{}", out.content);
        assert!(out.content.contains("- Rust: a language"));
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].url.contains("duckduckgo"));
        assert!(requests[1].url.contains("wikipedia"));
    }

    #[test]
    fn ddg_hit_skips_the_fallback() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(
            200,
            r#"{"AbstractText": "Answer.", "AbstractURL": "https://x"}"#,
        );
        let out = call(transport.clone(), json!({"query": "q"}));
        assert!(out.ok);
        assert!(out.content.contains("Answer."));
        assert_eq!(transport.requests.borrow().len(), 1);
    }

    #[test]
    fn both_sources_failing_is_ok_false_with_both_hints() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(500, "boom");
        transport.push_ok(403, "nope");
        let out = call(transport, json!({"query": "q"}));
        assert!(!out.ok);
        assert!(out.content.contains("duckduckgo"));
        assert!(out.content.contains("wikipedia"));
    }

    #[test]
    fn missing_query_is_a_readable_error() {
        let out = call(Rc::new(MockTransport::new()), json!({}));
        assert!(!out.ok);
        assert!(out.content.contains("query"));
        let out = call(Rc::new(MockTransport::new()), json!({"query": "  "}));
        assert!(!out.ok);
    }
}
