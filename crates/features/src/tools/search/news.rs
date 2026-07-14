//! News lane of `web_search` (`news: true`) — pure URL builders and parsers
//! for the CORS-open news sources: Wikinews full-text search (key-free,
//! origin=*, reliable) and GDELT DOC 2.0 (broad + fresh but rate-limits/bans
//! hard, so never primary). The chain itself lives in `engines.rs`.

use serde_json::Value;

use super::engines::{encode, strip_tags};

const MAX_RESULTS: usize = 5;

pub(super) fn gdelt_url(query: &str) -> String {
    format!(
        "https://api.gdeltproject.org/api/v2/doc/doc?query={}&mode=artlist\
         &format=json&maxrecords={MAX_RESULTS}&sort=datedesc",
        encode(query)
    )
}

pub(super) fn wikinews_url(query: &str) -> String {
    format!(
        "https://en.wikinews.org/w/api.php?action=query&list=search&srsearch={}\
         &srsort=create_timestamp_desc&format=json&origin=*&srlimit={MAX_RESULTS}",
        encode(query)
    )
}

/// GDELT artlist: `articles[].{title, url, seendate, domain}`.
pub(super) fn parse_gdelt(value: &Value) -> Vec<String> {
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
pub(super) fn parse_wikinews(value: &Value) -> Vec<String> {
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
            let snippet = strip_tags(hit.get("snippet").and_then(Value::as_str).unwrap_or(""));
            Some(format!(
                "- [{date}] {title}: {snippet} (https://en.wikinews.org/wiki/{})",
                encode(&title.replace(' ', "_"))
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::super::engines::WebSearch;
    use super::*;
    use crate::testutil::block_on;
    use askk_core::{Tool, ToolCtx, ToolResult};
    use askk_inference::MockTransport;
    use serde_json::json;

    fn call(transport: Rc<MockTransport>, args: Value) -> ToolResult {
        // Empty SearXNG cell: the news lane never touches the general chain.
        let tool = WebSearch::new(transport, Rc::new(RefCell::new(String::new())));
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
        let out = call(transport.clone(), json!({"query": "storm", "news": true}));
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
        let out = call(transport.clone(), json!({"query": "big", "news": true}));
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
        let out = call(transport, json!({"query": "q", "news": true}));
        assert!(!out.ok);
        assert!(out.content.contains("wikinews"));
        assert!(out.content.contains("gdelt"));
    }
}
